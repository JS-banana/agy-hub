# Antigravity 集成

AGY Hub 每次接收 `agy` 提供的一份状态栏数据并生成一帧。默认显示所需的数据来自该回调和本地 Git。工具活动、额外探针和本地记录按需启用。具体字段随 `agy` 版本而异。[Antigravity 状态栏文档](https://antigravity.google/docs/cli/statusline/)

## 数据来源

| 显示项 | 来源与限制 |
| --- | --- |
| 模型、上下文和配额 | `agy` 状态栏载荷。Gemini、第三方模型及专用额度使用各自的配额桶。余额型额度显示剩余数值。短周期与周配额同时存在时，周配额按阈值、余额或预警情况显示 |
| Git 和 Jujutsu | 本地仓库与对应命令。Git 支持工作区变更和 worktree；Jujutsu 读取已经记录的工作副本状态 |
| 工具、技能和 MCP | 当前会话日志，以及可选的工具 hooks。日志最多回看末尾 8 MiB；技能和 MCP 分类依赖可识别的标记或工具名 |
| 子代理 | `agy` 返回的名称、模型、角色和运行状态。实测 `agy 1.5.14` 的载荷没有子代理起止时间和推理强度 |
| 会话与任务 | 会话 token、当前回合缓存、后台任务和产物数量来自 `agy`。会话时长、最近回复和吞吐量依赖日志或 hooks 提供的时间。公开载荷没有缓存的精确过期时间及后台任务的待办明细 |
| 费用、内存和配置计数 | 费用采用 `agy` 报告的估算值。日／周累计只计入开启跟踪后观测到的增量，按观测时间归属。内存和配置数量来自本地系统及文件 |

OSC 8 文件链接取决于 `agy` 和终端是否透传。安装与版本控制探针当前支持 macOS 和 Linux。

## 可选 hooks

需要追加工作区、按工具步骤关联开始和完成记录，或估算单次调用的输出速度时，运行 `agy-hub hooks`，把输出中的 `agy-hub` 条目合并到工作区 `.agents/hooks.json`。已有条目可以继续使用。升级后可重新生成该条目以更新命令路径。停用时移除该条目。[Antigravity hooks 文档](https://antigravity.google/docs/hooks)

Hooks 会保存工作区路径、工具名、适用的文件名和调用计时。HUD 在同一会话内复用工具汇总，原始记录变化后重新读取。日志截断或工具回执间插入其他事件时，仅靠日志可能漏计。日志开头已截断时，会话起点使用可用的 hook 记录。

## 本地记录与诊断

- 费用累计、hook 元数据和预览帧保存在 `~/.gemini/antigravity-cli/agy-hub-data/`，可用 `AGY_HUB_DATA_DIR` 指定位置。各项功能启用后才写入对应记录。
- 启用 `display.recordPreview` 后，`agy-hub preview --last` 可用当前配置渲染最近一帧。记录会替换项目路径、分支、会话标题和邮箱等字段，保留模型、额度和活动等渲染信息。
- `agy-hub doctor` 显示本机配置路径和集成状态。`agy-hub report` 提供简化的诊断摘要，省略文件路径、账号信息、配额数值和日志正文。
- 需要跨本地进程读取或保存配额快照，可在配置文件设置 `display.externalUsagePath`、`display.externalUsageWritePath` 和 `display.externalUsageFreshnessMs`。文件路径通过手动编辑配置设置。已超过重置时间的快照会被忽略。
- 在已安装的绑定末尾追加单引号包住的 `--extra-cmd '你的本地命令'`，并设置 `AGY_HUB_ALLOW_EXTRA_CMD=1`，可显示命令输出的第一行。标准写法会在更新绑定时保留。

## 已验证范围

- 在已登录的 `agy 1.5.14` 真实交互会话中观察到配额剩余比例、重置时间和用量行更新。读取受控测试文件后，日志返回 `DONE`，终端显示 `✓ Read`。同一个内置 research 子代理从 `◐` 切换到 `✓`。
- 同一版本的 `agy -p /hooks --output-format json` 可发现五类 hooks。真实只读回合留下了工作区及 `--add-dir` 路径、调用起止时间和工具开始／成功记录。工作区记录由两类事件共用，未单独验证 `SessionStart` 写入。
- 相同版本识别发行包中的本地 Skill，交互终端可补全 `/agy-hub` 并用 `/skills reload` 加载。命令的预览、保存和撤销分别通过 CLI 测试。自然语言请求由 Agent 完成一次完整配置的流程尚未验证。
- Git 和 Jujutsu 使用临时仓库验证。jj 0.47.1 的探针验证包含确认读取状态时没有拍摄工作区快照。
