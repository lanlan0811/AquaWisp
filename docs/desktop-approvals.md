# 桌面端审批与会话授权

当可信的 runtime 权限求值器返回 `requires_approval` 时，`RunEngine` 先把 `approval.required` 与完整请求写入事件库，再通过已提交事件通知桌面端。Run 保持活跃并停在 authorize 阶段；用户沉默、关闭弹窗或页面内容都不能产生授权。

审批弹窗只渲染契约中的操作类型、目标、风险原因和影响范围，全部使用 `textContent`。renderer 只能提交审批 ID、Run ID、`approve`/`deny` 决定和“本会话内记住”布尔值，不能修改动作参数或风险描述。runtime 仅接受当前待审批 Run 的准确 ID；过期、重复或错配决定返回失败。

runtime 在执行动作前依次完成：

1. 将 `approval.resolved` 原子写入事件时间线；
2. 对允许决定记录 `action.authorized`，再进入 execute；
3. 对拒绝决定记录 `action.denied`，以 `user_denied_approval` 终止 Run，绝不派发动作。

勾选“本会话内，相同操作、目标和影响范围总是允许”只对当前 `sessionId` 生效，匹配键包含操作类型、目标、风险原因和影响描述。授权仅在 `approval.resolved` 成功持久化后加入内存；runtime 重启会清空，会话或任一范围字段变化都会重新审批。拒绝决定不能被记为允许，也不存在永久允许。

等待审批期间，停止按钮仍可取消 Run。取消信号会解除等待并记录 `run.cancelled`。正式模型适配器会从工具注册表生成 Chat Completions 或 Responses 的函数声明；模型提出终端、工作区外知识入库等边界动作时，生产权限适配器会触发本审批链路。审批不会扩展工具本身的能力边界，例如工作区文件工具即使获批也不会访问真实根之外的路径。
