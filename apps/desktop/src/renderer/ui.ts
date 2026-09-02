import { builtInModelCatalog } from "@aquawisp/models-catalog";

export type DesktopMode = "plan" | "work" | "full_access";
export interface DesktopViewState {
  readonly mode: DesktopMode;
  readonly workspaceName: string;
  readonly modelName: string;
  readonly running: boolean;
  readonly runtimeStatus: "connected" | "disconnected";
  readonly browserVisible: boolean;
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: "chat_completions" | "responses";
  readonly reasoningLevel: string;
  readonly secretName: string;
}
export function createDesktopDocument(state: DesktopViewState, scriptNonce: string): string {
  if (!/^[A-Za-z0-9+/=]{16,128}$/u.test(scriptNonce)) {
    throw new Error("Desktop script nonce must be a non-empty base64 value");
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'"><title>沧渡 AquaWisp</title><style>${desktopStyles}</style></head><body>${createDesktopMarkup(state)}<script nonce="${scriptNonce}">${desktopRendererScript}</script></body></html>`;
}
export function createDesktopMarkup(state: DesktopViewState): string {
  const label = { plan: "计划", work: "工作", full_access: "完全访问" }[state.mode];
  const runtimeLabel = state.runtimeStatus === "connected" ? "运行时已连接" : "运行时未连接";
  const browserPanel = state.browserVisible
    ? `<aside class="browser-panel"><header>${icon("browser")}可视浏览器</header><div class="browser-address"><input aria-label="浏览器地址" value="about:blank" readonly></div><webview src="about:blank"></webview></aside>`
    : "";
  const providers = builtInModelCatalog.providers
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}"${provider.id === state.providerId ? " selected" : ""}>${escapeHtml(provider.name)}</option>`,
    )
    .join("");
  const models = builtInModelCatalog.models
    .map(
      (model) =>
        `<option value="${escapeHtml(model.id)}" data-provider="${escapeHtml(model.providerId)}" data-protocols="${escapeHtml(model.supportedProtocols.join(","))}" data-levels="${escapeHtml(model.reasoning.levels.map(({ id }) => id).join(","))}"${model.id === state.modelId ? " selected" : ""}>${escapeHtml(model.name)}</option>`,
    )
    .join("");
  return `<main class="app-shell"><aside class="sidebar"><button class="new-session">${icon("plus")}新建会话</button><nav><button class="nav active" data-view="conversation">${icon("chat")}会话</button><button class="nav" data-view="knowledge">${icon("library")}知识库</button><button class="nav" data-view="settings">${icon("settings")}设置</button></nav><footer><span data-mode-label>${label}</span> · <span data-runtime-label>${runtimeLabel}</span></footer></aside><section class="workspace"><section class="conversation" data-view-panel="conversation"><header>${escapeHtml(state.workspaceName)}<span data-model-label>${escapeHtml(state.modelName)}</span></header><article class="assistant-message"><b>沧</b><p>你好，我是沧渡。你可以让我采集资料、整理知识库或生成文档。</p></article><section class="input-card"><textarea placeholder="帮你采集资料、整理知识库、生成文档报告……"></textarea><button class="send" aria-label="${state.running ? "停止" : "发送"}">${icon(state.running ? "stop" : "send")}</button></section></section><section class="knowledge-view" data-view-panel="knowledge" hidden><header><h1>知识库</h1><button class="secondary">${icon("plus")}添加文件</button></header><div class="empty-state">${icon("library")}<h2>尚未加载知识库列表</h2><p>连接 runtime 后，文档、分段与索引状态会显示在这里。</p></div></section><section class="settings-view" data-view-panel="settings" hidden><header><h1>设置</h1></header><form data-settings-form data-secret-name="${escapeHtml(state.secretName)}"><label>模型供应商<select name="providerId">${providers}</select></label><label>默认模型<select name="modelId">${models}</select></label><label>API 协议<select name="protocol"><option value="chat_completions"${state.protocol === "chat_completions" ? " selected" : ""}>Chat Completions</option><option value="responses"${state.protocol === "responses" ? " selected" : ""}>Responses</option></select></label><label>默认思考强度<select name="reasoningLevel"><option value="${escapeHtml(state.reasoningLevel)}">${escapeHtml(state.reasoningLevel)}</option></select></label><label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="已加密保存的 key 不会回显"></label><label>执行模式<select name="mode"><option value="plan"${state.mode === "plan" ? " selected" : ""}>计划</option><option value="work"${state.mode === "work" ? " selected" : ""}>工作</option><option value="full_access"${state.mode === "full_access" ? " selected" : ""}>完全访问</option></select></label><div class="settings-actions"><span data-settings-status>尚未检查密钥</span><button class="primary" type="submit">保存设置</button></div></form></section></section>${browserPanel}</main>`;
}
export const desktopStyles = `:root{--brand:#0e7490;--send:#34b3a0;--side:#f7f7f8;--border:#e8e8ea;--text:#1f2933;font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{margin:0;color:var(--text)}[hidden]{display:none!important}button,select,input,textarea{font:inherit}.app-shell{display:flex;min-height:100vh}.sidebar{box-sizing:border-box;width:220px;flex:none;background:var(--side);border-right:1px solid var(--border);padding:16px;display:flex;flex-direction:column}.new-session,.send,.primary{border:0;border-radius:6px;color:#fff}.new-session{background:var(--brand);padding:8px 16px;font-weight:600}.sidebar nav{display:grid;gap:6px;margin-top:16px}.nav{display:flex;gap:8px;border:0;background:transparent;padding:10px;text-align:left}.nav.active{border-left:3px solid var(--brand);color:var(--brand)}footer{margin-top:auto;font-size:12px}.workspace{flex:1;min-width:0}.conversation,.knowledge-view,.settings-view{height:100vh;box-sizing:border-box;overflow:auto}.conversation header,.knowledge-view header,.settings-view header{height:44px;box-sizing:border-box;border-bottom:1px solid var(--border);padding:10px 24px;display:flex;justify-content:space-between;align-items:center}.knowledge-view h1,.settings-view h1{font-size:16px;margin:0}.assistant-message{display:flex;gap:8px;max-width:860px;margin:24px auto}.assistant-message p{padding:12px 16px;border:1px solid var(--border);border-radius:4px 16px 16px}.input-card{width:min(800px,calc(100% - 48px));margin:40vh auto 24px;border:1px solid var(--border);border-radius:12px;padding:12px;display:flex}.input-card:focus-within{border-color:var(--brand);box-shadow:0 2px 16px rgba(14,116,144,.12)}textarea{flex:1;border:0;min-height:80px;resize:vertical}.send{width:36px;height:36px;background:var(--send)}.empty-state{max-width:520px;margin:18vh auto;text-align:center;color:#667085}.empty-state>svg{width:42px;height:42px}.settings-view form{max-width:680px;margin:28px auto;display:grid;gap:18px}.settings-view label{display:grid;gap:7px;font-weight:600}.settings-view select,.settings-view input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff}.settings-actions{display:flex;align-items:center;justify-content:space-between;color:#667085}.primary{background:var(--brand);padding:9px 16px;font-weight:600}.secondary{border:1px solid var(--border);border-radius:6px;background:#fff;padding:7px 12px;display:flex;gap:6px}.browser-panel{width:280px;flex:none;border-left:1px solid var(--border);display:flex;flex-direction:column}.browser-panel header{height:44px;padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);font-weight:600}.browser-address{padding:8px;border-bottom:1px solid var(--border)}.browser-address input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 8px}.browser-panel webview{flex:1;min-height:480px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}`;
export const desktopRendererScript = `(() => {
  const api = window.aquawisp;
  const form = document.querySelector("[data-settings-form]");
  const provider = form?.elements.namedItem("providerId");
  const model = form?.elements.namedItem("modelId");
  const protocol = form?.elements.namedItem("protocol");
  const reasoning = form?.elements.namedItem("reasoningLevel");
  const mode = form?.elements.namedItem("mode");
  const apiKey = form?.elements.namedItem("apiKey");
  const status = document.querySelector("[data-settings-status]");
  const modeLabels = { plan: "计划", work: "工作", full_access: "完全访问" };
  const showView = (name) => {
    document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== name; });
    document.querySelectorAll("[data-view]").forEach((button) => { button.classList.toggle("active", button.dataset.view === name); });
  };
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  const synchronizeModel = () => {
    if (!(provider instanceof HTMLSelectElement) || !(model instanceof HTMLSelectElement) || !(protocol instanceof HTMLSelectElement) || !(reasoning instanceof HTMLSelectElement)) return;
    for (const option of model.options) option.disabled = option.dataset.provider !== provider.value;
    if (model.selectedOptions[0]?.disabled) model.value = Array.from(model.options).find((option) => !option.disabled)?.value ?? "";
    const selected = model.selectedOptions[0];
    const protocols = selected?.dataset.protocols?.split(",") ?? [];
    for (const option of protocol.options) option.disabled = !protocols.includes(option.value);
    if (protocol.selectedOptions[0]?.disabled) protocol.value = protocols[0] ?? "";
    const levels = selected?.dataset.levels?.split(",") ?? [];
    const currentReasoning = reasoning.value;
    reasoning.replaceChildren(...levels.map((level) => new Option(level, level)));
    if (levels.includes(currentReasoning)) reasoning.value = currentReasoning;
  };
  provider?.addEventListener("change", synchronizeModel);
  model?.addEventListener("change", synchronizeModel);
  synchronizeModel();
  Promise.all([api.runtimePing(), api.settings.get()]).then(async ([runtime, settings]) => {
    document.querySelector("[data-runtime-label]").textContent = runtime.connected ? "运行时已连接" : "运行时未连接";
    const present = await api.secrets.has(settings.secretName);
    if (status) status.textContent = present ? "API Key 已加密保存" : "尚未保存 API Key";
  }).catch(() => { if (status) status.textContent = "设置状态读取失败"; });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(provider instanceof HTMLSelectElement) || !(model instanceof HTMLSelectElement) || !(protocol instanceof HTMLSelectElement) || !(reasoning instanceof HTMLSelectElement) || !(mode instanceof HTMLSelectElement) || !(apiKey instanceof HTMLInputElement)) return;
    if (status) status.textContent = "正在保存…";
    try {
      const secretName = form.dataset.secretName;
      if (!secretName) throw new Error("密钥名称缺失");
      if (apiKey.value.trim()) await api.secrets.set(secretName, apiKey.value);
      const saved = await api.settings.set({ providerId: provider.value, modelId: model.value, protocol: protocol.value, reasoningLevel: reasoning.value, secretName, mode: mode.value });
      apiKey.value = "";
      document.querySelector("[data-mode-label]").textContent = modeLabels[saved.mode];
      document.querySelector("[data-model-label]").textContent = model.selectedOptions[0]?.textContent ?? saved.modelId;
      if (status) status.textContent = "设置已保存";
    } catch (error) { if (status) status.textContent = error instanceof Error ? error.message : "设置保存失败"; }
  });
})();`;
function icon(
  name: "plus" | "chat" | "library" | "settings" | "send" | "stop" | "browser",
): string {
  const paths = {
    plus: "M12 5v14M5 12h14",
    chat: "M4 5h16v11H8l-4 3V5Z",
    library: "M5 4h5v16H5zM14 4h5v16h-5z",
    settings:
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-6v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1",
    send: "m4 4 16 8-16 8 3-8-3-8Z",
    stop: "M7 7h10v10H7z",
    browser: "M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01",
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
