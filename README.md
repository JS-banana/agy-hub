# AGY Hub

AGY Hub 是 Antigravity CLI（`agy`）的可配置状态栏。默认显示当前模型、项目、Git 分支、上下文占用和模型配额。窄屏时自动缩短进度条、拆分行。

```text
[Gemini 3.8 Flash] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)
```

## 安装

需要 macOS 或 Linux、Node.js 22 或更新版本，以及支持自定义状态栏的 `agy`。在 AGY Hub 源码目录运行：

```sh
npm install -g "./$(npm pack --silent)"
agy-hub setup
```

向导会让你选布局，以及是否显示工具、子代理和 Git 文件统计。确认前会展示示例，并在替换现有自定义状态栏时提示备份。确认后打开新的 `agy` 会话即可使用。

只想试用一次，可运行 `agy --settings "$(agy-hub settings)"`。在源码目录也可以用 `node src/cli.js` 代替 `agy-hub`，安装时会绑定当前源码的绝对路径。

## 配置状态栏

随时运行 `agy-hub setup --configure-only` 重新打开向导。可先用 `agy-hub preview --preset activity` 看示例，用 `--width 60` 模拟窄屏，或用 `--plain` 查看无色输出。

| 预设 | 显示内容 |
| --- | --- |
| `default` | 默认两行，显示模型、项目、Git、上下文和配额 |
| `compact` | 优先把项目和用量排在同一行 |
| `activity` | 在展开布局中加上工具和子代理活动 |

### 让 Agent 配置

在 AGY Hub 源码目录里，可以告诉 Agent「帮我启用 AGY Hub，使用紧凑布局并显示工具，先给我看预览」。想在 `agy` 里用斜杠命令，可选装本地 Skill：

```sh
agy-hub skill install
```

打开新会话，或在现有交互会话运行 `/skills reload`，然后输入 `/agy-hub 改成紧凑布局，显示工具和子代理`。

Agent 或脚本可用 `agy-hub setup --dry-run --json` 读取预览和计划，通过 `--preset` 或 `--set '<JSON>'` 传入候选设置。同一组参数改用 `--yes` 即可保存。`--configure-only` 只改显示，替换其他状态栏时需要 `--replace`。

`preview --preset` 从默认配置预览，`setup --preset` 把预设包含的选项合并到当前配置。
通过 `setup` 开启工具、子代理、技能或 MCP 活动时，展开布局会补上缺失的对应行。传入 `elementOrder` 可以指定完整的行顺序。

### 进阶设置

配置默认保存在 `~/.gemini/antigravity-cli/agy-hub.json`。用 `agy-hub config path` 查看实际位置，用 `AGY_HUB_CONFIG` 指定其他文件。手动编辑时只需填写要覆盖的设置。

```sh
agy-hub config show
agy-hub config set '{"language":"zh-Hans","display":{"showAgents":true}}'
agy-hub config check
agy-hub config undo
```

| 配置项 | 能调整什么 |
| --- | --- |
| `language` | 英语 `en`、简体中文 `zh-Hans`、繁体中文 `zh-Hant` |
| `elementOrder`、`display.mergeGroups`、`display.rightAlign` | 展开布局的行顺序、合并与对齐 |
| `projectLineOrder`、`pathLevels` | 项目行的字段顺序、目录显示层级 |
| `gitStatus`、`jjStatus` | 分支、领先和落后、文件变更、worktree，以及可选的 Jujutsu 状态 |
| `display` | 上下文与配额的格式和阈值、工具和子代理、会话 token、费用、内存等 |
| `colors` | 颜色名、0–255 的 ANSI 色号、`#rrggbb`，以及进度条字符。设置 `NO_COLOR=1` 可关闭颜色 |

用 `agy-hub config schema` 查看全部默认值。也可为编辑器生成带字段帮助的 JSON Schema：

```sh
agy-hub init
agy-hub config schema --json-schema > "$(dirname "$(agy-hub config path)")/agy-hub.schema.json"
agy-hub config set '{"$schema":"./agy-hub.schema.json"}'
```

模型、上下文、配额和子代理由 `agy` 提供。工具活动可读本地会话日志，必要时可加装 hooks 补充精细记录。数据来源、兼容限制和本地记录的位置见 [Antigravity 集成](docs/integration.md)。

## 排查、升级和卸载

- 用 `agy-hub doctor` 检查配置、状态栏绑定和命令路径。需要诊断摘要时用 `agy-hub report`。启用 `display.recordPreview` 后可用 `agy-hub preview --last` 回看上一帧。
- 升级时从新版源码重新安装 npm 包，再运行 `agy-hub install` 更新绑定。用 `agy-hub skill install` 可同时更新已安装的 Skill，手动修改过的副本会保留。
- 用 `AGY_HUB_DISABLE=1 agy` 暂时停用。永久卸载时，先移除可选的 Skill（`agy-hub skill uninstall`），再用 `agy-hub uninstall` 恢复原状态栏，最后运行 `npm uninstall -g agy-hub`。

## 开发

```sh
npm ci
npm run check
```

检查覆盖类型、行为、渲染层依赖边界以及 npm 包安装和恢复流程。[工程架构](docs/architecture.md)

## English quick start

From a local checkout, run `npm install -g "./$(npm pack --silent)"`, then `agy-hub setup` for a guided preview and installation. Use `agy-hub setup --configure-only` to adjust an existing HUD. For the optional `/agy-hub` command in Antigravity CLI, run `agy-hub skill install`. Requires Node.js 22+ and Antigravity CLI on macOS or Linux.

AGY Hub 采用 MIT 许可证。衍生代码的版权声明见 [LICENSE](LICENSE)。
