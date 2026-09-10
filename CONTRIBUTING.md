# Contributing to CodeDiff for VS Code

This extension is a thin client. It shells out to the
[codediff](https://github.com/ivankovic/codediff) binary and paints what comes back; every
interesting decision about *what* a diff says lives in that repository. A bug about a diff being
wrong belongs there. A bug about a highlight landing in the wrong place, a command misbehaving, or
an error message being unhelpful belongs here.

## Getting started

```sh
npm ci
npm run compile        # or: npm run watch
npm run lint
npm test
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the extension loaded.
You need a `codediff` binary on `PATH` to do anything useful in it.

## The three checks CI gates on

```sh
npx tsc -p ./ --noEmit   # types
npm run lint             # eslint
npm test                 # compile + node --test
```

CI additionally runs `vsce package`, which catches a broken manifest or a `.vscodeignore` that
excludes something the extension needs — neither of which the other three can see.

## Architecture, and why it is split this way

| File | Imports `vscode`? | Why |
| --- | --- | --- |
| `src/columns.ts` | no | Imports **nothing**. Byte → UTF-16 conversion. |
| `src/codediff.ts` | no | Spawning and JSON validation. |
| `src/git.ts` | no | `rev-parse` / `git show`, and writing a blob out under its real basename. |
| `src/binary.ts` | no | Which `codediff` to run: setting → bundled → `PATH`. |
| `src/decorations.ts` | yes | Hunks → `TextEditorDecorationType`. |
| `src/extension.ts` | yes | Commands and editor glue. |

The split is not decoration. Testing a VS Code extension normally means downloading a whole VS Code
and running an editor host, which is slow enough that people stop doing it. Keeping the two modules
that carry the real logic free of `vscode` means their tests run under plain `node --test` in under
a second — so they run on every commit, and on every Node version the extension host might use.

**Keep new logic out of the two `vscode`-importing files** wherever it can go elsewhere. If
something needs an editor, the usual answer is a pure function next door that takes the data it
needs, plus three lines in `extension.ts` that fetch it.

## Tests

`src/test/columns.test.ts` is the one to be careful with. codediff reports **byte** columns; VS
Code wants **UTF-16 code units**. They are identical on any all-ASCII line, so a broken conversion
passes every casual test and then mis-highlights every line containing an accent, an ideograph or
an emoji. The suite covers two-byte, three-byte and astral characters, out-of-range clamping,
mid-character rounding, and a per-byte-offset agreement check against `Buffer.byteLength` across a
mixed line. Do not delete those for being slow — the whole file runs in milliseconds.

**Running it drops a `.codediff.toml` in this checkout.** codediff stores its settings in a
dotfile in whatever directory it runs in — there is no user-level config yet — so any invocation
from here leaves one behind. It is in `.gitignore` and `.vscodeignore`; delete it freely, and do
not commit it.

`src/test/git.test.ts` builds a real throwaway repository in a temp directory and, unlike the
integration test below, does **not** skip when its dependency is missing: git is a hard requirement
of the commands it covers, so a machine without it should fail here rather than quietly pass. Two of
its cases exist for reasons that are easy to undo by accident — `git show` output is read as a
`Buffer` because decoding it as UTF-8 corrupts any file that is not UTF-8, and the materialised file
keeps its original basename because codediff's language detection reads the path.

`src/test/integration.test.ts` runs the real binary and **skips itself when codediff is not on
`PATH`**, which includes CI. It is a local-development check, not a gate: installing codediff in CI
would add minutes of Rust compilation to every run for one assertion the unit tests already cover
apart from the spawn. Run it locally before touching anything about spawning or JSON handling.

## Style

* Every source file carries the AGPL header. Copy it from an existing file when adding one.
* Comments explain *why*, not *what*. The main codediff repository's
  [`CONTRIBUTING.md`](https://github.com/ivankovic/codediff/blob/main/CONTRIBUTING.md) sets the
  house style and it applies here too.
* No `any`, and no `as SomeType` to silence the compiler on data that came from outside the
  process. `parseDiff` validates codediff's output at the boundary precisely so that nothing
  downstream has to guess.

## Bundling the binary

`scripts/fetch-binary.mjs <vsce-target>` downloads the codediff release pinned by
`codediffVersion` in package.json into `bin/`, verifying it against that release's
`SHA256SUMS.txt`. `bin/` is gitignored — it is a build input, not source.

Two things here are easy to get wrong and are checked rather than assumed:

* **The execute bit.** A VSIX is a ZIP, and ZIP carries Unix mode bits only if the writer sets
  them; `vsce` does not reliably. A binary that lands without `+x` fails at spawn with `EACCES` on
  the user's machine long after CI was green. `ensureExecutable` chmods at activation *and*
  `release.yml` reads the mode back out of the packaged VSIX — the first masks a broken package,
  only the second proves a good one.
* **VS Code's target names are not Rust triples.** `linux-x64` ↔ `x86_64-unknown-linux-gnu`, and so
  on. The mapping lives in `scripts/fetch-binary.mjs`; a test asserts the release workflow's matrix
  and that table list the same targets, because a target in one but not the other either fails the
  build or silently stops publishing a platform.

The pinned version is `v0.0.13`, which does not exist yet: v0.0.12 predates both the
`SHA256SUMS.txt` job and the `aarch64-unknown-linux-gnu` target in codediff's release workflow.
Until that release is cut, `fetch-binary` fails with a 404 — deliberately, rather than quietly
producing a VSIX with no binary.

CI builds only the binary-free fallback VSIX, so a pull request never depends on a published tag of
another repository. The five platform VSIXs are built in `release.yml`, on a tag.

## Publishing

Not automated yet, deliberately — it needs credentials this repository does not hold.

* `vsce publish` → Visual Studio Marketplace (needs an Azure DevOps publisher and a PAT).
* `ovsx publish` → Open VSX, which is what VSCodium, Cursor and Windsurf install from. Skipping it
  cuts out a real share of users for one extra step.

Both should become a release workflow once the publisher accounts exist.

## Licence

By contributing you agree that your contributions are licensed under AGPL-3.0-or-later, the same
licence as [`LICENSE`](LICENSE) and as codediff itself.
