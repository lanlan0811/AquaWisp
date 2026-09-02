# 浏览器命令

工具输入统一为：

```json
{
  "tabId": "可选的已登记标签 ID",
  "command": { "kind": "命令名" }
}
```

省略 `tabId` 时使用活动标签。工具每次只接受一个命令。

## `browser_observe`

该工具无本地副作用，可在 `plan` 模式使用，只接受注册表标记为只读的命令：

- `navigate`: `{ "kind": "navigate", "url": "https://..." }`
- `back`、`forward`、`reload`: 仅含 `kind`
- `waitFor`: `{ "kind": "waitFor", "text": "...", "timeoutMs": 3000 }` 或以 `ref` 替代 `text`
- `waitForURL`: `{ "kind": "waitForURL", "url": "URL 中应出现的文本", "timeoutMs": 3000 }`
- `snapshot`、`getState`、`listTabs`: 仅含 `kind`

`snapshot` 返回当前 URL、标题和节点。节点包含 `tag`、`role`、`name`、`text`、`ref`、`selector`、`xpath`、`rect` 与 `framePath`；优先使用 `ref`，不要猜选择器。

## `browser_command`

该工具用于有副作用或能执行页面代码的动作：

- 截图：`screenshot { path }`、`elementScreenshot { ref, path }`
- 页面代码：`evaluate { expression }`
- 交互：`click { ref }`、`fill { ref, value }`、`type { value }`、`press { key }`、`hover { ref }`
- 选择与滚动：`scroll { deltaX, deltaY }`、`select { ref, values }`、`check { ref, checked }`
- 标签：`newTab { url? }`、`activateTab { tabId }`、`close { tabId? }`
- 会话：`handleDialog { accept, promptText? }`、`downloadPath`、`recordingStart { path }`、`recordingStop`

命令字段必须完全符合契约。超时、文本长度、路径长度、滚动幅度和标签数量由运行时配置限制；不要通过拆分或编码绕过上限。

