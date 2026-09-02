# 桌面端动作时间线

每个工具动作在会话流中对应一张可展开动作卡。卡片只消费独立 runtime 经受控 IPC 发送的版本化 Run 事件，不接受模型文本或网页内容伪造状态。

卡片以 SVG 图标、文字摘要和文字徽章同时表达 `planned → authorized → dispatched → observed → verified` 六态账本链路。`unknown` 用橙色边框和警示图标表示待对账；授权被拒绝时显示独立的“已拒绝”界面结果，但不冒充为账本六态之一。

展开后可查看动作输入、授权决定、审批请求/结果、工具观察、验证结果和完整状态时间线。所有内容使用 `textContent` 呈现，详情长度由 `desktop-config.data.json` 限制并显式标记截断。即使当前会话为 `full_access`，动作卡也不会被隐藏或简化。
