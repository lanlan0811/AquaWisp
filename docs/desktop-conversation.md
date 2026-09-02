# 桌面端流式对话

桌面会话页通过 sandbox preload 暴露的窄接口启动和停止 Run。renderer 只能提交 `sessionId` 与用户文本；provider、model、协议、思考强度和 API key 均由 Electron main 从已校验设置与系统加密存储中取得。

main 将请求转换为版本化 `runtime.run.start` JSONL 消息。独立 runtime 使用模型目录验证 provider/model 归属、协议和思考档位，再由正式 OpenAI-compatible 客户端发起流式请求。每个已提交的 `model.delta`、`run.completed`、`run.failed` 或 `run.cancelled` 事件经同一 request ID 回传。renderer 使用 `textContent` 追加模型文本，不将模型内容解释为 HTML。

发送按钮在 Run 活跃时切换为设计系统的 SVG 停止图标。收到 `run.created` 后，用户可发出携带准确 Run ID 的取消请求；runtime 只中止匹配的当前 Run，并通过 `AbortSignal` 取消网络流，随后把终态写入 SQLite。取消请求与长时间运行的 start 请求并发处理，因此不会被模型调用阻塞。

普通 RPC 使用短超时，模型 Run 使用 `desktop-config.data.json` 中独立的长超时。当前 v1 runtime 每次只执行一个 Run，避免多个模型流共享事件归属。同一 session 的历史已经在 `prepare` 阶段从事件库恢复并经过预算编译；知识库来源管理已通过独立 runtime 接线，对话内检索来源卡片和审批恢复仍属于后续 M5 工作，不应绕过当前事件与权限契约。
