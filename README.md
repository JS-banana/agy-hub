# AGY Hub

把 Claude HUD 的状态栏布局带到 Antigravity CLI (`agy`)。默认第一行显示模型、项目和 Git 分支，第二行显示上下文与配额用量。进度条随终端宽度缩短，空间不足时分行。

```text
[Gemini 3.8 Flash] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)
```

## 试用与安装

需要 Node.js 22+ 和支持自定义 `/statusline` 的 `agy`。安装与 Git 状态支持 macOS、Linux。

在项目目录预览，再用一次性配置启动一个 `agy` 会话：

```sh
npm run preview
agy --settings "$(node src/cli.js settings)"
```

要在当前目录以外试用，先用 `node /项目绝对路径/src/cli.js settings` 生成会话配置。

设为默认状态栏后，重启 `agy` 即可生效：

```sh
node src/cli.js install
```

安装更新 `~/.gemini/antigravity-cli/settings.json` 的 `statusLine`，并备份原有值。安装记录使用 Node 与项目的绝对路径。如果移动项目或更换 Node 安装，重新运行安装命令。

```sh
node src/cli.js uninstall
```

卸载恢复安装前的 `statusLine`。如果之后在 `agy` 改成了其他命令，卸载会保留新命令和备份。

## 自定义

配置保存在 `~/.gemini/antigravity-cli/agy-hub.json`，也可以用 `AGY_HUB_CONFIG` 指定路径。以下示例启用 Compact 布局及工具和子代理活动：

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

```sh
npm run preview -- --compact --activity --width 100
node src/cli.js schema
node src/cli.js set '{"display":{"showTools":true,"showAgents":true}}'
node src/cli.js undo
node src/cli.js doctor
npm test
```

用 `schema` 查看所有键与默认值，`config` 查看当前生效值。启用 `display.recordPreview` 后，`preview --last` 可用上一次的脱敏数据预览当前配置。`report` 只输出诊断字段和检测结果。

## 数据来源

模型、上下文、配额和子代理直接来自 `agy`。Gemini 与第三方模型按各自的配额桶显示。工具统计默认关闭，启用后读取当前会话日志。配置计数来自常见的工作区和个人目录，费用汇总仅累计 HUD 开启跟踪后观察到的估算成本。

需要追加目录、精确到工具步骤的活动和单次调用吞吐量时，用 `node src/cli.js hooks` 生成可选的 `agy-hub` hook 配置，将该条目合并至工作区 `.agents/hooks.json`。已有 hooks 可同时使用。AGY Hub 保存工作区列表、工具名及适用的文件名、调用计时，不存请求文本或命令参数。

统计、hook 元数据和预览保存在 `~/.gemini/antigravity-cli/agy-hub-data/`，也可用 `AGY_HUB_DATA_DIR` 指定位置。只在相应功能启用时写入。可用 `AGY_HUB_DISABLE=1 agy` 本次停用 HUD。

自定义命令输出可放在首行。先设置 `AGY_HUB_ALLOW_EXTRA_CMD=1`，再在 statusLine 命令末尾添加 `--extra-cmd '你的本地命令'`。HUD 只取第一行。

与 Claude HUD 的功能对应关系、数据缺口和验收记录见 [功能对照](docs/parity.md)。

布局和配色来自 [Claude HUD](https://github.com/jarrodwatts/claude-hud) v0.15.4（MIT），`agy` 配额结构参考了 [antigravity-cli-statusline](https://github.com/weby-homelab/antigravity-cli-statusline) 和 [Antigravity 官方文档](https://antigravity.google/docs/cli/statusline/)。
