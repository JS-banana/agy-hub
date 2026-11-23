# Contributing

Use Node.js 22 or later. Install the development dependencies and enable the commit-message hook for this checkout.

```sh
npm ci
npm run hooks:install
npm run check
```

`npm run check` runs type checks, behavior tests, and a packaged install and uninstall. CI runs the same checks on Linux and macOS with Node.js 22 and 24. The macOS Node.js 24 job also installs Jujutsu for its integration test.

## Pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit subjects and PR titles. For example, `fix(setup): preserve an existing status line` describes a fix with a scope. A `!` before the colon or a `BREAKING CHANGE:` footer marks a breaking change.

Open PRs against `main` and wait for the `CI verify` check. It includes the test matrix, the PR title, and the branch's commit subjects. Squash merge uses the PR title as the commit subject. When using the CLI, wait for the checks before merging.

```sh
gh pr checks --watch
gh pr merge --squash
```

## Releases

Update the version in `package.json` and `package-lock.json` in a release PR. For example, `npm version 0.5.0 --no-git-tag-version` prepares both files. Squash merge the PR once CI passes, then tag the matching commit on `main`.

```sh
git switch main
git pull --ff-only
git tag -a v0.5.0 -m 'v0.5.0'
git push origin v0.5.0
```

The Release workflow runs the test matrix, verifies that the tagged commit is on `main` and the tag matches the package version, then creates a GitHub Release with generated notes, the npm tarball and its SHA-256 checksum. A matching prerelease tag such as `v0.5.0-rc.1` creates a GitHub prerelease. Run the Release workflow manually from `main` to check the build without publishing. Package distribution uses [GitHub Releases](https://github.com/JS-banana/agy-hub/releases).
