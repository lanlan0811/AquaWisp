# Built-in Model Catalog

`packages/models-catalog/src/catalog.data.json` is the configuration source for AquaWisp's built-in providers and models. Its zod schema validates provider references, protocol routing, capability metadata, reasoning levels, aliases, request patches, source URLs, and specification status at module load time.

The catalog was verified on 2026-09-02 against provider documentation. GLM-5.3 and DeepSeek V4 use both Chat Completions and Responses in v1. Kimi K3 and Qwen3.8 remain routed through Chat Completions in v1 even when a provider offers other protocols, matching the development plan's staged rollout.

Qwen3.8 uses its current native levels `off`, `low`, `medium`, and `xhigh`; OpenAI-style `minimal`, `high`, and `max` are aliases. DeepSeek maps `medium` to `high` and `xhigh` to `max`, and removes unsupported sampling parameters in thinking mode. GLM-5.3 always sets `thinking.type=enabled`. Kimi never receives a synthetic `thinking` toggle.

Kimi K3 declares a 1,048,576-token context window and a maximum of 1,048,576 completion tokens. Its documented Partial Mode is represented as a catalog-owned recovery patch (`partial: true`) on the assistant prefix, so the generic runtime adapter does not contain provider-name branches. Live probes still verify connectivity and response shape, but no catalog limit remains marked as inferred or pending.

## Custom providers

Custom providers use `validateCustomProviderConnection` rather than the built-in catalog lookup. The settings layer must supply a validated provider ID/name, base URL, model capability declaration, and one explicit protocol (`chat_completions` or `responses`). The selected protocol must also be declared by that model; ambiguous automatic protocol fallback is rejected. API keys remain connection secrets and are passed directly to `OpenAICompatibleClient`, never stored in this catalog data.

Primary references:

- [GLM-5.3 official model page](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)
- [DeepSeek model details](https://api-docs.deepseek.com/quick_start/pricing) and [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Kimi K3 quickstart and limits](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)
- [Qwen3.8-Max model details](https://help.aliyun.com/zh/model-studio/qwen3-8-max) and [OpenAI-compatible Chat parameters](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
