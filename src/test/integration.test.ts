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
 * The one test that runs the real binary, end to end: spawn codediff, parse its JSON, convert its
 * byte column, and land on the right character.
 *
 * **Skipped when codediff is not on PATH**, which includes CI unless it installs one - building it
 * takes minutes (every tree-sitter grammar compiles from C, under `lto = "fat"`). That makes this a
 * local-development check rather than a gate, and `node --test` reports it as skipped rather than
 * passing silently. Everything it covers except the spawn itself is also covered by the pure unit
 * tests next door, which do gate.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { byteColumnToUtf16 } from '../columns';
import { runDiff } from '../codediff';

function codediffAvailable(): boolean {
  try {
    execFileSync('codediff', ['--help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test(
  'a real diff of a non-ASCII line lands on the right character',
  { skip: codediffAvailable() ? false : 'codediff not on PATH' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codediff-vscode-'));
    const before = join(dir, 'before.py');
    const after = join(dir, 'after.py');
    // Three two-byte characters before the change, so a byte column and a UTF-16 column disagree.
    writeFileSync(before, 'x = "ααα" + aaa\n', 'utf8');
    writeFileSync(after, 'x = "ααα" + bbb\n', 'utf8');

    const diff = await runDiff('codediff', before, after);
    const hunk = diff.after.hunks[0];
    assert.ok(hunk, 'expected at least one hunk on the after side');

    const line = 'x = "ααα" + bbb';
    const column = byteColumnToUtf16(line, hunk.range.start_column);
    assert.equal(line.slice(column, column + 3), 'bbb');
    // The raw byte column would be 15 and would land three characters late.
    assert.notEqual(column, hunk.range.start_column);
  }
);
