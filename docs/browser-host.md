# 可视浏览器宿主

AquaWisp M6 的浏览器基础使用 Electron `<webview>` 提供用户可见页面，并由 Electron main 持有 tab 注册表和 CDP 调试会话。renderer 不能直接获得 Node.js、文件系统或 Electron main 权限。

当前安全基线：

- 初始页面固定为 `about:blank`；导航只允许 `http:` 和 `https:`；
- `will-attach-webview` 再次强制 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，并移除外部 preload；
- 主窗口和 guest 都拒绝 `window.open`；guest 导航每次重新做协议校验；
- 每个 guest 只注册一次，并固定附加配置中的 CDP 1.3；
- guest 销毁时移除 tab，应用退出时主动解绑仍存活的调试会话；
- 每个命令请求必须携带当前后端代际；桥接层会校验严格 schema、拒绝陈旧代际与同 ID 异载荷重放，并对执行强制超时和可观察取消；
- 地址、协议与 CDP 版本来自 `packages/browser/src/browser-policy.data.json`。

右侧浏览器面板遵循 AquaWisp 设计系统的 280px 宽度、中文标题和 SVG 图标。打包态测试要求主 renderer、webview renderer 与独立 runtime 同时存活。

## 当前边界

当前已建立可视 webview、安全 tab/CDP 生命周期，以及带严格输入校验、requestId 幂等、超时、取消和后端代际隔离的命令桥。后续 M6 工作还需把完整命令面、ref 快照、截图、下载、对话框、录屏与一键入库接到 main 侧执行器。任何网页内容和 CDP 观察仍按不可信数据处理。
