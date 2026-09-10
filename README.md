# CodeDiff for VS Code

[![CI](https://github.com/ivankovic/codediff-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/ivankovic/codediff-vscode/actions/workflows/ci.yml)
[![License: AGPL v3+](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)

Syntax-aware diff highlighting in VS Code, backed by the
[codediff](https://github.com/ivankovic/codediff) CLI.

Instead of aligning two files line by line, codediff parses both sides with tree-sitter and matches
their syntax trees, so a change is reported as what it structurally is — an **insertion**,
**deletion**, **update**, or **move** — rather than as whichever lines happened to line up. This
extension paints that verdict onto real editors as decorations.

## Status

Early, but complete enough to use. Everything below the editor — spawning codediff, parsing its
output, converting its byte columns, reading blobs out of git — is covered by tests that run in CI.
The editor glue itself (decorations, menus, prompts) has no automated coverage, because none of it
can run outside a VS Code host; treat those parts as reviewed rather than proven.

| | |
| --- | --- |
| Diff two files from disk | ✅ works |
| Insert / delete / update / move highlighting | ✅ works |
| "Moved to line N" on hover | ✅ works |
| Correct columns on non-ASCII lines | ✅ works, and tested |
| Diffing against a git revision, from the SCM view | ✅ works |
| Diffing the working copy against the last save | ✅ works |
| Install prompt when the binary is missing | ✅ works |
| Bundled binary | ❌ not implemented — codediff must be on `PATH`. Shipping one would mean a VSIX per platform. |

## Requirements

The `codediff` binary, on `PATH` or pointed at by the `codediff.binaryPath` setting. See
[codediff's installation instructions](https://github.com/ivankovic/codediff#installation) —
`cargo install codediff`, a pre-built binary from a release, `nix run github:ivankovic/codediff`, or
one of the distribution packages.

The extension shells out to it and never bundles it.

## Usage

| Command | What it diffs |
| --- | --- |
| `CodeDiff: Diff Two Files…` | Two files you pick. |
| `CodeDiff: Diff With HEAD` | The committed version against your working copy. |
| `CodeDiff: Diff With Revision…` | Any ref `git show` accepts — a branch, a tag, `HEAD~3` — against your working copy. |
| `CodeDiff: Diff With Last Saved` | What is on disk against what you have typed but not saved. |
| `CodeDiff: Clear Highlights` | Removes the painting from every visible editor. |

The three git-aware commands are also on the right-click menu of a file in the **Source Control**
view and of an editor tab. In every one of them the left pane is the *before* side, matching
`codediff.nvim`'s `diff_this`.

Files pulled out of git are written to the extension's own storage directory under their real
basename — `HEAD/parser.ts`, not a scratch name — because codediff picks a tree-sitter grammar from
the path. A blob written to a nameless temp file gets no grammar and silently falls back to a plain
line diff. They are swept a day later, at the next activation.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codediff.binaryPath` | `codediff` | Path to, or name of, the binary. Looked up on `PATH` when it is a bare name. |
| `codediff.renderMode` | `default` | `default` uses whatever codediff has persisted in its own config; `minimal` and `full` pass `--minimal`/`--full` and override it. |

## Colours

Every highlight is a `ThemeColor` reference, not a literal, so it sits correctly in light, dark and
high-contrast themes without this extension shipping a palette of its own:

| Operation | Theme colour |
| --- | --- |
| insert | `diffEditor.insertedTextBackground` |
| delete | `diffEditor.removedTextBackground` |
| update | `merge.currentContentBackground` |
| move | `editor.symbolHighlightBackground` |

VS Code has no diff colour of its own for "updated" or "moved", so those two are the closest
theme-defined stand-ins. Override them in your theme or in `workbench.colorCustomizations` as you
would any other.

## How it works

`codediff --mode json BEFORE AFTER` prints one JSON object describing each side's changed ranges,
their operation, a move's real counterpart range in the other file, and the nearest enclosing
declaration. This extension parses that and calls `setDecorations`; it never parses ANSI escapes
out of a terminal diff tool.

**codediff reports columns as byte offsets. VS Code's `Position.character` is UTF-16 code units.**
They agree exactly while a line is all-ASCII and diverge the moment it is not — which is what makes
this the easiest thing in the whole integration to get wrong. Measured against the real binary: for
the line `x = "ααα" + bbb`, codediff reports column 15 where VS Code needs 12. `src/columns.ts`
does the conversion, and `src/test/columns.test.ts` pins it against `Buffer.byteLength` at every
byte offset of a mixed ASCII/Latin-1/CJK/emoji line.

(Neovim needs no such conversion — `nvim_buf_set_extmark` takes byte columns directly — which is
why codediff emits bytes rather than a second coordinate space it could disagree with itself about.
See [codediff.nvim](https://github.com/ivankovic/codediff.nvim).)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm ci`, then `npm run lint` and `npm test`.

## License

AGPL-3.0-or-later — see [LICENSE](LICENSE), the same licence as
[codediff](https://github.com/ivankovic/codediff) itself.
