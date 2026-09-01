# SQLite 持久向量索引

`packages/kb` 的 `SqliteVectorIndex` 使用官方 `sqlite-vec` Node 包和 Node.js 内置 `node:sqlite`，把 chunk embedding 与知识库元数据保存在同一个 SQLite 文件中，不需要外部向量数据库。

创建索引必须显式提供数据库路径、可移植 namespace 和向量维度。namespace 对应一个 vec0 虚拟表和一个文本 ID 映射表；维度写入公共 registry 表，后续以不同维度打开同一 namespace 会立即失败。向量以 `Float32Array` 的紧凑 BLOB 形式绑定，vec0 使用整数 rowid，外部仍使用稳定字符串 ID。

安全与兼容性约束：

- 仅在打开连接时允许加载扩展，`sqlite-vec` 加载完成后立即关闭继续加载能力；
- 数据库启用 WAL 和外键；更新、删除与 ID 映射使用 `BEGIN IMMEDIATE` 事务；
- namespace 只接受跨平台 SQL 标识符字符，不能注入表名；
- 维度、有限数值与正整数 limit 在进入 SQL 前校验；
- Windows x64、macOS x64/arm64 的扩展二进制由固定版本 npm 包提供；打包和干净机器验收仍需逐平台执行。

如果目标平台无法加载扩展，知识库可以继续使用 FTS5；调用方必须把向量能力报告为不可用，不能伪装为已执行混合检索。
