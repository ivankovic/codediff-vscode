/*  This file is part of the CodeDiff code diffing tool.
 *
 *  Copyright (C) 2026 Marko Ivankovic
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as published
 *  by the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Extension entry point: command registration and the editor-facing glue.
 *
 * Everything that can be tested without an editor lives in `codediff.ts`, `columns.ts` and
 * `git.ts`; this file is deliberately thin, because nothing in it can run under `node --test`.
 */

import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { CodeDiffError, isBinaryAvailable, runDiff, type RenderMode } from './codediff';
import { applyHunks, clear, createDecorationTypes, type DecorationTypes } from './decorations';
import {
  GitError,
  materialize,
  relativeToRoot,
  repositoryRoot,
  revisionDirectory,
  showAtRevision,
} from './git';

const INSTALL_URL = 'https://github.com/ivankovic/codediff#installation';

/** How long an abandoned scratch directory survives. See `sweepScratch`. */
const SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function configuration(): { binaryPath: string; renderMode: RenderMode } {
  const config = vscode.workspace.getConfiguration('codediff');
  return {
    binaryPath: config.get<string>('binaryPath', 'codediff'),
    renderMode: config.get<RenderMode>('renderMode', 'default'),
  };
}

/**
 * One side of a diff.
 *
 * `diffPath` and `display` are separate because they genuinely differ: when the content being
 * diffed is an unsaved buffer, codediff has to read a temp copy of it (the CLI reads files from
 * disk and cannot see a dirty buffer), while the editor we paint must be the user's real one.
 */
interface Side {
  /** The file handed to the codediff CLI. */
  diffPath: string;
  /** The document opened and painted. */
  display: vscode.Uri;
  /** Where to put it if it is not already on screen. */
  column: vscode.ViewColumn;
}

/**
 * Reuses an already-visible editor for `side.display` rather than opening a second one.
 *
 * Without this, diffing an unsaved buffer would move the user's own editor into column Two and
 * paint a different instance of it than the one they are typing in.
 */
async function openSide(side: Side): Promise<vscode.TextEditor> {
  const visible = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === side.display.toString()
  );
  if (visible) {
    return visible;
  }
  return vscode.window.showTextDocument(side.display, { viewColumn: side.column, preview: false });
}

/**
 * Runs codediff over the two sides and paints its verdict on both.
 *
 * Deliberately not VS Code's own `vscode.diff` command: that opens a *merged* diff editor whose
 * two sides are one editor, and `setDecorations` needs a `TextEditorDecorationType` per real
 * editor. Two normal editors in two columns is what makes per-side highlighting possible at all.
 */
async function diffSides(before: Side, after: Side, types: DecorationTypes): Promise<void> {
  const { binaryPath, renderMode } = configuration();

  const diff = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CodeDiff: diffing…' },
    () => runDiff(binaryPath, before.diffPath, after.diffPath, renderMode)
  );

  if (diff.binary) {
    void vscode.window.showInformationMessage('CodeDiff: one of these files is binary - nothing to show.');
    return;
  }

  const beforeEditor = await openSide(before);
  const afterEditor = await openSide(after);

  applyHunks(beforeEditor, diff.before.hunks, types);
  applyHunks(afterEditor, diff.after.hunks, types);

  if (diff.summary) {
    vscode.window.setStatusBarMessage(`CodeDiff: ${diff.summary.replace(/_/g, ' ')}`, 5000);
  }
}

function fileSide(path: string, column: vscode.ViewColumn): Side {
  return { diffPath: path, display: vscode.Uri.file(path), column };
}

/** Asks for two files, because the palette command has no context to work from. */
async function promptForPair(): Promise<[vscode.Uri, vscode.Uri] | undefined> {
  const before = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Select the BEFORE file',
    title: 'CodeDiff: before',
  });
  if (!before?.[0]) {
    return undefined;
  }
  const after = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Select the AFTER file',
    title: 'CodeDiff: after',
  });
  if (!after?.[0]) {
    return undefined;
  }
  return [before[0], after[0]];
}

/**
 * The file a command should act on: the one right-clicked in the SCM view, else the active editor.
 *
 * The SCM menu hands the command its resource state, which is duck-typed here rather than typed
 * against the git extension's `git.d.ts`. Vendoring that file would buy an index-vs-HEAD
 * distinction this extension does not make, at the cost of depending on another extension's
 * private API being present and enabled.
 */
function targetUri(argument: unknown): vscode.Uri | undefined {
  const resourceUri = (argument as { resourceUri?: unknown } | undefined)?.resourceUri;
  if (resourceUri instanceof vscode.Uri) {
    return resourceUri;
  }
  if (argument instanceof vscode.Uri) {
    return argument;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

/**
 * Deletes scratch directories left behind by earlier sessions.
 *
 * By age rather than by "not mine", because a second VS Code window may be running its own session
 * right now with editors open on its temp files - deleting those would blank a document someone is
 * reading. Cleaning up at shutdown is not an option either: `deactivate` is not guaranteed to run,
 * and a file cannot be removed while an editor still shows it.
 */
function sweepScratch(root: string): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // Nothing has been written yet.
  }
  const cutoff = Date.now() - SCRATCH_MAX_AGE_MS;
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      if (statSync(path).mtimeMs < cutoff) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // A directory another window is using may vanish under us; that is the outcome we wanted.
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const types = createDecorationTypes();
  // Registered on the context so VS Code disposes them with the extension; a leaked decoration
  // type keeps painting after a reload.
  for (const type of Object.values(types)) {
    context.subscriptions.push(type);
  }

  // `storageUri` is undefined when no folder is open, and both may not exist yet.
  const scratchRoot = join((context.storageUri ?? context.globalStorageUri).fsPath, 'scratch');
  sweepScratch(scratchRoot);
  const session = join(scratchRoot, `session-${process.pid}-${Date.now()}`);

  /** Materialises `uri` as of `ref` and diffs it against the file on disk. */
  async function diffAgainstRevision(uri: vscode.Uri, ref: string): Promise<void> {
    const root = await repositoryRoot(uri.fsPath);
    const bytes = await showAtRevision(root, ref, relativeToRoot(root, uri.fsPath));
    const materialized = materialize(bytes, uri.fsPath, revisionDirectory(session, ref));
    await diffSides(
      fileSide(materialized, vscode.ViewColumn.One),
      { diffPath: uri.fsPath, display: uri, column: vscode.ViewColumn.Two },
      types
    );
  }

  /** Diffs the last saved bytes of `document` against what is currently in the buffer. */
  async function diffAgainstSaved(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') {
      throw new CodeDiffError('CodeDiff: this document is not a file on disk.');
    }
    if (!document.isDirty) {
      void vscode.window.showInformationMessage('CodeDiff: no unsaved changes in this file.');
      return;
    }

    const saved = join(session, 'saved', String(Date.now()));
    const savedPath = materialize(readFileSync(document.uri.fsPath), document.uri.fsPath, saved);

    // The CLI reads from disk and cannot see the buffer, so the unsaved text has to be spilled to
    // a temp file - but the editor we paint is still the user's own, via `Side.display`.
    //
    // Written as UTF-8, which is what `getText` gives back regardless of how the file was decoded.
    // For a file in some other encoding that makes the two sides disagree about non-ASCII bytes;
    // the saved side is the one that is literally correct, and codediff itself assumes UTF-8.
    const bufferPath = materialize(
      Buffer.from(document.getText(), 'utf8'),
      document.uri.fsPath,
      join(session, 'buffer', String(Date.now()))
    );

    await diffSides(
      fileSide(savedPath, vscode.ViewColumn.One),
      { diffPath: bufferPath, display: document.uri, column: vscode.ViewColumn.Two },
      types
    );
  }

  /**
   * Turns a thrown error into one message aimed at the user.
   *
   * `CodeDiffError` and `GitError` already read as sentences; anything else is a bug and keeps its
   * raw text rather than a friendly rewrite that would hide it. A missing binary is the one case
   * worth an action button, since there is something concrete to do about it.
   */
  async function report(error: unknown): Promise<void> {
    if (error instanceof CodeDiffError || error instanceof GitError) {
      if (/not (?:be )?found|is not installed|ENOENT/i.test(error.message)) {
        await offerInstall(error.message);
        return;
      }
      void vscode.window.showErrorMessage(error.message);
      return;
    }
    void vscode.window.showErrorMessage(`CodeDiff: ${String(error)}`);
  }

  async function offerInstall(message: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(message, 'Install instructions', 'Set path…');
    if (choice === 'Install instructions') {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
    } else if (choice === 'Set path…') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'codediff.binaryPath');
    }
  }

  /** Wraps a command body so every one of them reports failures the same way. */
  function command(name: string, body: (argument: unknown) => Promise<void>): vscode.Disposable {
    return vscode.commands.registerCommand(name, async (argument: unknown) => {
      try {
        await body(argument);
      } catch (error) {
        await report(error);
      }
    });
  }

  function requireTarget(argument: unknown): vscode.Uri {
    const uri = targetUri(argument);
    if (!uri) {
      throw new CodeDiffError('CodeDiff: open a file first, or pick one in the Source Control view.');
    }
    return uri;
  }

  context.subscriptions.push(
    command('codediff.diffTwoFiles', async () => {
      const pair = await promptForPair();
      if (!pair) {
        return;
      }
      await diffSides(
        { diffPath: pair[0].fsPath, display: pair[0], column: vscode.ViewColumn.One },
        { diffPath: pair[1].fsPath, display: pair[1], column: vscode.ViewColumn.Two },
        types
      );
    }),

    command('codediff.diffWithHead', async (argument) => {
      await diffAgainstRevision(requireTarget(argument), 'HEAD');
    }),

    command('codediff.diffWithRevision', async (argument) => {
      const uri = requireTarget(argument);
      const ref = await vscode.window.showInputBox({
        title: 'CodeDiff: diff against revision',
        prompt: 'A branch, tag, or commit - anything `git show` accepts.',
        value: 'HEAD~1',
        ignoreFocusOut: true,
      });
      if (!ref?.trim()) {
        return;
      }
      await diffAgainstRevision(uri, ref.trim());
    }),

    command('codediff.diffWithSaved', async (argument) => {
      const uri = requireTarget(argument);
      // Right-clicking a tab does not focus it, so this command cannot just read
      // `activeTextEditor` - it has to find the document the menu actually pointed at.
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === uri.toString()
      );
      if (!document) {
        throw new CodeDiffError('CodeDiff: that file is not open, so it has no unsaved changes.');
      }
      await diffAgainstSaved(document);
    }),

    vscode.commands.registerCommand('codediff.clearDecorations', () => {
      for (const editor of vscode.window.visibleTextEditors) {
        clear(editor, types);
      }
    })
  );

  // Checked once here rather than before every diff: activation is already lazy (it happens on the
  // first command), so this costs one process at the moment the user first asks for something, and
  // tells them what is wrong before they wonder why nothing painted.
  void isBinaryAvailable(configuration().binaryPath).then((available) => {
    if (!available) {
      void offerInstall(
        `CodeDiff: '${configuration().binaryPath}' was not found on PATH. The extension needs the codediff CLI.`
      );
    }
  });
}

export function deactivate(): void {
  // Nothing to do: every decoration type is on `context.subscriptions` and VS Code disposes them.
  // Scratch files are swept by age at the next activation - see `sweepScratch`.
}
