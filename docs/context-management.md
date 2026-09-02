# 上下文管理与恢复

`@aquawisp/context` 在每次模型调用前编译上下文。它不保存可变的会话状态；输入、压缩结果和检查点均为不可变值，由 runtime 持久化为事件。

## 预算规则

上下文预算来自注入的 `ContextBudgetConfig`，而非固定常量：

- `maxTokens`：最终可发送给模型的最大 token 数；
- `compressionThresholdRatio`：达到 `maxTokens` 的比例时触发压缩；
- `recentWindowTokens`：保留完整近程对话的预算；
- `maximumSummaryTokens`：旧对话摘要的独立上限；
- `toolInlineTokenLimit`：超过该值的工具结果必须外置为工件引用。

Token 估算器、摘要器、工件存储器、摘要 ID 与时钟均由调用方注入。生产实现可使用模型对应的分词器；测试可使用确定性估算器。

## 压缩语义

达到阈值后，管理器按以下顺序生成新的上下文：

1. 对全部超限工具结果生成工件引用，原始内容不再进入摘要或模型上下文；
2. 原样保留所有系统消息；
3. 从末尾保留最近完整对话窗口；
4. 将其余对话压缩为受 `maximumSummaryTokens` 限制的摘要；
5. 为结果生成 SHA-256 检查点，并在最终结果仍超预算时显式失败。

系统消息与最近窗口不能被静默截断。若这些保留内容加摘要仍无法装入模型窗口，调用方会收到 `ContextBudgetExceededError`，以便缩小输入或调整策略。

## 可追溯性与恢复

`FileContextCheckpointStore` 将完整的编译结果原子写入调用方配置的检查点目录，返回稳定的 `context-checkpoint:sha256:…` 引用。runtime 使用 `recordContextCompilation` 将以下事件作为单个 SQLite 事务提交：

- `context.compacted`：压缩前后 token 数、摘要 ID、保留/移除项目、工件引用和检查点 revision；
- `checkpoint.saved`：检查点 revision、项目顺序、token 数和检查点引用。

两个事件通过 `parentEventId` 连成链，并继承同一 trace。恢复时可从事件库读取最近的 `checkpoint.saved`，再以其中的引用加载完整快照，并按工件引用恢复下一次模型调用需要的上下文。

正式 runtime 已在每个 Run 的 `prepare` 阶段执行这条链路。它从同一 session 的 `run.created`、`run.completed` 与 `action.observed` 事件重建 user、assistant 与不可信 tool 项，当前 Run 的 user 项始终排在历史之后。编译后的 `docs/prompts` 资源会先校验逐文件哈希和聚合 revision，再作为 system 项加入；旧 user/tool 内容不会被提升为 system 权限。

生产预算、字符 token 估算比例、恢复窗口、摘要上限、工具内联上限与目录名统一来自 `runtime-host.data.json`。当前摘要器是确定性的有界抽取器；它保证预算与可恢复性，但不是模型生成的语义摘要。后续替换摘要器时仍须保持同一端口、检查点和事件契约。
