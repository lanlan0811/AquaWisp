# 桌面端设置与密钥边界

桌面端把设置分为“普通配置”和“密钥”两条存储路径。

`DesktopSettingsStore` 只保存 provider ID、model ID、OpenAI-compatible 协议、默认思考强度、密钥引用名和默认执行模式。写入前会使用模型目录校验 provider/model 归属、协议支持和思考强度，别名会归一化为正式档位。文件使用同目录临时文件原子替换，在 macOS 上设为仅当前用户可读写。默认值位于经过 schema 校验的 `desktop-config.data.json`。

API key 仍只进入 `SecretVault` 和 Electron `safeStorage`，不会出现在 `settings.json`。sandbox preload 仅暴露 `secrets.set/has/delete`，没有 `get` 或 `decrypt`；设置页保存 key 后立即清空密码输入框，只显示“已保存”状态。

设置页使用内置模型目录联动 provider、model、协议和思考强度。默认执行模式只能选择“计划 / 工作”；“完全访问”只能在会话输入卡中经高风险确认后临时启用，契约和存储边界都拒绝将它持久化。renderer 脚本由每窗口一次性 nonce 授权；CSP 不允许无 nonce 的内联脚本。

早期版本如已将 `full_access` 写入设置，读取时会安全降级为当前配置的默认模式，避免升级后无法启动，也不会在未确认时保留高权限。

当前设置仅覆盖内置 provider。自定义 OpenAI-compatible provider 的 URL 与模型表单会在对话链路接入时使用独立严格 schema，不应通过未校验字段塞入现有设置。
