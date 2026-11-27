# Contributing

Use Node.js 22 or later. Install the development dependencies and enable the commit-message hook for this checkout.

```sh
npm ci
npm run hooks:install
npm run check
```

`npm run check` runs type checks, behavior tests, and a setup and uninstall using a locally unpacked release archive. CI runs the same checks on Linux, macOS, and Windows with Node.js 22 and 24. The macOS Node.js 24 job also installs Jujutsu for its integration test.

## Pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit subjects and PR titles. For example, `fix(setup): preserve an existing status line` describes a fix with a scope. A `!` before the colon or a `BREAKING CHANGE:` footer marks a breaking change.

Describe user-visible changes under `## [Unreleased]` in `CHANGELOG.md`, using the section names from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Open PRs against `main` and wait for the `CI verify` check. It includes the test matrix, the PR title, and the branch's commit subjects. Squash merge uses the PR title as the commit subject. When using the CLI, wait for the checks before merging.

```sh
gh pr checks --watch
gh pr merge --squash
```

## Releases

Update the version in `package.json` and `package-lock.json` in a release PR. For example, `npm version 0.5.0 --no-git-tag-version` prepares both files. In the same PR, turn the `## [Unreleased]` section of `CHANGELOG.md` into `## [0.5.0] - YYYY-MM-DD` with the release date, add an empty `## [Unreleased]` section above it, and update the comparison links at the end of the file. Squash merge the PR once CI passes, then tag the matching commit on `main`.

```sh
git switch main
git pull --ff-only
git tag -a v0.5.0 -m 'v0.5.0'
git push origin v0.5.0
```

The Release workflow runs the test matrix, verifies that the tagged commit is on `main`, the tag matches the package version, and `CHANGELOG.md` documents that version, then creates a GitHub Release with the notes from the matching changelog section, the npm tarball and its SHA-256 checksum. A matching prerelease tag such as `v0.5.0-rc.1` creates a GitHub prerelease with the `Unreleased` notes. Run the Release workflow manually from `main` to run the same checks and build the assets without publishing. Package distribution uses [GitHub Releases](https://github.com/JS-banana/agy-hud/releases).
