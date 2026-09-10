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
 * Turning codediff's hunks into editor decorations.
 *
 * The colours are theme references, not literals: `diffEditor.insertedTextBackground` and friends
 * are what VS Code's own diff editor paints with, so these highlights sit correctly in any theme -
 * light, dark or high-contrast - without this extension shipping a palette it would have to keep
 * in step with every theme in the Marketplace.
 */

import * as vscode from 'vscode';

import { byteColumnToUtf16 } from './columns';
import type { JsonHunk, JsonRange, Operation } from './codediff';

/** One decoration type per operation, created once and reused for the editor's lifetime. */
export type DecorationTypes = Readonly<Record<Operation, vscode.TextEditorDecorationType>>;

export function createDecorationTypes(): DecorationTypes {
  const background = (themeColor: string): vscode.DecorationRenderOptions => ({
    backgroundColor: new vscode.ThemeColor(themeColor),
    // Without this, a decoration whose range ends at the line end does not extend to the edge of
    // the viewport, and a run of changed lines looks ragged rather than like a block.
    isWholeLine: false,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  return Object.freeze({
    insert: vscode.window.createTextEditorDecorationType(background('diffEditor.insertedTextBackground')),
    delete: vscode.window.createTextEditorDecorationType(background('diffEditor.removedTextBackground')),
    // VS Code has no "updated" or "moved" diff colour of its own. `merge.currentContentBackground`
    // and `editor.symbolHighlightBackground` are the closest theme-defined stand-ins: both are
    // defined by every shipped theme, so neither falls back to transparent.
    update: vscode.window.createTextEditorDecorationType(background('merge.currentContentBackground')),
    move: vscode.window.createTextEditorDecorationType(background('editor.symbolHighlightBackground')),
  });
}

/**
 * Converts one codediff range to a `vscode.Range` against `document`.
 *
 * Both columns go through `byteColumnToUtf16` against **their own** row's text - not the start
 * row's - which is the bug this function exists to make impossible to write by accident.
 */
export function toVsCodeRange(document: vscode.TextDocument, range: JsonRange): vscode.Range {
  const lineText = (row: number): string =>
    row < document.lineCount ? document.lineAt(row).text : '';

  return new vscode.Range(
    range.start_row,
    byteColumnToUtf16(lineText(range.start_row), range.start_column),
    range.end_row,
    byteColumnToUtf16(lineText(range.end_row), range.end_column)
  );
}

/**
 * Paints `hunks` onto `editor`, replacing whatever this extension painted there before.
 *
 * Every operation is set explicitly, including the ones with no hunks: passing an empty array is
 * how a decoration type gets cleared, and skipping it would leave the previous diff's highlights
 * of that colour on screen.
 */
export function applyHunks(
  editor: vscode.TextEditor,
  hunks: readonly JsonHunk[],
  types: DecorationTypes
): void {
  const byOperation: Record<Operation, vscode.DecorationOptions[]> = {
    insert: [],
    delete: [],
    update: [],
    move: [],
  };

  for (const hunk of hunks) {
    const bucket = byOperation[hunk.operation];
    // An operation this build does not know: drop the hunk, keep the diff. See `parseDiff`'s own
    // note on why an unknown operation is not an error.
    if (!bucket) {
      continue;
    }
    const decoration: vscode.DecorationOptions = { range: toVsCodeRange(editor.document, hunk.range) };
    if (hunk.move_target) {
      // 0-indexed in the JSON, 1-indexed for a reader.
      decoration.hoverMessage = new vscode.MarkdownString(
        `**CodeDiff:** moved to line ${hunk.move_target.start_row + 1}`
      );
    }
    bucket.push(decoration);
  }

  for (const operation of Object.keys(byOperation) as Operation[]) {
    editor.setDecorations(types[operation], byOperation[operation]);
  }
}

/** Removes every decoration this extension owns from `editor`. */
export function clear(editor: vscode.TextEditor, types: DecorationTypes): void {
  for (const type of Object.values(types)) {
    editor.setDecorations(type, []);
  }
}
