# Built-in Model Catalog

`packages/models-catalog/src/catalog.data.json` is the configuration source for AquaWisp's built-in providers and models. Its zod schema validates provider references, protocol routing, capability metadata, reasoning levels, aliases, request patches, source URLs, and specification status at module load time.

The catalog was verified on 2026-09-01 against provider documentation. GLM-5.3 and DeepSeek V4 use both Chat Completions and Responses in v1. Kimi K3 and Qwen3.8 remain routed through Chat Completions in v1 even when a provider offers other protocols, matching the development plan's staged rollout.

Qwen3.8 uses its current native levels `off`, `low`, `medium`, and `xhigh`; OpenAI-style `minimal`, `high`, and `max` are aliases. DeepSeek maps `medium` to `high` and `xhigh` to `max`, and removes unsupported sampling parameters in thinking mode. GLM-5.3 always sets `thinking.type=enabled`. Kimi never receives a synthetic `thinking` toggle.

Kimi K3's 1M context window is documented, but its 128K maximum output still requires a direct authenticated response-limit check. The value remains explicitly marked `pending_live_verification`; catalog consumers must not present it as officially verified.

## Custom providers

Custom providers use `validateCustomProviderConnection` rather than the built-in catalog lookup. The settings layer must supply a validated provider ID/name, base URL, model capability declaration, and one explicit protocol (`chat_completions` or `responses`). The selected protocol must also be declared by that model; ambiguous automatic protocol fallback is rejected. API keys remain connection secrets and are passed directly to `OpenAICompatibleClient`, never stored in this catalog data.

Primary references:

- [GLM-5.3 official model page](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
- [DeepSeek model details](https://api-docs.deepseek.com/quick_start/pricing) and [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Kimi API overview](https://www.kimi.ai/help/kimi-api/api-overview)
- [Qwen3.8-Max model details](https://help.aliyun.com/zh/model-studio/qwen3-8-max) and [OpenAI-compatible Chat parameters](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
