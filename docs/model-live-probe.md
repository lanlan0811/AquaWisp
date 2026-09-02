# 真实模型连通性探测

M2 的真实连通性探测复用正式 OpenAI-compatible 客户端与思考强度归一化层。探测不会记录 API key，也不会把密钥写入文件。

## 运行

在 PowerShell 中临时设置如下环境变量后运行 `npm run model:probe`：

```powershell
$env:AQUAWISP_MODEL_API_KEY = "..."
$env:AQUAWISP_MODEL_BASE_URL = "https://provider.example/v1"
$env:AQUAWISP_MODEL_ID = "model-id"
$env:AQUAWISP_MODEL_PROTOCOL = "chat_completions"
$env:AQUAWISP_MODEL_PROMPT = "请只回复：连通成功"
$env:AQUAWISP_MODEL_REASONING_LEVEL = "high"
npm run model:probe
```

macOS zsh 使用同名环境变量即可。协议只能是 `chat_completions` 或 `responses`，模型 ID 必须是当前内置目录的模型。探测输出包含基准 URL、模型、协议、事件数量、结束原因和模型文本，但不包含密钥。

## 验证范围

对四家内置供应商各执行一次探测，分别覆盖目录声明的协议：GLM、DeepSeek 覆盖 Chat Completions 与 Responses；Kimi、Qwen 覆盖 Chat Completions。目录中的静态限制来自供应商官方文档；真实探测只验证当前凭据、网络连通性和响应结构。任何可能产生费用的极限输出压力测试，都必须另行取得项目拥有者授权并设定明确成本预算。
