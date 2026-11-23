# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-24

### Added

- Configurable status line for the Antigravity CLI with `default`, `compact`, and `activity` layouts, automatic adaptation to narrow terminals, and English, Simplified Chinese, and Traditional Chinese labels
- Context usage plus 5-hour and weekly quota bars with warning thresholds, reset countdowns, and separate buckets for Gemini, third-party, and dedicated models
- Session cost with local estimates at standard API rates, optional daily and weekly totals, and cache statistics
- Live tools, Skills, MCP calls, and subagent activity, plus optional Antigravity hooks
- Active model, agent mode, Git branch and change statistics, and optional Jujutsu (`jj`) support
- Guided `setup` wizard and the `init`, `config`, `install`, `uninstall`, `doctor`, `report`, `preview`, and `hooks` commands, with automatic backup and restore of an existing status line
- JSON Schema for editor validation and an installable `agy-hub` Agent skill for plain-language configuration

[Unreleased]: https://github.com/JS-banana/agy-hub/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JS-banana/agy-hub/releases/tag/v0.4.0
