# 可视浏览器宿主

AquaWisp M6 的浏览器基础使用 Electron `<webview>` 提供用户可见页面，并由 Electron main 持有 tab 注册表和 CDP 调试会话。renderer 不能直接获得 Node.js、文件系统或 Electron main 权限。

当前安全基线：

- 初始页面固定为 `about:blank`；导航只允许 `http:` 和 `https:`；
- `will-attach-webview` 再次强制 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，并移除外部 preload；
- 主窗口和 guest 都拒绝 `window.open`；guest 导航每次重新做协议校验；
- 每个 guest 只注册一次，并固定附加配置中的 CDP 1.3；
- guest 销毁时移除 tab，应用退出时主动解绑仍存活的调试会话；
- 每个命令请求必须携带当前后端代际；桥接层会校验严格 schema、拒绝陈旧代际与同 ID 异载荷重放，并对执行强制超时和可观察取消；
- `BrowserCommandEngine` 已实现导航、等待、状态、受限页面求值、键鼠/表单操作、页面与元素截图；结构化快照携带 `tag/role/name/text/ref/selector/xpath/rect/framePath`，ref 在导航后立即失效；
- runtime 与桌面 main 之间使用独立的双向 host RPC 信封；runtime 发出 `browser.execute/browser.cancel`，桌面响应成功值或结构化错误，双方均执行 requestId、超时和单行大小限制；
- 地址、协议与 CDP 版本来自 `packages/browser/src/browser-policy.data.json`。

右侧浏览器面板遵循 AquaWisp 设计系统的 280px 宽度、中文标题和 SVG 图标。打包态测试要求主 renderer、webview renderer 与独立 runtime 同时存活。

## 当前边界

当前已建立可视 webview、安全 tab/CDP 生命周期、可靠命令桥和完整命令执行器。Electron main 已接管 CDP、多标签、对话框和工作区内截图产物；renderer 只通过窄 preload API 操作地址栏、前进/后退/刷新与标签页。下载目录已限定在 runtime 工作区；录屏与一键采集入库将在后续 M6 子功能完成。任何网页内容和 CDP 观察均按不可信数据经过大小与结构校验。
