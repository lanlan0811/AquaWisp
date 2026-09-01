# 密钥存储与 IPC 边界

AquaWisp 的 provider API key 由 Electron main 进程持有。`SecretVault` 使用 Electron `safeStorage` 调用 Windows DPAPI 或 macOS Keychain 支持的系统加密，并把密文注册表写入应用用户数据目录。明文不会写入工作区、SQLite、日志或 Git 仓库。

renderer 通过沙箱 preload 暴露的窄接口只能执行：

- 保存一个命名 secret；
- 检查命名 secret 是否存在；
- 删除命名 secret；
- 检查独立 runtime 是否连通。

renderer 没有读取或解密方法。Electron main 对每个 IPC payload 进行 schema 校验，并要求发送方是当前主窗口的 `webContents`。IPC channel、密文大小、secret 长度和文件名都来自 `apps/desktop/src/desktop-config.data.json`。

preload 源文件由同一配置确定性生成。`npm run preload` 更新源文件，`npm run preload:check` 检查漂移，桌面构建只在检查通过后复制到 `dist`。窗口保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，拒绝新窗口和页面导航。

runtime 后续需要 provider key 时，必须通过新增的受控、可审计 main↔runtime 请求按次取得；不能把整个密钥注册表或永久明文副本传给 runtime。
