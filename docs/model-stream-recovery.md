# 模型流中断与恢复

`streamWithRecovery` 为 OpenAI-compatible 模型流提供受控恢复。它不会对中断的请求进行盲目重试：调用方必须提供 `resume` 回调，明确生成下一次 continuation 请求。

## 安全边界

- 只有 `ModelStreamInterruptedError` 能触发恢复；HTTP、协议和参数错误直接返回给调用方。
- 如果原始 `AbortSignal` 已取消，恢复控制器立即终止，绝不发起第二次请求。
- `maximumRecoveryAttempts` 由调用方配置；次数用尽抛出 `ModelStreamRecoveryExhaustedError`。
- continuation 回调收到已发送的规范化流事件、原始请求、中断信息与尝试次数。它必须构造语义上的续写请求，避免重新提出已经完成的工具调用。

## 序号与持久化

恢复后的事件使用全局连续 sequence，而不是每个 HTTP 连接的局部序号。runtime 应先持久化已发出的事件，再依据 continuation 回调重新发起模型调用；因此中断前内容仍可回放，恢复流程也可审计。

模型供应商没有统一的 SSE resume 标准。Chat Completions 可由调用方在 continuation 中注入已完成的 assistant 内容和受版本化 prompt 管理的续写指令；Responses 则可使用供应商支持的上游响应引用。具体提示词不得写死在客户端实现中。
