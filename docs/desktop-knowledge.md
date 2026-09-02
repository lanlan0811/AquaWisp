# 桌面端知识库管理

知识库页通过 sandbox preload 的窄接口管理本地来源。renderer 不能读取路径、打开任意文件或直接访问 SQLite；“添加文件”先由 Electron main 打开系统文件选择器，再把用户明确选中的路径作为版本化 `runtime.kb.add_file` 请求交给独立 runtime。

runtime 从 `packages/kb/src/ingestion-formats.data.json` 读取支持的扩展名与资源上限，因而系统文件选择器、实际抽取器和 UI 能力提示共享同一数据源。当前支持 Markdown、纯文本、HTML、DOCX、PDF、XLSX 与 PPTX。文件会在 runtime 中解析、分段并写入独立的 `kb.sqlite`；Run 事件继续写入 `events.sqlite`，两类数据可分别备份和恢复。

知识库页显示来源数量、分段数量、来源标题、更新时间、文件 URI 和每个来源的分段数。所有路径、标题和错误信息都以 `textContent` 渲染，不作为 HTML 执行。多文件导入按配置限制数量，并逐个返回成功或失败结果；单个损坏文件不会掩盖其他文件已经完成的导入。

“移除”操作先显示明确确认对话框。确认后只删除知识库中的来源记录与分段索引，不修改或删除原文件。操作完成后 renderer 使用 runtime 返回的权威状态重绘列表，不自行推测数据库状态。

该接口目前负责来源管理和全文分段索引。语义 embedding 的供应商配置、对话中的检索来源卡片，以及 Agent 动作审批将在后续 M5 接线中继续通过 runtime 与事件契约完成。
