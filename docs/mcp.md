# stdio MCP 客户端

AquaWisp 首版只支持本地 stdio MCP server。实现位于 `packages/tools`，使用官方 TypeScript SDK 启动子进程并完成 MCP 握手、工具发现与工具调用；不会自动连接网络传输。

## 默认状态

内置注册表 `packages/tools/src/mcp-registry.data.json` 默认没有启用任何 server。server 必须先经过版本化 schema 校验，并显式声明：

- 稳定且唯一的 server id；
- 可执行文件、参数与工作区内的相对 cwd；
- 精确的工具白名单；
- 需要注入的环境变量名映射；
- 是否启用。

示例定义：

```json
{
  "id": "local-search",
  "name": "本地检索服务",
  "command": "node",
  "args": ["tools/local-search-server.mjs"],
  "cwd": ".",
  "environment": {
    "SERVICE_TOKEN": "AQUAWISP_LOCAL_SEARCH_TOKEN"
  },
  "allowedTools": ["search"],
  "enabled": true
}
```

`environment` 的键是传给 server 的变量名，值是 AquaWisp 宿主进程中已有变量的名称。注册表不保存 secret 明文；缺少来源变量时连接会被拒绝。

## 安全边界

- stdio transport 使用可执行文件与 argv 启动，不拼接 shell 命令。
- cwd 解析真实路径后必须位于工作区；符号链接或 junction 越界会被拒绝。
- 发现结果只暴露白名单内工具，调用前再次执行白名单检查。
- 初始化、工具调用、读缓冲、stderr 和观察结果均有配置化上限。
- 所有 MCP 工具结果都标记为 `untrusted`，不能修改权限、策略或审批决定。
- 关闭 host 会关闭所有客户端连接并回收 SDK 持有的 server 子进程。

server 配置本身代表启动本地程序的权限。桌面端接入时仍须经过 AquaWisp 的模式、风险和审批求值，不能因为 server 已写入注册表就绕过动作账本。
