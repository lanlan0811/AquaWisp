# 密钥存储与 IPC 边界

AquaWisp 的 provider API key 由 Electron main 进程持有。`SecretVault` 使用 Electron `safeStorage` 调用 Windows DPAPI 或 macOS Keychain 支持的系统加密，并把密文注册表写入应用用户数据目录。明文不会写入工作区、SQLite、日志或 Git 仓库。

renderer 通过沙箱 preload 暴露的窄接口只能执行：

- 保存一个命名 secret；
- 检查命名 secret 是否存在；
- 删除命名 secret；
- 检查独立 runtime 是否连通。

renderer 没有读取或解密方法。Electron main 对每个 IPC payload 进行 schema 校验，并要求发送方是当前主窗口的 `webContents`。IPC channel、密文大小、secret 长度和文件名都来自 `apps/desktop/src/desktop-config.data.json`。

preload 源文件由同一配置确定性生成。`npm run preload` 更新源文件，`npm run preload:check` 检查漂移，桌面构建只在检查通过后复制到 `dist`。窗口保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，拒绝新窗口和页面导航。

启动模型 Run 时，Electron main 只解密当前设置引用的单个 provider key，并把它随一次受 schema 约束的私有 stdio 请求传给 runtime。renderer 永远看不到明文；runtime 仅在内存中构造模型客户端，不把 key 写入事件、SQLite、响应或日志。它不会接收整个密钥注册表，也不会保留永久明文副本。
