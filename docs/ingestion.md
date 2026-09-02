# 本地文件入库抽取

`packages/kb` 提供统一的本地文件文本抽取入口，覆盖 Markdown、纯文本、HTML、DOCX、PDF、XLSX 和 PPTX。`extractFileText` 根据文件扩展名与可选 MIME 类型选择解析器；两者冲突时立即拒绝，避免把伪装格式交给错误解析器。测试或已经持有字节数据的调用方可以使用 `extractBufferText`。

格式、扩展名、MIME 类型和资源上限集中定义在 `packages/kb/src/ingestion-formats.data.json`，由 Zod 在模块加载时严格校验。新增格式必须先更新注册表、实现解析器并补齐有效文件、损坏文件和资源上限测试，不能只添加扩展名。

## 解析策略

- DOCX：读取正文、页眉、页脚、脚注、尾注与批注的 OOXML 文本，保留段落、换行、制表符和 XML 实体文本。
- XLSX：按工作表数字顺序读取单元格，解析 shared string、inline string、布尔值和数值；输出以行和单元格边界分隔的文本。
- PPTX：按幻灯片数字顺序读取 DrawingML 文本，并包含演讲者备注文本。
- PDF：使用固定版本 `unpdf` 的 PDF.js 内核解析，不依赖系统安装的 Pandoc、LibreOffice、Office 或 Python。
- Markdown、HTML 与纯文本：使用仓库自有的确定性清洗逻辑；HTML 中的 script/style 内容不会入库。

## 安全与兼容性

读取前校验普通文件和输入字节上限。Office 文件还会在解压前检查 ZIP 条目数、单条原始大小和选中文本条目的累计原始大小，降低压缩炸弹造成内存放大的风险。最终规范化文本另有字符数上限。

OOXML 解压使用纯 JavaScript `fflate`，PDF 使用跨运行时的 `unpdf`，因此 Windows 与 macOS 走同一条代码路径。文件选择和知识库写入仍需经过工具策略与工作区边界；抽取器本身不会写文件、执行宏、访问网络或加载 Office 外部关系。

扫描件 PDF 和图片型 Office 内容目前不会执行 OCR。调用方应把空文本作为“需要 OCR 或人工处理”的可见状态，不能声称文件已经完整入库。
