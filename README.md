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

可选配置文件为 `~/.gemini/antigravity-cli/agy-hub.json`，也可以用 `AGY_HUB_CONFIG` 指定路径。只需填写想改的键。以下示例启用 Compact 布局及工具和子代理活动：

```json
{
  "lineLayout": "compact",
  "showSeparators": true,
  "gitStatus": { "showAheadBehind": true },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showSessionName": true
  }
}
```

| 配置 | 可用项 |
| --- | --- |
| 布局 | `lineLayout` 为 `expanded`（默认）或 `compact`，`pathLevels` 为目录层数或 `"full"`，`maxWidth` 限制列宽 |
| Git | `gitStatus.enabled`、`showDirty` 默认开启，可用 `showAheadBehind` 显示与上游分支的差距 |
| 用量 | `display.showUsage`、`showContextBar`、`usageBarEnabled`、`showResetLabel` 默认开启。`usageValue: "remaining"` 显示剩余百分比，条形仍表示已用量 |
| 阈值 | `display.contextWarningThreshold` 为 70，`contextCriticalThreshold` 为 85，`sevenDayThreshold` 为 80 |
| 可选信息 | 在 `display` 中打开 `showTools`、`showAgents`、`showTasks`、`showSessionName`、`showEffortLevel`、`showCost`、`showSessionTokens` 或 `showAgyVersion` |
| 配色 | `colors` 的键为 `model`、`project`、`git`、`gitBranch`、`label`、`context`、`usage`、`warning`、`usageWarning`、`critical`。值可用 `cyan`、`brightBlue` 等颜色名、0–255 的 ANSI 色号或 `#rrggbb`。设置 `NO_COLOR=1` 可关闭颜色 |

```sh
npm run preview -- --compact --activity --width 100
npm test
```

## Antigravity 数据来源

- 模型、上下文、配额和子代理直接使用 `agy` 传给状态栏的数据。Gemini 和第三方模型使用各自的配额桶。周额度通常到 80% 才出现；只有周额度时会直接显示。缺少百分比的额度不会生成进度条。
- 工具活动默认关闭。开启后读取当前会话 transcript 的末尾，用最近的工具结果统计次数，只在状态栏显示工具名称和适用的文件名。子代理显示以 `agy` 提供的状态为准。
- `agy` 的 `task_count` 是后台任务数。Claude HUD 的待办进度、Claude 订阅窗口和 Claude 专属指标没有对应的 `agy` 数据来源。

布局和配色来自 [Claude HUD](https://github.com/jarrodwatts/claude-hud) v0.15.4（MIT），`agy` 配额结构参考了 [antigravity-cli-statusline](https://github.com/weby-homelab/antigravity-cli-statusline) 和 [Antigravity 官方文档](https://antigravity.google/docs/cli/statusline/)。
