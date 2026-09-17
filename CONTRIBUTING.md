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

`make check` runs all four in that order, and is what `make deploy` gates on. The `vsce` half
needs Node 22; see [Releasing](#releasing).

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

The pinned version is `v0.0.13`, and it now carries everything `fetch-binary` needs: a
`SHA256SUMS.txt` and all five archives, `aarch64-unknown-linux-gnu` among them. v0.0.12 predates
both, so pinning back to it would 404 — which is the designed failure, rather than quietly
producing a VSIX with no binary.

CI builds only the binary-free fallback VSIX, so a pull request never depends on a published tag of
another repository. The five platform VSIXs are built in `release.yml`, on a tag.

**The jobs that run `vsce` are pinned to Node 22, not the 20 the rest of CI uses**, because
`@vscode/vsce` declares `engines: node >= 22`. npm only warns about an engine mismatch, so those
jobs ran on 20 and worked by luck: vsce 4 calls `util.styleText`, which recent 20.x happens to
carry and 18 does not.

The test matrix is [18, 20, 22] — the extension host's Node, which is a different question from the
packaging tool's, but which now has to include 22 for a reason of its own: `node --test <directory>`
means "run that path as a file" there, not "every test file under it". `npm test` names the files
with a glob instead. On a [18, 20] matrix that break was invisible, and it is the failure mode to
expect from the test runner generally — it is the one part of Node that is still changing shape.

## The icon

`icon.png` is generated: `python3 assets/icon.py` redraws it. Recolouring or resizing it is an edit
to that script, not to a binary, and the reasoning behind the design — including which richer
pictures were tried and discarded for being illegible at 32px — is in its docstring.

## Releasing

`make deploy` is the whole of it. It refuses a dirty tree, refuses a HEAD that does not match
`origin/main`, refuses a version that is already tagged or that `CHANGELOG.md` has no section for,
runs the four gates, and then tags `v<version>` and pushes the tag. It publishes nothing itself.

The tag is what starts a release. `release.yml` builds the five platform VSIXs and the target-less
fallback, attaches all six to a GitHub Release, and publishes those same six files to the
Marketplace and to Open VSX.

**Publishing the files CI built, rather than repackaging, is the point of that split.** The two
checks that matter — the execute bit surviving into the archive, and the fallback carrying no
binary — only ever ran on CI's artefacts, so those are the artefacts that should reach users.

The version number is the one irreversible part. A Marketplace version can never be republished or
reused, only superseded, which is why `deploy-checks` would rather fail on a missing changelog
section than let a number through.

### Credentials, once

The two registries authenticate differently, and only Open VSX uses a token.

**The Marketplace — Microsoft Entra ID, no token.** Azure DevOps retires *global* personal access
tokens on **2026-12-01**, and a global PAT — the "All accessible organizations" kind — is the only
sort the Marketplace has ever accepted. Organization-scoped tokens are not accepted for publishing;
[microsoft/vscode#322741](https://github.com/microsoft/vscode/issues/322741) is the open request to
change that. So the PAT route has an expiry date on it and is not worth setting up. Entra with
workload identity federation is what replaces it, and it stores no secret at all: `azure/login`
trades the workflow's own OIDC token for a short-lived one at run time.

1. A **user-assigned managed identity** in the Azure portal. Not an app registration — those
   authenticate fine and then fail at publish with `InvalidAccessException: The requested operation
   is not allowed`. Record its **Client ID** and **Tenant ID**.
2. On that identity, **Settings → Federated credentials → Add**, scenario *GitHub Actions deploying
   Azure resources*. Entity type **Environment** (not Branch, not Tag), organisation `ivankovic`,
   repository `codediff-vscode`, environment name `marketplace-publish` — which is exactly what
   `publish-marketplace` declares as its `environment:`. The two must agree or Entra will not
   exchange the token.
3. **Register the identity with Azure DevOps once**, by signing in as it and calling the profile
   API. This is the step with no substitute:

   ```sh
   az login --identity            # or however you authenticate as that identity
   az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

   Keep the `id` from the response. **That is the only identifier the publisher's member search
   recognises** — the Client ID, the Tenant ID and the resource ID all fail to find anything.
4. A publisher at <https://marketplace.visualstudio.com/manage> whose ID is `ivankovic`, matching
   `publisher` in `package.json` (the ID cannot be changed afterwards), then add that `id` as a
   member with the **Contributor** role.
5. Add the Client ID and Tenant ID as the `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` repository
   secrets. They are identifiers rather than credentials, but the job checks both are non-empty
   before it starts, because an unset one is an empty string and fails later inside an OIDC
   exchange whose error names nothing useful.

**`OVSX_PAT`** — Open VSX, which is what VSCodium, Cursor and Windsurf install from:

1. An Eclipse Foundation account, with the publisher agreement signed.
2. A token from <https://open-vsx.org/user-settings/tokens>, added as the `OVSX_PAT` secret.
3. The namespace is created by the workflow itself — `ovsx create-namespace ivankovic` runs on
   every release and is expected to fail after the first.

### Doing it by hand

If a publish job fails and you would rather finish it locally, publish the artefacts from the
GitHub Release rather than building new ones:

```sh
az login                                  # as the identity, or as yourself if you are a publisher member
vsce publish --skip-duplicate --azure-credential --packagePath *.vsix
ovsx publish --skip-duplicate --packagePath *.vsix -p "$OVSX_PAT"
```

`--packagePath` is variadic — one flag, many paths — which is how the six builds land as one
version. `--skip-duplicate` steps over whatever the failed job already published; it is safe here
precisely because nothing else can make this command run twice on one version.
`--azure-credential` is what makes `vsce` read the Entra token `az login` left behind rather than
look for a `VSCE_PAT` that no longer exists.

If a publish got far enough to be *partly* wrong rather than partly done — a bad README, the wrong
binary in a target — the answer is a new version, not a retry. A Marketplace version can be
superseded and never replaced, and `deploy-checks` cannot see that: it knows about local tags, not
about what is live.

`make package-all` reproduces all six locally when a build job is the thing that broke. It needs
Node 22 — as does anything running `vsce` — and it deletes `bin/` afterwards, because a stale
`bin/` is how a glibc binary ends up inside the fallback VSIX that musl users are served.

## Licence

By contributing you agree that your contributions are licensed under AGPL-3.0-or-later, the same
licence as [`LICENSE`](LICENSE) and as codediff itself.
