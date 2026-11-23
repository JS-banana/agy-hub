# Claude HUD 功能对照

对照 [Claude HUD v0.15.4](https://github.com/jarrodwatts/claude-hud/tree/bf23142cd2e3a2579ed9f81c24fae13f77174e7c) 与 [Antigravity CLI 状态栏](https://antigravity.google/docs/cli/statusline/)。对应关系按界面用途组织，Claude 专有的字段和命令仍以原产品为准。

| 功能 | AGY Hub |
| --- | --- |
| 默认布局和样式 | 两行默认布局、Compact、窄屏拆行、对齐、颜色、进度条字符、可选分隔线 |
| 布局自定义 | 元素排序、分组、靠右和项目行排序，简体中文、繁体中文、英语 |
| 模型、项目和账号 | 模型长度、覆盖、effort、会话标题、启动目录、版本、可选账号级别和用户名；可选 OSC 8 项目／文件链接 |
| Git 与 Jujutsu | Git 分支、脏标记、领先／落后、提交标签、文件统计、变更行数、worktree；jj bookmark、change ID、已记录变更和冲突 |
| 上下文与用量 | 已用／剩余百分比、token／容量、阈值、配额耗尽提示、余额型配额、相对／绝对／经过时间、消耗节奏、外部额度快照 |
| 工具、技能和 MCP | 按会话日志显示工具状态和次数；用可识别的技能标记、MCP 工具名分类。可选 hooks 提供明确的步骤关联 |
| 子代理与时间 | 名称、模型、角色、运行／完成；会话起始、最后回复时间、会话时长。启用 hooks 后可按模型调用耗时和对应回复的 token 量估算吞吐 |
| 其他可选指标 | RAM、规则／配置计数、当前回合缓存 token 与命中比例、会话 token 与估算成本、开启跟踪后的日／周累计、后台任务和产物数 |
| 配置流程 | 预览、配置键和默认值、校验、修改、撤销、本地诊断和脱敏报告。使用 CLI 命令入口，安装和卸载可恢复前一条 statusline |

## 数据差异

- **待办进度**。本机 `agy` 的 `task_count` 表示后台任务。状态栏字段、已检查的会话日志和真实测试回合均未提供 Claude TodoWrite／TaskCreate 的待办明细。
- **子代理计时和 effort**。实测 `subagents` 只有 `name`、`role`、`model`、`status`。有相应字段的版本可显示起止时间或 effort；本机版本通常只显示名称、模型与状态。
- **配额、缓存与费用**。Gemini、第三方模型和专用桶展示各自额度。额度只有余额时无法计算百分比。缓存行显示当前回合的缓存量及占比，公开数据没有可用的精确过期时间。日／周费用基于 HUD 看到的估算值，采用观察时点归属。
- **Claude 专属数据**。Advisor、Claude 输出风格、Claude 压缩事件、Bedrock／Vertex 路由及其账单没有经过验证的 AGY 等价字段。可手填 provider 名称。
- **工具与工作区范围**。未启用 hooks 时最多回看日志末尾 8 MiB，工具回执按相邻步序关联；超长会话较早的计数可能缺失。追加工作区目录优先使用状态载荷，通常要启用提供 `workspacePaths` 的 AGY hooks。MCP 和技能记录依赖可识别的工具名或技能标记。[Antigravity hooks](https://antigravity.google/docs/hooks)
- **终端差异**。OSC 8 链接为可选，取决于 agy TUI 和终端透传。Windows 的安装与 VCS 探针不在当前支持范围。

## 验收记录

- 在已登录的 `agy 1.5.14` 真实交互会话中，配额剩余比例、重置时间和 Usage 行都更新过。读取受控测试文件后，日志记录返回 `DONE`，终端出现 `✓ Read ×…`。同一个内置 research 子代理在终端经历 `◐` 到 `✓`。
- 五类 hook 配置通过真实 `agy -p /hooks --output-format json` 的发现检查。实际只读模型回合生成了工作区与 `--add-dir` 路径、调用起止时间及工具开始和成功完成记录。HUD 读回另有测试。工作区记录由两个事件共用，未单独计数 `SessionStart`。
- Git 和 Jujutsu 使用临时仓库验证。jj 测试使用官方 0.47.1 临时二进制，确认只读探针没有拍摄工作区快照。
