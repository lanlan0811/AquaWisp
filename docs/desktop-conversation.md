# 桌面端流式对话

桌面会话页通过 sandbox preload 暴露的窄接口启动和停止 Run。renderer 只能提交 `sessionId`、用户文本、经交互确认的会话模式，以及会话工具栏选中的模型和思考强度；provider、协议和 API key 仍由 Electron main 从已校验设置与系统加密存储中取得。main 会再次校验会话模型属于当前 provider、支持当前协议，并通过目录归一化思考档位。

main 将请求中的 `plan` / `work` / `full_access` 模式转换为版本化 `runtime.run.start` JSONL 消息。独立 runtime 使用模型目录验证 provider/model 归属、协议和思考档位，再由正式 OpenAI-compatible 客户端发起流式请求。工具声明由配置化注册表按 Chat Completions 或 Responses 格式生成；每轮最多接受一个结构化工具调用。每个已提交的 `model.delta`、动作、审批、`run.completed`、`run.failed` 或 `run.cancelled` 事件经同一 request ID 回传。renderer 使用 `textContent` 追加模型文本，不将模型内容解释为 HTML。

输入卡常驻计划、工作和完全访问三模式切换，以及当前 provider/协议可用的模型与目录声明的思考档位。Run 进行中这些控件均不可切换。完全访问需要先阅读高风险影响并显式确认，仅对当前会话生效；新建会话会同时恢复设置页中的默认模式、模型和思考档位。

发送按钮在 Run 活跃时切换为设计系统的 SVG 停止图标。收到 `run.created` 后，用户可发出携带准确 Run ID 的取消请求；runtime 只中止匹配的当前 Run，并通过 `AbortSignal` 取消网络流，随后把终态写入 SQLite。取消请求与长时间运行的 start 请求并发处理，因此不会被模型调用阻塞。

普通 RPC 使用短超时，模型 Run 使用 `desktop-config.data.json` 中独立的长超时。当前 v1 runtime 每次只执行一个 Run，避免多个模型流共享事件归属。同一 session 的历史已经在 `prepare` 阶段从事件库恢复并经过预算编译；当前 Run 的工具观察也会以明确的“不可信”标记进入下一轮 reason。文件、搜索、终端、网页和知识库工具均经过输入 schema、权限求值、动作账本、可配置字节上限与结果验证；对话内检索来源会同步显示为消息引用与右侧只读来源卡。
