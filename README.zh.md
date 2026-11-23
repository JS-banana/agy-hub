# AGY Hub

[English](README.md)

AGY Hub 是 Antigravity CLI（`agy`）的可配置状态栏。默认显示当前模型、项目、Git 分支、上下文占用和模型配额。窄屏时自动缩短进度条、拆分行。

```text
[Gemini 3.8 Flash] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)
```

## 安装

需要 macOS 或 Linux、Node.js 22 或更新版本，以及支持自定义状态栏的 `agy`。AGY Hub 直接用 Node.js 运行本地副本。

### 交给 Agent 安装

把下面这段话发给你的编程 Agent。

```text
帮我把 https://github.com/JS-banana/agy-hub 接入 Antigravity CLI。已有源码就复用，否则克隆到 ~/.local/share/agy-hub。跳过 npm 安装，直接用本地 node src/cli.js 预览并启用 HUD，同时注册 /agy-hub。替换其他状态栏前先问我。
```

### 先安装 Skill

将 [SKILL.md 原文](https://raw.githubusercontent.com/JS-banana/agy-hub/main/skills/agy-hub/SKILL.md) 保存到 `~/.gemini/antigravity-cli/skills/agy-hub/SKILL.md`，也可以让 Agent 代劳。该路径已有文件时请保留原文件。如果已有源码副本，也可在其根目录运行 `node src/cli.js skill install`，让 Skill 记录对应的本地入口。

打开一个新 `agy` 会话，或在已有交互会话运行 `/skills reload`，然后输入下面这句话。需要时 Skill 会引导 Agent 获取本地副本。

```text
/agy-hub 帮我接入 AGY Hub，先给我看预览
```

### 手动运行向导

把代码克隆到一个固定目录。已有源码副本时，进入其根目录运行最后一条命令即可。

```sh
mkdir -p "$HOME/.local/share"
git clone https://github.com/JS-banana/agy-hub.git "$HOME/.local/share/agy-hub"
cd "$HOME/.local/share/agy-hub"
node src/cli.js setup
```

向导会让你选布局，以及是否显示工具、子代理和 Git 文件统计。确认前会展示示例，并在替换现有自定义状态栏时提示备份。确认后打开新的 `agy` 会话即可使用。

向导提示默认为英文。可指定 `node src/cli.js setup --prompt-language zh-Hans` 或 `--prompt-language zh-Hant` 切换本次提示语言。HUD 的标签语言由配置中的 `language` 决定。

只试用一次时，可以在本地副本内运行 `agy --settings "$(node src/cli.js settings)"`。如果 [GitHub Releases](https://github.com/JS-banana/agy-hub/releases) 有可用版本，可以将 `.tgz` 解包到固定位置，再从解出的软件包目录运行 `node src/cli.js setup`。安装后请保留该目录，`agy` 会通过绝对路径调用它。

## 配置状态栏

以下 `node src/cli.js` 命令都在本地副本根目录运行。用 `node src/cli.js setup --configure-only` 重新打开向导。也可以用 `node src/cli.js preview --preset activity` 看示例，追加 `--width 60` 模拟窄屏，或追加 `--plain` 查看无色输出。

| 预设 | 显示内容 |
| --- | --- |
| `default` | 默认两行，显示模型、项目、Git、上下文和配额 |
| `compact` | 优先把项目和用量排在同一行 |
| `activity` | 在展开布局中加上工具和子代理活动 |

### 让 Agent 配置

加载 Skill 后，可以在其他工作区直接提出调整请求。

```text
/agy-hub 改成紧凑布局，显示工具和子代理
```

Agent 或脚本可用 `node src/cli.js setup --dry-run --json` 读取预览和计划，通过 `--preset` 或 `--set '<JSON>'` 传入候选设置。同一组参数改用 `--yes` 即可保存。`--configure-only` 只改显示，替换其他状态栏时需要 `--replace`。

`preview --preset` 从默认配置预览，`setup --preset` 把预设包含的选项合并到当前配置。
通过 `setup` 开启工具、子代理、技能或 MCP 活动时，展开布局会补上缺失的对应行。传入 `elementOrder` 可以指定完整的行顺序。

### 进阶设置

配置默认保存在 `~/.gemini/antigravity-cli/agy-hub.json`。用 `node src/cli.js config path` 查看实际位置，用 `AGY_HUB_CONFIG` 指定其他文件。手动编辑时只需填写要覆盖的设置。

```sh
node src/cli.js config show
node src/cli.js config set '{"language":"zh-Hans","display":{"showAgents":true}}'
node src/cli.js config check
node src/cli.js config undo
```

| 配置项 | 能调整什么 |
| --- | --- |
| `language` | 英语 `en`、简体中文 `zh-Hans`、繁体中文 `zh-Hant` |
| `elementOrder`、`display.mergeGroups`、`display.rightAlign` | 展开布局的行顺序、合并与对齐 |
| `projectLineOrder`、`pathLevels` | 项目行的字段顺序、目录显示层级 |
| `gitStatus`、`jjStatus` | 分支、领先和落后、文件变更、worktree，以及可选的 Jujutsu 状态 |
| `display` | 上下文与配额的格式和阈值、工具和子代理、会话 token、费用、内存等 |
| `colors` | 颜色名、0–255 的 ANSI 色号、`#rrggbb`，以及进度条字符。设置 `NO_COLOR=1` 可关闭颜色 |

启用 `display.showCost` 可显示会话费用。`agy` 缺少金额时，支持的模型会显示按标准 API 费率计算的参考值，例如 `Cost ≈$0.06`。开启 `display.showAgentModeOnly` 可单独显示 `Auto mode` 或 `Plan mode`。希望周配额有数据时一直显示，可将 `display.sevenDayThreshold` 设为 `0`。

用 `node src/cli.js config schema` 查看全部默认值。也可为编辑器生成带字段帮助的 JSON Schema：

```sh
node src/cli.js init
node src/cli.js config schema --json-schema > "$(dirname "$(node src/cli.js config path)")/agy-hub.schema.json"
node src/cli.js config set '{"$schema":"./agy-hub.schema.json"}'
```

模型、上下文、配额和子代理由 `agy` 提供。工具活动可读本地会话日志，必要时可加装 hooks 补充精细记录。数据来源、兼容限制和本地记录的位置见 [Antigravity 集成](docs/integration.md)。

## 排查、升级和卸载

- 用 `node src/cli.js doctor` 检查配置、状态栏绑定和命令路径。需要诊断摘要时用 `node src/cli.js report`。启用 `display.recordPreview` 后可用 `node src/cli.js preview --last` 回看上一帧。
- 源码升级用 `git pull --ff-only`。如果用的是发布包，就把新版本解包到固定目录，然后在新副本运行 `node src/cli.js install` 更新状态栏绑定。正在用 Skill 的话，再运行 `node src/cli.js skill install`。Node 可执行文件或本地副本换了位置，也要重新运行对应命令。手动修改过的 Skill 会保留。
- 用 `AGY_HUB_DISABLE=1 agy` 暂时停用。永久卸载时，若装了 Skill，先用 `node src/cli.js skill uninstall` 移除它，再用 `node src/cli.js uninstall` 恢复原状态栏。完成后可以移除本地副本。

## 开发

```sh
npm ci
npm run check
```

检查覆盖类型、行为、渲染层依赖边界，以及使用本地解包的发布文件接入和恢复状态栏的流程。[贡献与发布指南](CONTRIBUTING.md) · [工程架构](docs/architecture.md)

AGY Hub 采用 MIT 许可证。衍生代码的版权声明见 [LICENSE](LICENSE)。
