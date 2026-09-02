# 模型流中断与恢复

`streamWithRecovery` 为 OpenAI-compatible 模型流提供受控恢复。它不会对中断的请求进行盲目重试：调用方必须提供 `resume` 回调，明确生成下一次 continuation 请求。

## 安全边界

- 只有 `ModelStreamInterruptedError` 能触发恢复；HTTP、协议和参数错误直接返回给调用方。
- 如果原始 `AbortSignal` 已取消，恢复控制器立即终止，绝不发起第二次请求。
- `maximumRecoveryAttempts` 由调用方配置；次数用尽抛出 `ModelStreamRecoveryExhaustedError`。
- continuation 回调收到已发送的规范化流事件、原始请求、中断信息与尝试次数。它必须构造语义上的续写请求，避免重新提出已经完成的工具调用。

## 序号与持久化

恢复后的事件使用全局连续 sequence，而不是每个 HTTP 连接的局部序号。正式 runtime 会把每次续接记录为 `model.stream.recovery`，其中包含尝试次数和续接前事件数；中断前的 `model.delta` 也已经提交，因此完整流程可回放、可审计。

模型供应商没有统一的 SSE resume 标准。当前双协议适配器把已经展示的文本作为末尾 assistant 消息附加到原始结构化上下文，再发起一次配置化、有上限的续接；如果还没有输出文本，则安全重放原请求。续写语义由 `docs/prompts/model-recovery.md` 约束，不在客户端中写死。未来可在供应商明确支持时改用 Responses 上游响应引用，但仍须保留同一恢复事件。
