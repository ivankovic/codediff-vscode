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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

/** The two sides of the fixture below: four functions reordered, and one identifier renamed. */
const BEFORE_SOURCE = `import math


def area(width, height):
    return width * height


def perimeter(width, height):
    return 2 * (width + height)


def label(name):
    return "ααα" + name + "ααα"


def diagonal(width, height):
    return math.sqrt(width * width + height * height)
`;

const AFTER_SOURCE = `import math


def diagonal(width, height):
    return math.sqrt(width * width + height * height)


def label(name):
    return "ααα" + caption + "ααα"


def area(width, height):
    return width * height


def perimeter(width, height):
    return 2 * (width + height)
`;

/**
 * codediff resolves its own configuration from the nearest `.codediff.toml` at or above its
 * working directory, so with `mode` left at `default` - where the whole point is to defer to that
 * configuration - the working directory decides which render options apply, and therefore which
 * hunks come back. Before `runDiff` took a `cwd` it inherited the extension host's, which is
 * wherever VS Code happened to be started from: the painting shown for one pair of files differed
 * between two launches of the same window.
 *
 * The two configurations are all six render options off against all six on, not one field flipped:
 * measured against codediff 0.0.12, `paint_displaced_moves` is the only one that changes this
 * fixture *from an all-off baseline* - it is what makes the ` + "ααα"` trailing the renamed
 * identifier a move hunk of its own rather than nothing - but turning only that one off again from
 * an all-on baseline leaves the hunk there, because another option covers the same ground. A
 * single-field difference would therefore pass whether or not `cwd` was honoured at all.
 *
 * Asserted as "one paints more than the other" rather than against fixed counts, because the exact
 * painting is codediff's business and moves between releases; that the working directory decides
 * which of the two applies is the part that belongs to this extension.
 */
test(
  'the working directory selects the codediff configuration',
  { skip: codediffAvailable() ? false : 'codediff not on PATH' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codediff-vscode-cwd-'));
    const before = join(dir, 'before.py');
    const after = join(dir, 'after.py');
    writeFileSync(before, BEFORE_SOURCE, 'utf8');
    writeFileSync(after, AFTER_SOURCE, 'utf8');

    const off = join(dir, 'off');
    const on = join(dir, 'on');
    for (const [directory, enabled] of [
      [off, false],
      [on, true],
    ] as const) {
      mkdirSync(directory);
      writeFileSync(
        join(directory, '.codediff.toml'),
        [
          '[render_options]',
          `leading_whitespace = ${enabled}`,
          `structural_punctuation = ${enabled}`,
          `whole_pair_updates = ${enabled}`,
          `paint_reindent_only_moves = ${enabled}`,
          `paint_displaced_moves = ${enabled}`,
          `paint_resized_moves = ${enabled}`,
          '',
        ].join('\n'),
        'utf8'
      );
    }

    const without = await runDiff('codediff', before, after, 'default', off);
    const painted = await runDiff('codediff', before, after, 'default', on);

    assert.ok(
      painted.after.hunks.length > without.after.hunks.length,
      `expected the all-on configuration to paint more: ${painted.after.hunks.length} vs ${without.after.hunks.length}`
    );
  }
);
