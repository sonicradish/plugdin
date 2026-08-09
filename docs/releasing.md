# Releasing

How a version of pluggedin gets from `main` to npm. Two workflows do the work:

- **[.github/workflows/ci.yml](../.github/workflows/ci.yml)** — typecheck, test, and build on
  every push to `main` and every pull request, against Node 20 and 22 (the range
  `package.json`'s `engines` claims to support).
- **[.github/workflows/publish.yml](../.github/workflows/publish.yml)** — publishes to npm when
  a GitHub Release is published.

## One-time setup

The package does not exist on the registry yet, and npm cannot register a trusted publisher
for a package that has never been published. So the first release is manual and every release
after it is automated.

### 1. First publish, by hand

```bash
npm login
npm publish --access public
```

`prepublishOnly` builds and runs the test suite first, so a broken tree can't reach the
registry. Confirm it landed:

```bash
npm view pluggedin version
```

### 2. Register the trusted publisher

On npmjs.com, go to the package → **Settings** → **Trusted Publisher** → GitHub Actions, and
enter:

| Field | Value |
|---|---|
| Organization or user | `sonicradish` |
| Repository | `pluggedin` |
| Workflow filename | `publish.yml` |
| Environment | *(leave blank)* |

That's the whole credential story — there is no `NPM_TOKEN` secret in this repo, and nothing
to rotate. npm mints a short-lived token from the OIDC identity GitHub gives the workflow run,
and only for runs of that exact workflow file in that exact repository.

**Renaming `publish.yml` breaks publishing** until the trusted publisher entry is updated to
match. Same for moving the repo to a different org.

## Cutting a release

1. Bump the version and tag it:

   ```bash
   npm version patch     # or minor / major — writes package.json and creates a v0.2.1 tag
   git push --follow-tags
   ```

2. Create a GitHub Release against that tag, write the notes, and publish it. Either from the
   Releases UI, or:

   ```bash
   gh release create v0.2.1 --generate-notes
   ```

3. `publish.yml` fires on `release: published`. It checks that the release tag matches
   `package.json`'s version (a mismatch fails the run before anything is published), then runs
   `npm publish --provenance`.

Publishing the Release is the approval gate — pushing the tag alone does nothing. Drafting a
release without publishing it doesn't trigger anything either, so you can stage notes freely.

## Provenance

Because the workflow requests `id-token: write` and publishes with `--provenance`, npm records
a signed attestation tying the tarball to this repository, this commit, and this workflow run.
The package page shows the provenance badge, and anyone can verify it:

```bash
npm audit signatures
```

## Troubleshooting

**`ENEEDAUTH` or `401` in the publish job** — the trusted publisher entry doesn't match the
run. Check the repo owner, repo name, and workflow filename against the table above.

**`403 You cannot publish over the previously published versions`** — the version in
`package.json` is already on the registry. Bump it, re-tag, and cut a new release; npm never
allows overwriting a published version.

**The tag-check step fails** — the release tag and `package.json` disagree. This usually means
`npm version` wasn't run, or a tag was created by hand. Fix `package.json`, or delete the tag
and release and redo step 1.

**Trusted publishing errors mentioning the npm version** — OIDC needs npm ≥ 11.5.1. The
workflow installs `npm@latest` before publishing for exactly this reason; don't drop that step.
