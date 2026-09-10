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
 * Everything that can be tested without an editor lives in `codediff.ts` and `columns.ts`; this
 * file is deliberately thin, because nothing in it can run under `node --test`.
 */

import * as vscode from 'vscode';

import { CodeDiffError, runDiff, type RenderMode } from './codediff';
import { applyHunks, clear, createDecorationTypes, type DecorationTypes } from './decorations';

function configuration(): { binaryPath: string; renderMode: RenderMode } {
  const config = vscode.workspace.getConfiguration('codediff');
  return {
    binaryPath: config.get<string>('binaryPath', 'codediff'),
    renderMode: config.get<RenderMode>('renderMode', 'default'),
  };
}

/**
 * Opens `before` and `after` side by side and paints codediff's verdict on both.
 *
 * Deliberately not VS Code's own `vscode.diff` command: that opens a *merged* diff editor whose
 * two sides are one editor, and `setDecorations` needs a `TextEditorDecorationType` per real
 * editor. Two normal editors in two columns is what makes per-side highlighting possible at all.
 */
async function diffFiles(
  before: vscode.Uri,
  after: vscode.Uri,
  types: DecorationTypes
): Promise<void> {
  const { binaryPath, renderMode } = configuration();

  const diff = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CodeDiff: diffing…' },
    () => runDiff(binaryPath, before.fsPath, after.fsPath, renderMode)
  );

  if (diff.binary) {
    void vscode.window.showInformationMessage('CodeDiff: one of these files is binary - nothing to show.');
    return;
  }

  const beforeEditor = await vscode.window.showTextDocument(before, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  const afterEditor = await vscode.window.showTextDocument(after, {
    viewColumn: vscode.ViewColumn.Two,
    preview: false,
  });

  applyHunks(beforeEditor, diff.before.hunks, types);
  applyHunks(afterEditor, diff.after.hunks, types);

  if (diff.summary) {
    vscode.window.setStatusBarMessage(`CodeDiff: ${diff.summary.replace(/_/g, ' ')}`, 5000);
  }
}

/** Asks for two files, newest-first in the picker, because that is the usual before/after order. */
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

export function activate(context: vscode.ExtensionContext): void {
  const types = createDecorationTypes();
  // Registered on the context so VS Code disposes them with the extension; a leaked decoration
  // type keeps painting after a reload.
  for (const type of Object.values(types)) {
    context.subscriptions.push(type);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('codediff.diffTwoFiles', async () => {
      const pair = await promptForPair();
      if (!pair) {
        return;
      }
      try {
        await diffFiles(pair[0], pair[1], types);
      } catch (error) {
        // A CodeDiffError already reads as a sentence aimed at the user (a missing binary, an old
        // build); anything else is a bug and gets its raw text rather than a friendly rewrite that
        // would hide it.
        const message = error instanceof CodeDiffError ? error.message : `CodeDiff: ${String(error)}`;
        void vscode.window.showErrorMessage(message);
      }
    }),

    vscode.commands.registerCommand('codediff.clearDecorations', () => {
      for (const editor of vscode.window.visibleTextEditors) {
        clear(editor, types);
      }
    })
  );
}

export function deactivate(): void {
  // Nothing to do: every decoration type is on `context.subscriptions` and VS Code disposes them.
}
