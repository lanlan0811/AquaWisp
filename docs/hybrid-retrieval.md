# 混合检索与 Embedding

`HybridKnowledgeIndex` 把 `KnowledgeBase` 的 FTS5 结果与 `VectorIndex` 的语义结果通过 RRF 合并。默认搜索模式是 `hybrid`，调用方也可以明确选择 `full_text` 或 `semantic`。最终结果包含 chunk 原文、文档 ID、URI、标题、chunk 序号、命中通道、RRF 分数和基于查询词定位的高亮片段，因此上层会话与知识库面板可以直接展示可回溯来源。

检索权重、候选倍数、RRF 常数、向量最低分、高亮长度和最终数量上限集中在 `packages/kb/src/kb-config.data.json`。这些值由严格 schema 校验，不能在 UI、工具或 runtime 中另写一套默认值。

## 增量索引

`add` 先按知识库的同一分段配置预备 chunk，并在改动 SQLite 文档前完成全部 embedding。只有 embedding 全部成功后才替换 FTS5 chunk、清理已经消失的旧向量并 upsert 当前向量。这样供应商暂时不可用时不会覆盖仍可检索的旧文档。向量写入阶段的存储故障仍必须作为失败暴露；后续完整重建能力用于修复这类罕见不一致，不能静默把混合搜索伪装成成功。

`createHybridKnowledgeTools` 暴露异步的四项知识库能力：`kb_add`、`kb_search`、`kb_list` 和 `kb_status`。旧的纯 FTS 门面保留用于向量扩展不可用时的明确降级路径。

## OpenAI-compatible Embedding

`OpenAICompatibleEmbeddingProvider` 向配置的相对 `embeddings` 路径发送 `model`、单条文本 `input`、`float` 编码格式以及可选 `dimensions`。适配器校验：

- 模型名、维度、空输入和输入字符上限；
- 远端必须使用 HTTPS，HTTP 只允许注册表列出的 loopback host；
- URL 不能内嵌账号密码，请求路径不能是绝对 URL 或包含上级跳转；
- 请求超时、响应字节上限、JSON 结构、index 0 和最终向量维度；
- 非 2xx 响应使用 `EmbeddingHttpError` 返回状态与受限响应正文。

API key 只从桌面端系统加密存储注入构造器；注册表、日志、错误消息和知识库 SQLite 都不保存 key。本机无鉴权 embedding 服务可以省略 key。

向量内容会发送到用户配置的 embedding 服务。GUI 必须在启用远端 embedding 时说明这一数据边界；本地优先不等于远端 embedding 自动匿名化。
