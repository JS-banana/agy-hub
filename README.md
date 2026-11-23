# AGY Hub

[简体中文](README.zh.md)

AGY Hub is a configurable status line for the Antigravity CLI (`agy`). It shows the active model, project, Git branch, context usage, and model quota. On narrower terminals, the HUD shortens progress bars and wraps rows.

![AGY Hub in Antigravity CLI showing the model, session cost, Git branch, context usage, and quotas](docs/assets/agy-hub-terminal-preview.png)

## Install

Requires macOS or Linux, Node.js 22 or later, and an `agy` version that supports custom status lines. AGY Hub runs directly from a local copy with Node.js.

### Ask an agent

Give this request to your coding agent.

```text
Set up AGY Hub for my Antigravity CLI from https://github.com/JS-banana/agy-hub. Reuse my checkout or clone it to ~/.local/share/agy-hub. Run node src/cli.js from that copy, skip npm installation, and preview the setup before enabling it. Register /agy-hub for future sessions and ask before replacing another status line.
```

### Install the skill first

Save the [raw SKILL.md](https://raw.githubusercontent.com/JS-banana/agy-hub/main/skills/agy-hub/SKILL.md) to `~/.gemini/antigravity-cli/skills/agy-hub/SKILL.md`, or ask your agent to do it. Keep any existing skill file at that path. If you already have a checkout, run `node src/cli.js skill install` from its root to register its local CLI with the skill.

Start a new `agy` session or run `/skills reload` in an existing interactive session. Then enter the following request. The skill helps set up a local copy if one is needed.

```text
/agy-hub Install the HUD and show me the preview first
```

### Run the wizard yourself

Clone the project into a stable directory. If you already have a checkout, open its root and run the last command.

```sh
mkdir -p "$HOME/.local/share"
git clone https://github.com/JS-banana/agy-hub.git "$HOME/.local/share/agy-hub"
cd "$HOME/.local/share/agy-hub"
node src/cli.js setup
```

The wizard previews the layout, tool activity, subagents, and Git file stats you choose. If another status line is configured, setup confirms before backing it up and replacing it. Start a new `agy` session after confirming.

For a one-session trial, run `agy --settings "$(node src/cli.js settings)"` from the local copy. When a version is available on [GitHub Releases](https://github.com/JS-banana/agy-hub/releases), you can unpack its `.tgz` in a stable location and run `node src/cli.js setup` from the extracted package directory. Keep the local copy at its installed path because `agy` calls it by absolute path.

## Configure the HUD

Run the `node src/cli.js` commands below from the root of the local copy. Use `node src/cli.js setup --configure-only` to reopen the wizard. Its prompts default to English. Use `--prompt-language zh-Hans` or `--prompt-language zh-Hant` for Chinese prompts in that invocation. The HUD uses its own `language` setting.

Run `node src/cli.js preview --preset activity` to see an example. Add `--width 60` for a narrow layout or `--plain` for output without color.

| Preset | Layout |
| --- | --- |
| `default` | Two rows with the model, project, Git, context, and quota |
| `compact` | Keeps project and usage on the same row when space allows |
| `activity` | Adds tools and subagents to the expanded layout |

### Configure with an agent

Once the skill is loaded, you can ask for changes from any workspace.

```text
/agy-hub Use the compact layout and show tools and subagents
```

Agents and scripts can use `node src/cli.js setup --dry-run --json` to inspect a preview and plan. Pass `--preset` or `--set '<JSON>'` to propose settings. Reuse the same arguments with `--yes` to apply them. Use `--configure-only` to edit the HUD settings and `--replace` to authorize replacing another status line.

`preview --preset` starts from the defaults, while `setup --preset` merges the preset's options into your current configuration. When you enable tools, subagents, skills, or MCP through `setup`, the wizard adds any missing rows to the expanded layout. Pass `elementOrder` to specify the full row order.

### Advanced settings

The default config path is `~/.gemini/antigravity-cli/agy-hub.json`. Run `node src/cli.js config path` to see the resolved path or set `AGY_HUB_CONFIG` to use another file. When editing the file, include the settings you want to override.

```sh
node src/cli.js config show
node src/cli.js config set '{"display":{"showAgents":true}}'
node src/cli.js config check
node src/cli.js config undo
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

Run `node src/cli.js config schema` to see every default. To generate a JSON Schema for your editor, run the following commands.

```sh
node src/cli.js init
node src/cli.js config schema --json-schema > "$(dirname "$(node src/cli.js config path)")/agy-hub.schema.json"
node src/cli.js config set '{"$schema":"./agy-hub.schema.json"}'
```

`agy` provides the model, context, quota, and subagents. AGY Hub can read the local session log for tool activity. Optional hooks supply more detailed events. [Antigravity integration](docs/integration.md)

## Troubleshoot, upgrade, or uninstall

- Use `node src/cli.js doctor` to check configuration and command paths, or `node src/cli.js report` for a diagnostic summary. With `display.recordPreview` enabled, use `node src/cli.js preview --last` to replay the previous frame.
- To upgrade a checkout, run `git pull --ff-only`. For a release archive, unpack the new version into a stable directory. From the updated copy, run `node src/cli.js install` to refresh the binding and `node src/cli.js skill install` if you use the skill. Run both commands again if the Node executable or local copy moves. The skill installer preserves local edits.
- Run `AGY_HUB_DISABLE=1 agy` to start a session with the HUD disabled. To remove AGY Hub, run `node src/cli.js skill uninstall` if you use the skill, then `node src/cli.js uninstall` to restore the prior status line. You can remove the local copy after those commands finish.

## Development

```sh
npm ci
npm run check
```

Checks cover types, behavior, renderer boundaries, and setup and recovery from a locally extracted release archive. [Contributing and releases](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

AGY Hub is MIT-licensed. [License and attribution](LICENSE)
