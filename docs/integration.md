# Antigravity integration

AGY Hub renders one frame each time `agy` supplies status line data. The default view uses the payload and local Git information. Tool activity, additional probes, and local recording are optional. Available fields vary with the `agy` version. [Antigravity status line documentation](https://antigravity.google/docs/cli/statusline/)

## Data sources

| Display | Source and limits |
| --- | --- |
| Model, context, and quota | The `agy` status line payload supplies these values. Quota typically refreshes at the end of a turn or when you run `/usage`. Gemini, third-party models, and dedicated quotas have separate buckets. Balance-based quotas show the numeric balance. If both short-window and weekly quotas are present, a threshold, balance, or warning can make the weekly quota visible. |
| Git and Jujutsu | Local repositories and the corresponding VCS commands. Git supports working tree changes and worktrees. Jujutsu reads its recorded working copy state. |
| Tools, skills, and MCP | The current session log and optional tool hooks. When the log grows, AGY Hub checks fixed head and tail boundary digests (up to 8 KiB) before parsing only new lines. If the file was truncated, replaced, or rewritten, it rebuilds from the last 8 MiB. Skill and MCP classification depends on recognizable markers or tool names. |
| Subagents | The name, model, role, and status supplied by `agy`. The tested `agy 1.5.14` payload omitted subagent timing and reasoning effort. |
| Session, mode, and tasks | Session tokens, current turn cache data, background tasks, and artifact counts come from `agy`. Mode comes from the first populated field among `cycle_mode`, `mode`, and `agent_mode`. Session duration, last reply time, and throughput depend on logs or hooks. The public payload lacks exact cache expiration and background task details. |
| Cost, memory, and config counts | Session cost uses the reported amount when available. Memory and config counts come from the local system and files. |

OSC 8 file links depend on support in `agy` and the terminal. Installation and VCS probes currently support macOS and Linux.

## Session cost estimates

`display.showCost` displays `cost.total_usd` when `agy` supplies it, including an explicit zero. When the amount is missing, AGY Hub can estimate the cost in US dollars from cumulative input and output tokens and known model rates. It marks estimates with `≈` and displays very small amounts as `<$0.0001`. Both token counts must be available.

The estimate uses the current model and rate for the entire session. The payload does not allow AGY Hub to account for model switches, per-request pricing tiers, cache discounts, or subagent costs. Daily and weekly cost tracking counts increases in the reported `agy` amount. [Antigravity status line documentation](https://antigravity.google/docs/cli/statusline/)

The bundled rates use published standard text API pricing. Gemini 3.1 Pro uses the lower standard tier, and announced Gemini rate changes take effect on their published dates in UTC. Check the provider for subscription limits and billed amounts. [Gemini API pricing](https://aistudio.google.com/docs/pricing) · [Gemini 3.7 Flash announcement](https://antigravity.google/blog/gemini-3-7-flash-in-google-antigravity/) · [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Claude 3.7 Sonnet announcement](https://www.anthropic.com/news/claude-3-7-sonnet)

## Optional hooks

From the root of your AGY Hub copy, run `node src/cli.js hooks` and merge the output's `agy-hub` entry into `.agents/hooks.json` in the workspace. Keep any existing entries you still use. Hooks add workspace paths, pair tool start and completion events, and let AGY Hub estimate output speed for an invocation. Regenerate the entry after an upgrade if the command path changes. Remove the entry to disable the hooks. [Antigravity hooks documentation](https://antigravity.google/docs/hooks)

Hooks retain workspace paths, tool names, relevant filenames, and invocation timing. AGY Hub caches tool summaries for a session and rereads source events when they change. Log-only tool counts can undercount when logs are truncated or other events interrupt tool responses. If the beginning of a log is missing, AGY Hub can use a hook record for the session start.

## Local data and diagnostics

- Cost totals, hook metadata, transcript cursors, and preview frames live in `~/.gemini/antigravity-cli/agy-hub-data/` by default. Set `AGY_HUB_DATA_DIR` to change the location. When a display feature reads a transcript, its per-conversation cursor stores the file identity, byte offset, tool names and counts, pending or running tool filenames, and model, timing, and token data for the HUD.
- After enabling `display.recordPreview`, run `node src/cli.js preview --last` from the AGY Hub copy to render the most recent recorded frame with the current configuration. The recording substitutes project paths, branch names, session titles, and email addresses. It retains rendering data such as the model, quota, and activity.
- `node src/cli.js doctor` shows local configuration paths and integration status. `node src/cli.js report` produces a concise diagnostic summary that omits paths, account information, quota values, and log contents.
- To share quota snapshots between local processes, set `display.externalUsagePath` and `display.externalUsageWritePath`. When a native window expires at a known reset time, AGY Hub discards observations from before that reset. An unexpired snapshot from the same pool can supply a replacement if it was observed at or after the reset and falls within `display.externalUsageFreshnessMs`.
- To show the first output line of a local command, append `--extra-cmd 'your local command'` to the installed binding and set `AGY_HUB_ALLOW_EXTRA_CMD=1`. AGY Hub preserves this argument when it refreshes a binding that uses the standard form.

## Verified behavior

- An authenticated interactive `agy 1.5.14` session updated the remaining quota, reset time, and usage row. A controlled file read produced a `DONE` event and displayed `✓ Read`. The built-in research subagent went from `◐` to `✓`.
- `agy -p /hooks --output-format json` discovered all five hooks. A live read-only turn recorded the workspace and `--add-dir` paths, invocation timing, and successful tool events. Two event types can write the workspace record, so `SessionStart` was not verified independently.
- The same `agy` version discovered the packaged skill. Its interactive terminal offered `/agy-hub` autocomplete and reloaded the skill with `/skills reload`. The CLI tests cover preview, save, and undo. The full natural language configuration flow remains unverified.
- Git and Jujutsu were exercised with temporary repositories. The `jj` 0.47.1 test confirmed that status checks did not snapshot the working copy.
