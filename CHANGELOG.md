# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Renamed the project from AGY Hub to AGY HUD (`agy-hud`). Commands, the `/agy-hud` skill, `AGY_HUD_*` environment variables, and configuration and data paths use the new name only. To upgrade from 0.5.0 or earlier, run `uninstall` (and `skill uninstall` if installed) with the old version, update any `agy-hub` entry in `.agents/hooks.json` with `hooks`, then install this version.

## [0.5.0] - 2026-11-25

### Changed

- Faster status line refreshes reuse a per-conversation transcript cursor with bounded boundary verification and run VCS, memory, and extra-command probes concurrently

### Fixed

- Quota windows expire at their known reset time, discarding pre-reset external snapshots while preserving valid sibling windows and allowing fresh snapshots to replace expired native windows
- Extra-command probes ignore `stderr` so noisy diagnostic output no longer drops valid `stdout` labels

## [0.4.0] - 2026-11-24

### Added

- Configurable status line for the Antigravity CLI with `default`, `compact`, and `activity` layouts, automatic adaptation to narrow terminals, and English, Simplified Chinese, and Traditional Chinese labels
- Context usage plus 5-hour and weekly quota bars with warning thresholds, reset countdowns, and separate buckets for Gemini, third-party, and dedicated models
- Session cost with local estimates at standard API rates, optional daily and weekly totals, and cache statistics
- Live tools, Skills, MCP calls, and subagent activity, plus optional Antigravity hooks
- Active model, agent mode, Git branch and change statistics, and optional Jujutsu (`jj`) support
- Guided `setup` wizard and the `init`, `config`, `install`, `uninstall`, `doctor`, `report`, `preview`, and `hooks` commands, with automatic backup and restore of an existing status line
- JSON Schema for editor validation and an installable `agy-hub` Agent skill for plain-language configuration

[Unreleased]: https://github.com/JS-banana/agy-hud/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/JS-banana/agy-hud/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/JS-banana/agy-hud/releases/tag/v0.4.0
