# Configuration Reference

AGY HUD works out of the box without a config file. When you customize settings, they are stored in `~/.gemini/antigravity-cli/agy-hud.json` (or the path in `AGY_HUD_CONFIG`).

Only include keys you want to override. Missing or invalid fields fall back to their defaults at runtime, and `config set` / `setup` write atomically with one-step rollback via `config undo`.

## CLI commands

```sh
# Interactive setup wizard (add --configure-only to keep existing statusLine binding)
node src/cli.js setup [--configure-only] [--preset <name>] [--prompt-language <en|zh-Hans|zh-Hant>]

# Preview layouts without modifying files
node src/cli.js preview [--preset <name>] [--set '<JSON patch>'] [--last] [--width <columns>] [--plain]

# Create a sparse config file if none exists yet
node src/cli.js init [--preset <name>]

# Inspect, validate, update, or revert configuration
node src/cli.js config show
node src/cli.js config check
node src/cli.js config path
node src/cli.js config set '{"language":"zh-Hans","display":{"showCost":true}}'
node src/cli.js config undo

# Print config schema metadata or generate an editor JSON Schema
node src/cli.js config schema
node src/cli.js schema --json-schema
```

To enable autocomplete and validation in JSON editors:

```sh
node src/cli.js init
node src/cli.js config schema --json-schema > "$(dirname "$(node src/cli.js config path)")/agy-hud.schema.json"
node src/cli.js config set '{"$schema":"./agy-hud.schema.json"}'
```

## Presets

| Preset | Applied overrides | Description |
| --- | --- | --- |
| `default` | `{}` | Expanded two-row layout: model, project, Git, context, and quota |
| `compact` | `{"lineLayout":"compact"}` | Fits model, context, project, and quota on a single row when space allows |
| `activity` | `{"display":{"showTools":true,"showAgents":true},"showSeparators":true}` | Expanded layout with a divider and live tool/subagent rows |

## Top-level settings

| Key | Default | Values / Notes |
| --- | --- | --- |
| `language` | `"en"` | HUD labels: `"en"`, `"zh-Hans"`, `"zh-Hant"` (aliases: `"zh"`, `"zh-TW"`) |
| `lineLayout` | `"expanded"` | `"expanded"` or `"compact"` |
| `pathLevels` | `1` | `1`–`20` trailing directory segments, or `"full"` |
| `maxWidth` | `null` | `1`–`1000` columns, or `null` to follow the width reported by `agy` |
| `forceMaxWidth` | `false` | Always use `maxWidth` even when the terminal is narrower |
| `showSeparators` | `false` | Insert a horizontal divider before activity rows |
| `elementOrder` | `["project","addedDirs","context","usage","promptCache","cacheHitRate","memory","environment","tools","skills","mcp","agents","sessionTime","tasks"]` | Row order in `expanded` mode. Valid entries also include `"sessionTokens"` and `"cost"`. Omitting entries hides them (except `sessionTokens`, which appends at the end when enabled). |
| `projectLineOrder` | `[]` | Segment order on the project row (`"model"`, `"project"`, `"agent"`, `"sessionName"`, `"version"`, `"extra"`, `"duration"`, `"cost"`, `"speed"`, `"auth"`). Unlisted segments keep their relative order. |

## Version control (`gitStatus` and `jjStatus`)

### `gitStatus`

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Show Git status in recognized repositories |
| `showDirty` | `true` | Append `*` to the branch name when local changes exist |
| `showAheadBehind` | `false` | Show commits ahead/behind the upstream tracking branch |
| `showFileStats` | `false` | Show changed files or counts and line diffs depending on layout |
| `showWorktree` | `false` | Show linked Git worktree name |
| `branchOverflow` | `"truncate"` | `"truncate"` or `"wrap"` on narrow project rows |
| `pushWarningThreshold` | `0` | Ahead count that triggers `colors.warning` (`0` disables) |
| `pushCriticalThreshold` | `0` | Ahead count that triggers `colors.critical` (`0` disables) |

### `jjStatus`

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Show Jujutsu (`jj`) status in `jj` workspaces when `jj` is installed |
| `showDirty` | `true` | Mark recorded changes in the working-copy commit |
| `showConflicts` | `true` | Indicate conflicts in the working-copy commit |

## Display options (`display`)

### Context & quota

| Key | Default | Description |
| --- | --- | --- |
| `showContextBar` | `true` | Show the context progress bar |
| `contextValue` | `"percent"` | `"percent"`, `"tokens"`, `"remaining"`, or `"both"` |
| `contextWarningThreshold` | `70` | Percentage (`0`–`100`) to switch context color to `warning` |
| `contextCriticalThreshold` | `85` | Percentage (`0`–`100`, `>= contextWarningThreshold`) for `critical` color and token breakdown |
| `showTokenBreakdown` | `true` | Show input and cache breakdown when context exceeds the critical threshold |
| `autoCompactWindow` | `null` | Override context capacity for display (`null` uses `agy`'s reported size) |
| `showUsage` | `true` | Show model-group quota when supplied by `agy` |
| `usageBarEnabled` | `true` | Render quota windows as progress bars |
| `usageValue` | `"percent"` | `"percent"` (used) or `"remaining"` |
| `showResetLabel` | `true` | Prefix reset countdowns with the reset label |
| `showModelScopedUsage` | `true` | Show dedicated per-model quota when available |
| `sevenDayThreshold` | `80` | Minimum 5h usage percentage (`0`–`100`) before showing the weekly quota (`0` shows whenever available) |
| `usageThreshold` | `0` | Minimum quota usage percentage (`0`–`100`) before displaying quotas |
| `usagePace` | `false` | Highlight quotas projected to run out before reset |
| `usageCompact` | `false` | Use compact text instead of progress bars for quota windows |
| `timeFormat` | `"relative"` | `"relative"`, `"absolute"`, `"both"`, `"elapsed"`, or `"elapsedAndAbsolute"` |
| `hourCycle` | `"auto"` | `"auto"`, `"h11"`, `"h12"`, `"h23"`, or `"h24"` |
| `showClockSeconds` | `false` | Include seconds in wall-clock timestamps |

### Cost, tokens & throughput

| Key | Default | Description |
| --- | --- | --- |
| `showCost` | `false` | Show session cost from `agy`, or estimate locally (`≈$x.xx`) from standard API rates when omitted |
| `showDailyCost` | `false` | Track and show estimated cost increase since local midnight |
| `showWeeklyCost` | `false` | Track and show estimated cost increase in the configured week |
| `weeklyCostPeriod` | `"quota"` | `"quota"` or weekday (`"monday"` through `"sunday"`) |
| `showSessionTokens` | `false` | Show cumulative input and output tokens for the session |
| `showPromptCache` | `false` | Show current prompt cache token count |
| `showCacheHitRate` | `false` | Show current prompt cache read percentage |
| `showSpeed` | `false` | Estimate output tokens/sec from recorded hook timing |

### Tools, skills, MCP & subagents

| Key | Default | Description |
| --- | --- | --- |
| `showTools` | `false` | Show running tools and completed tool counts |
| `showSkills` | `false` | Show recognized skill activity |
| `showMcp` | `false` | Show recognized MCP tool activity |
| `showAgents` | `false` | Show running and completed subagents |
| `showAgentEffort` | `false` | Show subagent reasoning effort when provided |
| `toolNameMaxLength` | `0` | Truncate tool names to this width (`0` keeps full name) |
| `toolsMaxVisible` | `4` | Maximum completed tools shown (`1`–`20`) |
| `skillsMaxVisible` | `4` | Maximum completed skills shown (`1`–`20`) |

### Model, project, mode & layout

| Key | Default | Description |
| --- | --- | --- |
| `showModel` | `true` | Show the model badge |
| `modelFormat` | `"full"` | `"full"`, `"compact"`, or `"short"` |
| `modelSource` | `"stdin"` | `"stdin"`, `"auto"`, or `"transcript"` |
| `modelOverride` | `""` | Replace the displayed model name with custom text |
| `showEffortLevel` | `false` | Show reasoning effort in the model badge |
| `effortFormat` | `"full"` | `"full"`, `"symbol"`, or `"text"` |
| `showProvider` | `false` | Prefix the model badge with `providerName` |
| `providerName` | `""` | Provider label shown when `showProvider` is `true` |
| `showProject` | `true` | Show the project or workspace directory |
| `showLaunchDir` | `false` | Prefix shortened paths with the launch directory when omitted |
| `showAddedDirs` | `true` | Show additional workspace directories |
| `addedDirsLayout` | `"inline"` | `"inline"` next to project, or `"line"` on a separate row |
| `customLine` | `""` | Custom text appended to or prepended on the project row |
| `customLinePosition` | `"last"` | `"last"` or `"first"` |
| `showAgentState` | `false` | Show agent name, state, operating mode, and sandbox badge |
| `showAgentModeOnly` | `false` | Show only the execution mode (`Auto mode` / `Plan mode`); overrides `showAgentState` |
| `showSessionName` | `false` | Show conversation title when provided by `agy` |
| `showAgyVersion` | `false` | Show the Antigravity CLI version |
| `showTasks` | `false` | Show background tasks and artifact counts |
| `showAuth` | `false` | Show account plan reported by `agy` |
| `showAuthUser` | `false` | Show account name from the reported email |
| `authUserFullEmail` | `false` | Show full email address instead of local-part when `showAuthUser` is `true` |
| `authUserLength` | `8` | Maximum width of the account name (`0` keeps full length) |
| `showDuration` | `false` | Show elapsed conversation duration |
| `showSessionStartDate` | `false` | Show session start time |
| `showLastResponseAt` | `false` | Show timestamp of the last model response |
| `showMemoryUsage` | `false` | Show approximate system memory usage |
| `showConfigCounts` | `false` | Show counts of instructions, rules, MCP servers, and hooks |
| `environmentThreshold` | `0` | Minimum combined config count before `showConfigCounts` renders |
| `showLinks` | `false` | Render OSC 8 terminal hyperlinks for supported paths |
| `mergeGroups` | `[["context","usage"]]` | Adjacent rows allowed to share a line in `expanded` mode (`[]` disables merging) |
| `rightAlign` | `[]` | Elements that start a right-aligned group in a merged row |

### Diagnostics & external snapshots

| Key | Default | Description |
| --- | --- | --- |
| `recordPreview` | `false` | Save sanitized render frames locally for `node src/cli.js preview --last` |
| `externalUsagePath` | `""` | Read missing quota windows from a matching local snapshot file (edit directly in config) |
| `externalUsageWritePath` | `""` | Write quota snapshots to a local path for other processes (edit directly in config) |
| `externalUsageFreshnessMs` | `300000` | Maximum snapshot age in milliseconds (`1000`–`86400000`) |

## Colors and progress bars (`colors`)

Color keys accept standard ANSI color names (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `dim`, `bright*`), `0`–`255` palette integers, or `#rrggbb` hex strings. Set `NO_COLOR=1` to disable all colors.

- `model` (`"cyan"`), `project` (`"yellow"`), `git` (`"magenta"`), `gitBranch` (`"cyan"`), `label` (`"dim"`)
- `context` (`"green"`), `usage` (`"brightBlue"`), `warning` (`"yellow"`), `usageWarning` (`"brightMagenta"`), `critical` (`"red"`), `custom` (`208`)
- `barFilled` (`"█"`), `barEmpty` (`"░"`) — single-cell glyphs used for progress bars

## Environment variables

| Variable | Purpose |
| --- | --- |
| `AGY_HUD_CONFIG` | Override the default configuration file path |
| `AGY_HUD_DATA_DIR` | Override `~/.gemini/antigravity-cli/agy-hud-data/` for cost ledgers, hook data, transcript cursors, and recorded previews |
| `AGY_HUD_DISABLE=1` | Disable the HUD for a single `agy` session |
| `AGY_HUD_ALLOW_EXTRA_CMD=1` | Allow `--extra-cmd '<command>'` to append its first output line to the HUD |
| `NO_COLOR=1` | Disable ANSI colors in HUD and preview output |

The `AGY_HUB_*` names, `agy-hub.json`, and `agy-hub-data/` from releases before the AGY HUD rename are still read when the new name is absent.

See [Antigravity integration](integration.md) for data sources, API cost estimation rates, and optional hooks, or [Architecture](architecture.md) for module boundaries.
