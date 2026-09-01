# 桌面端打包与发布

AquaWisp 桌面端使用 Electron Builder 生成 Windows 与 macOS 安装包。构建配置位于 `apps/desktop/electron-builder.json`，产物统一写入被 Git 忽略的 `release/desktop` 目录。

## 本地构建

先使用仓库根目录声明的 Node.js 与 npm 版本安装依赖并完成校验：

```shell
npm ci
npm run verify
```

生成当前平台的未安装目录包：

```shell
npm run package:desktop:dir
```

在 Windows x64 主机生成 NSIS 安装包：

```shell
npm run package:desktop:win
```

在 macOS 主机生成 Intel 与 Apple Silicon DMG：

```shell
npm run package:desktop:mac
```

跨平台构建不能替代目标平台验收。Windows 安装包应在 Windows 10 x64 干净虚拟机验证；两种 macOS 架构应分别在对应设备或受控 CI runner 验证。

## 图标与签名

品牌图标的可编辑源文件是 `apps/desktop/build-resources/icon.svg`。正式发布前从该 SVG 确定性导出 Windows `.ico` 与 macOS `.icns`，不得使用 emoji、系统字体字符或来源不明的位图代替。

代码签名证书、私钥和公证凭据只能通过本机安全凭据库或 CI secret 注入，不能写入仓库。未配置凭据时生成的包仅用于内部验证，不应作为公开发布包。

## 发布检查表

1. 将根包和桌面包版本同步更新为计划发布版本。
2. 运行 `npm ci`、`npm run verify` 与目标平台打包命令。
3. 检查产物只包含运行必需的 `dist` 文件和包元数据。
4. 完成签名、公证以及签名结果验证。
5. 在干净系统验证安装、首次启动、卸载、数据目录保留策略和升级路径。
6. 记录产物 SHA-256、构建环境、提交号和验收结果。
