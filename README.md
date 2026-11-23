# AGY Hub

把 Claude HUD 的状态栏布局带到 Antigravity CLI (`agy`)。默认第一行显示模型、项目和 Git 分支，第二行显示上下文与配额用量。进度条随终端宽度缩短，空间不足时分行。

```text
[Gemini 3.8 Flash] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)
```

## 快速开始

需要 Node.js 22+ 和支持自定义 `/statusline` 的 `agy`。安装与 Git 状态支持 macOS、Linux；Git 和 jj 分别在已安装对应命令时使用。

**从源码目录安装 npm 命令**。先打包再全局安装，安装后的命令可以从任意工作目录运行。

```sh
npm install -g "./$(npm pack --silent)"
agy-hub preview
agy --settings "$(agy-hub settings)"
```

最后一行只给这次会话启用 HUD。确认效果后，运行 `agy-hub install` 再重启 `agy` 即可全局启用。安装会备份之前的 statusline。升级时重新安装新版 npm 包，再运行 `agy-hub install`。如果 Node 升级后入口失效，也用这个命令重新绑定；`agy-hub doctor` 会指出旧入口或 Node 是否不可用。

```sh
agy-hub uninstall
npm uninstall -g agy-hub
```

先恢复原 statusline，再卸载 npm 命令。如果之后在 `agy` 选择了别的状态栏，恢复命令会保留新选择和备份。

可以在源码目录直接用 `node src/cli.js` 代替 `agy-hub`。这个方式绑定的是源码所在路径。

## 自定义

配置默认保存在 `~/.gemini/antigravity-cli/agy-hub.json`，`agy-hub config path` 会显示实际路径。可以用 `AGY_HUB_CONFIG` 指定其他文件。

| 预设 | 效果 |
| --- | --- |
| `default` | 两行 HUD，显示模型、项目、上下文和配额 |
| `compact` | 将项目和用量尽可能排在一行 |
| `activity` | 在默认布局下加工具和子代理活动 |

```sh
agy-hub preview --preset activity
agy-hub init --preset activity
agy-hub config show
agy-hub config set '{"lineLayout":"compact","display":{"showAgents":true}}'
agy-hub config check
agy-hub config undo
```

`init` 只在配置文件缺失时写入预设。手动编辑时只填需要覆盖的键。以下示例启用 Compact 布局及工具、子代理活动：

```json
{
  "lineLayout": "compact",
  "showSeparators": true,
  "gitStatus": { "showAheadBehind": true },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showSessionName": true,
    "showCacheHitRate": true
  }
}
```

| 配置 | 可用项 |
| --- | --- |
| 布局 | `language` 支持 `en`、`zh-Hans`、`zh-Hant`。展开模式用 `elementOrder`、`display.mergeGroups` 和 `display.rightAlign` 排列元素，`projectLineOrder` 可在两种模式调整项目行 |
| Git 与 jj | `gitStatus.showAheadBehind`、`showFileStats`、`showWorktree` 可选。用 `jjStatus.enabled` 打开 Jujutsu，需要本机的 `jj` |
| 用量 | `display.contextValue` 支持 `percent`、`tokens`、`remaining`、`both`。配额支持已用／剩余口径、绝对或相对重置时间和 `usagePace` 消耗节奏。余额型额度按原始单位显示 |
| 可选信息 | `display.showTools`、`showSkills`、`showMcp`、`showAgents`、`showTasks`、`showDuration`、`showAuth`、`showConfigCounts`、`showMemoryUsage`、`showCost`、`showSessionTokens` 等 |
| 配色 | `colors` 接受颜色名、0–255 的 ANSI 色号和 `#rrggbb`。用 `barFilled`、`barEmpty` 改条形字符。设置 `NO_COLOR=1` 可关闭颜色 |

编辑器支持 JSON Schema 时，先运行 `agy-hub init`，再生成与当前版本匹配的 Schema：

```sh
agy-hub config schema --json-schema > "$(dirname "$(agy-hub config path)")/agy-hub.schema.json"
agy-hub config set '{"$schema":"./agy-hub.schema.json"}'
```

启用 `display.recordPreview` 后，`agy-hub preview --last` 可用上一次的脱敏数据预览当前配置。`agy-hub doctor` 用于本机排查，`agy-hub report` 可生成省略路径和账号数据的诊断。

## 数据来源

模型、上下文、配额和子代理直接来自 `agy`。Gemini 与第三方模型按各自的配额桶显示。工具统计默认关闭，启用后读取当前会话日志。配置计数来自常见的工作区和个人目录，费用汇总仅累计 HUD 开启跟踪后观察到的估算成本。

需要追加目录、精确到工具步骤的活动和单次调用吞吐量时，用 `agy-hub hooks` 生成可选的 `agy-hub` hook 配置，将该条目合并至工作区 `.agents/hooks.json`。已有 hooks 可同时使用。AGY Hub 保存工作区列表、工具名及适用的文件名、调用计时。

统计、hook 元数据和预览保存在 `~/.gemini/antigravity-cli/agy-hub-data/`，也可用 `AGY_HUB_DATA_DIR` 指定位置。只在相应功能启用时写入。可用 `AGY_HUB_DISABLE=1 agy` 本次停用 HUD。

自定义命令输出可放在首行。先设置 `AGY_HUB_ALLOW_EXTRA_CMD=1`，再在 statusLine 命令末尾添加 `--extra-cmd '你的本地命令'`。HUD 只取第一行。

与 Claude HUD 的功能对应关系、数据缺口和验收记录见 [功能对照](docs/parity.md)。

## 开发

```sh
npm ci
npm run check
```

检查包含类型、行为、渲染层依赖边界和 npm 发行包的端到端测试。[工程架构](docs/architecture.md)

## English quick start

From a local checkout, run `npm install -g "./$(npm pack --silent)"`, then `agy-hub preview --preset activity`. To try the HUD for a single session, run `agy --settings "$(agy-hub settings)"`. Use `agy-hub init --preset activity` to save the preset and `agy-hub install` to make it the default. Run `agy-hub --help` for configuration and diagnostics. Requires Node.js 22+ and Antigravity CLI on macOS or Linux.

布局和配色来自 [Claude HUD](https://github.com/jarrodwatts/claude-hud) v0.15.4（MIT），`agy` 配额结构参考了 [antigravity-cli-statusline](https://github.com/weby-homelab/antigravity-cli-statusline) 和 [Antigravity 官方文档](https://antigravity.google/docs/cli/statusline/)。
