# AGY Hub

[简体中文](README.zh.md)

AGY Hub is a configurable status line for the Antigravity CLI (`agy`). It shows the active model, project, Git branch, context usage, and model quota. On narrower terminals, the HUD shortens progress bars and wraps rows.

```text
[Gemini 3.8 Flash] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)
```

## Install

Download a package from [GitHub Releases](https://github.com/JS-banana/agy-hub/releases) once a version is published, then install the downloaded `.tgz` with `npm install -g`. Run `agy-hub setup` after installing it.

Requires macOS or Linux, Node.js 22 or later, and an `agy` version that supports custom status lines. From the AGY Hub source directory, run the following commands.

```sh
npm install -g "./$(npm pack --silent)"
agy-hub setup
```

The wizard lets you choose a layout and whether to show tools, subagents, or Git file stats. It previews your choices before applying them and warns you before backing up and replacing an existing custom status line. Start a new `agy` session after confirming.

To try AGY Hub for one session, run `agy --settings "$(agy-hub settings)"`. From the source directory, you can also use `node src/cli.js` in place of `agy-hub`. A status line installed this way uses the absolute path to that checkout.

## Configure the HUD

Run `agy-hub setup --configure-only` to reopen the wizard. Its prompts default to English. Use `--prompt-language zh-Hans` or `--prompt-language zh-Hant` for Chinese prompts in that invocation. The HUD uses its own `language` setting.

Run `agy-hub preview --preset activity` to see an example. Add `--width 60` for a narrow layout or `--plain` for output without color.

| Preset | Layout |
| --- | --- |
| `default` | Two rows with the model, project, Git, context, and quota |
| `compact` | Keeps project and usage on the same row when space allows |
| `activity` | Adds tools and subagents to the expanded layout |

### Configure with an agent

From the AGY Hub source directory, you can ask your agent to set up the compact layout with tool activity and show a preview first. To use a slash command in `agy`, install the optional local skill.

```sh
agy-hub skill install
```

Open a new session or run `/skills reload` in an existing interactive session. Then enter `/agy-hub Use the compact layout and show tools and subagents`.

Agents and scripts can use `agy-hub setup --dry-run --json` to inspect a preview and plan. Pass `--preset` or `--set '<JSON>'` to propose settings. Reuse the same arguments with `--yes` to apply them. Use `--configure-only` to edit the HUD settings and `--replace` to authorize replacing another status line.

`preview --preset` starts from the defaults, while `setup --preset` merges the preset's options into your current configuration. When you enable tools, subagents, skills, or MCP through `setup`, the wizard adds any missing rows to the expanded layout. Pass `elementOrder` to specify the full row order.

### Advanced settings

The default config path is `~/.gemini/antigravity-cli/agy-hub.json`. Run `agy-hub config path` to see the resolved path or set `AGY_HUB_CONFIG` to use another file. When editing the file, include the settings you want to override.

```sh
agy-hub config show
agy-hub config set '{"display":{"showAgents":true}}'
agy-hub config check
agy-hub config undo
```

| Setting | Controls |
| --- | --- |
| `language` | HUD labels in English (`en`), Simplified Chinese (`zh-Hans`), or Traditional Chinese (`zh-Hant`) |
| `elementOrder`, `display.mergeGroups`, `display.rightAlign` | Row order, grouping, and alignment in the expanded layout |
| `projectLineOrder`, `pathLevels` | Project row fields and directory depth |
| `gitStatus`, `jjStatus` | Branch, ahead and behind counts, changes, worktree, and optional Jujutsu status |
| `display` | Context and quota formats, tools, subagents, session tokens, cost, memory, and more |
| `colors` | Color names, ANSI indexes from 0 to 255, `#rrggbb`, and progress characters. Set `NO_COLOR=1` to disable colors |

Enable `display.showCost` to show session cost. When `agy` omits cost, supported models can show an estimate at standard API rates, such as `Cost ≈$0.06`. Enable `display.showAgentModeOnly` for a standalone `Auto mode` or `Plan mode` label. Set `display.sevenDayThreshold` to `0` to show the weekly quota whenever it is available.

Run `agy-hub config schema` to see every default. To generate a JSON Schema for your editor, run the following commands.

```sh
agy-hub init
agy-hub config schema --json-schema > "$(dirname "$(agy-hub config path)")/agy-hub.schema.json"
agy-hub config set '{"$schema":"./agy-hub.schema.json"}'
```

`agy` provides the model, context, quota, and subagents. AGY Hub can read the local session log for tool activity. Optional hooks supply more detailed events. [Antigravity integration](docs/integration.md)

## Troubleshoot, upgrade, or uninstall

- Use `agy-hub doctor` to check configuration, the status line binding, and command paths. Use `agy-hub report` for a diagnostic summary. With `display.recordPreview` enabled, run `agy-hub preview --last` to replay the previous frame.
- To upgrade, install the newer package and run `agy-hub install` to refresh the binding. Run `agy-hub skill install` to update the optional skill. Local edits to the skill are preserved.
- Run `AGY_HUB_DISABLE=1 agy` to start a session with the HUD disabled. To remove AGY Hub, remove the optional skill with `agy-hub skill uninstall`, restore the prior status line with `agy-hub uninstall`, then run `npm uninstall -g agy-hub`.

## Development

```sh
npm ci
npm run check
```

Checks cover types, behavior, renderer boundaries, and npm package installation and recovery. [Contributing and releases](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

AGY Hub is MIT-licensed. [License and attribution](LICENSE)
