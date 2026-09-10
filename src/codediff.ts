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
 * Running `codediff --mode json` and making sense of what comes back.
 *
 * Imports `node:child_process` but deliberately **not** `vscode`, so every function here is
 * unit-testable under plain `node --test` - see `src/test/`. Anything that needs the editor lives
 * in `extension.ts` or `decorations.ts` instead.
 */

import { execFile } from 'node:child_process';

/** The operations codediff's JSON reports. Anything else is a newer codediff than this build. */
export type Operation = 'insert' | 'delete' | 'update' | 'move';

export interface JsonRange {
  start_row: number;
  /** A **byte** offset within its row - see `columns.ts` before using it as a VS Code column. */
  start_column: number;
  end_row: number;
  end_column: number;
}

export interface JsonHunk {
  operation: Operation;
  range: JsonRange;
  /** Set only for `move`: the real counterpart range in the other file. */
  move_target?: JsonRange;
  /** Row of the nearest enclosing declaration - codediff's `@` breadcrumb, as a number. */
  reference_line?: number;
}

export interface JsonSide {
  path: string;
  language: string | null;
  hunks: JsonHunk[];
}

export interface JsonDiff {
  before: JsonSide;
  after: JsonSide;
  large_residual: boolean;
  /** Present only when the diff has one of codediff's recognised overall shapes. */
  summary?: string;
  /** Present, and `true`, only when a side could not be read as text. */
  binary?: boolean;
}

/** Which extra flag, if any, to pass for a configured render mode. */
export type RenderMode = 'default' | 'minimal' | 'full';

export class CodeDiffError extends Error {}

/**
 * Parses codediff's stdout into a `JsonDiff`.
 *
 * Validates the shape rather than trusting a cast. The alternative - `JSON.parse(...) as JsonDiff`
 * - turns "the user has an old codediff on PATH" into an undefined-property crash somewhere in the
 * decoration code, several steps from the cause. Here it is one message naming the real problem.
 *
 * Unknown `operation` values are **not** an error: they are dropped by the caller (see
 * `decorations.ts`). A released extension has to degrade to painting less when codediff grows an
 * operation it does not know, rather than refusing the whole diff.
 */
export function parseDiff(stdout: string): JsonDiff {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (cause) {
    throw new CodeDiffError(
      `codediff did not produce JSON. Is '--mode json' supported by your build? (${String(cause)})`
    );
  }

  if (typeof value !== 'object' || value === null) {
    throw new CodeDiffError('codediff produced JSON that is not an object.');
  }
  const diff = value as Partial<JsonDiff>;
  for (const key of ['before', 'after'] as const) {
    const side = diff[key];
    if (typeof side !== 'object' || side === null || !Array.isArray(side.hunks)) {
      throw new CodeDiffError(`codediff's JSON has no '${key}.hunks' array.`);
    }
  }
  return diff as JsonDiff;
}

/** The argument list for one diff, in the order `codediff` expects them. */
export function buildArguments(before: string, after: string, mode: RenderMode): string[] {
  const args = ['--mode', 'json'];
  // `default` deliberately passes neither flag, so codediff falls back to whatever the user
  // persisted in its own config - which is what makes the two front ends agree by default.
  if (mode === 'minimal' || mode === 'full') {
    args.push(`--${mode}`);
  }
  args.push(before, after);
  return args;
}

/**
 * Runs `codediff --mode json` on a pair of files and returns the parsed diff.
 *
 * `execFile`, not `exec`: the paths are user data and must never reach a shell. `maxBuffer` is
 * raised well past the 1 MB default because the JSON scales with the number of changed ranges, and
 * the default truncates silently enough to look like a parse bug.
 */
export function runDiff(
  binaryPath: string,
  before: string,
  after: string,
  mode: RenderMode = 'default'
): Promise<JsonDiff> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      buildArguments(before, after, mode),
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          // ENOENT is the overwhelmingly common failure and deserves its own sentence rather than
          // a raw spawn error, because the fix is "install codediff", not "report a bug".
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new CodeDiffError(
                `'${binaryPath}' not found. Install codediff (https://github.com/ivankovic/codediff) ` +
                  `or set 'codediff.binaryPath'.`
              )
            );
            return;
          }
          reject(new CodeDiffError(`codediff failed: ${stderr.trim() || error.message}`));
          return;
        }
        try {
          resolve(parseDiff(stdout));
        } catch (cause) {
          reject(cause);
        }
      }
    );
  });
}
