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

/** Tests for argument construction and JSON validation - no editor host needed. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildArguments, CodeDiffError, parseDiff } from '../codediff';

test('default mode passes no render flag, so codediff uses its own persisted setting', () => {
  assert.deepEqual(buildArguments('a.rs', 'b.rs', 'default'), ['--mode', 'json', 'a.rs', 'b.rs']);
});

test('minimal and full are passed through as flags', () => {
  assert.deepEqual(buildArguments('a.rs', 'b.rs', 'minimal'), ['--mode', 'json', '--minimal', 'a.rs', 'b.rs']);
  assert.deepEqual(buildArguments('a.rs', 'b.rs', 'full'), ['--mode', 'json', '--full', 'a.rs', 'b.rs']);
});

test('paths go last, after every flag, and are never concatenated into one string', () => {
  // The property that keeps a path with a space (or a quote) from being re-split by a shell:
  // execFile takes an argv array, and this is the array.
  const args = buildArguments('/tmp/my file.rs', '-weird-name.rs', 'default');
  assert.deepEqual(args.slice(-2), ['/tmp/my file.rs', '-weird-name.rs']);
});

test('a real diff object parses and keeps its hunks', () => {
  const diff = parseDiff(
    JSON.stringify({
      before: { path: 'old.rs', language: 'Rust', hunks: [{ operation: 'delete', range: {} }] },
      after: { path: 'new.rs', language: 'Rust', hunks: [] },
      large_residual: false,
      summary: 'comment_only',
    })
  );
  assert.equal(diff.before.hunks.length, 1);
  assert.equal(diff.summary, 'comment_only');
});

test('a binary-file answer parses - it is a valid diff, not an error', () => {
  const diff = parseDiff(
    JSON.stringify({
      before: { path: 'a.pdf', language: null, hunks: [] },
      after: { path: 'b.pdf', language: null, hunks: [] },
      large_residual: false,
      binary: true,
    })
  );
  assert.equal(diff.binary, true);
});

test('non-JSON output names the likely cause instead of throwing a SyntaxError', () => {
  assert.throws(() => parseDiff('error: unexpected argument\n'), (error: unknown) => {
    assert.ok(error instanceof CodeDiffError);
    assert.match((error as Error).message, /--mode json/);
    return true;
  });
});

test('JSON of the wrong shape is rejected at the boundary, not deep in the decoration code', () => {
  assert.throws(() => parseDiff('[]'), CodeDiffError);
  assert.throws(() => parseDiff('null'), CodeDiffError);
  assert.throws(() => parseDiff('{"before":{"hunks":[]}}'), CodeDiffError);
  assert.throws(() => parseDiff('{"before":{"hunks":[]},"after":{}}'), CodeDiffError);
});
