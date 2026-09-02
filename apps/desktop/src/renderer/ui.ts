import { builtInModelCatalog } from "@aquawisp/models-catalog";
import type { DesktopSessionMode } from "@aquawisp/contracts";

import { desktopConfig } from "../desktop-config.js";

export type DesktopMode = DesktopSessionMode;
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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'"><title>沧渡 AquaWisp</title><style>${desktopStyles}${knowledgeStyles}${sourceStyles}${actionStyles}${approvalStyles}</style></head><body>${createDesktopMarkup(state)}<script nonce="${scriptNonce}">${desktopRendererScript}</script></body></html>`;
}
export function createDesktopMarkup(state: DesktopViewState): string {
  const modeDefinitions = desktopConfig.executionModes;
  const label = modeDefinitions.find(({ id }) => id === state.mode)?.label ?? state.mode;
  const modeButtons = modeDefinitions
    .map(
      (mode) =>
        `<button type="button" class="input-mode${mode.id === state.mode ? " active" : ""}" data-session-mode="${mode.id}" aria-pressed="${mode.id === state.mode ? "true" : "false"}" title="${escapeHtml(mode.description)}">${escapeHtml(mode.label)}</button>`,
    )
    .join("");
  const defaultModeOptions = modeDefinitions
    .filter(({ canBeDefault }) => canBeDefault)
    .map(
      (mode) =>
        `<option value="${mode.id}"${mode.id === state.mode ? " selected" : ""}>${escapeHtml(mode.label)}</option>`,
    )
    .join("");
  const runtimeLabel = state.runtimeStatus === "connected" ? "运行时已连接" : "运行时未连接";
  const browserTab = state.browserVisible
    ? `<button class="right-tab" data-right-tab="browser">${icon("browser")}<span>浏览器</span></button>`
    : "";
  const browserBody = state.browserVisible
    ? `<section class="right-body browser-body" data-right-body="browser" hidden><div class="browser-address"><input aria-label="浏览器地址" value="about:blank" readonly></div><webview src="about:blank"></webview></section>`
    : "";
  const rightPanel = `<aside class="right-panel"><div class="right-tabs"><button class="right-tab active" data-right-tab="sources">${icon("source")}<span>来源</span><small data-source-count>0</small></button>${browserTab}<button class="right-tab" data-right-tab="artifacts">${icon("artifact")}<span>工件</span></button></div><section class="right-body source-body" data-right-body="sources"><p class="right-section-title">检索来源</p><div class="source-list" data-source-list></div><div class="right-empty" data-source-empty>${icon("source")}<p>让沧渡检索知识库后，命中内容会显示在这里。</p></div></section>${browserBody}<section class="right-body" data-right-body="artifacts" hidden><div class="right-empty">${icon("artifact")}<p>运行产生的工件会显示在这里。</p></div></section><template data-source-icon="file">${icon("file")}</template><template data-source-icon="web">${icon("web")}</template><template data-source-icon="manual">${icon("manual")}</template><template data-action-icon="file">${icon("file")}</template><template data-action-icon="search">${icon("search")}</template><template data-action-icon="write">${icon("write")}</template><template data-action-icon="terminal">${icon("terminal")}</template><template data-action-icon="browser">${icon("browser")}</template><template data-action-icon="generic">${icon("action")}</template><template data-action-state-icon="progress">${icon("progress")}</template><template data-action-state-icon="verified">${icon("check")}</template><template data-action-state-icon="warning">${icon("warning")}</template></aside>`;
  const providers = builtInModelCatalog.providers
    .map(
      (provider) =>
        `<option value="${escapeHtml(provider.id)}"${provider.id === state.providerId ? " selected" : ""}>${escapeHtml(provider.name)}</option>`,
    )
    .join("");
  const models = builtInModelCatalog.models
    .map(
      (model) =>
        `<option value="${escapeHtml(model.id)}" data-provider="${escapeHtml(model.providerId)}" data-protocols="${escapeHtml(model.supportedProtocols.join(","))}" data-levels="${escapeHtml(model.reasoning.levels.map(({ id }) => id).join(","))}" data-default-level="${escapeHtml(model.reasoning.defaultLevel)}"${model.id === state.modelId ? " selected" : ""}>${escapeHtml(model.name)}</option>`,
    )
    .join("");
  const sessionModels = builtInModelCatalog.models.filter(
    (model) =>
      model.providerId === state.providerId && model.supportedProtocols.includes(state.protocol),
  );
  const selectedSessionModel =
    sessionModels.find(({ id }) => id === state.modelId) ?? sessionModels[0];
  if (selectedSessionModel === undefined) {
    throw new Error("Configured provider and protocol have no compatible session model");
  }
  const sessionModelOptions = sessionModels
    .map(
      (model) =>
        `<option value="${escapeHtml(model.id)}" data-levels="${escapeHtml(model.reasoning.levels.map(({ id }) => id).join(","))}" data-default-level="${escapeHtml(model.reasoning.defaultLevel)}"${model.id === selectedSessionModel.id ? " selected" : ""}>${escapeHtml(model.name)}</option>`,
    )
    .join("");
  const sessionReasoningOptions = selectedSessionModel.reasoning.levels
    .map(
      ({ id }) =>
        `<option value="${escapeHtml(id)}"${id === state.reasoningLevel ? " selected" : ""}>${escapeHtml(id)}</option>`,
    )
    .join("");
  return `<main class="app-shell"><aside class="sidebar"><button class="new-session" data-new-session>${icon("plus")}新建会话</button><nav><button class="nav active" data-view="conversation">${icon("chat")}会话</button><button class="nav" data-view="knowledge">${icon("library")}知识库</button><button class="nav" data-view="settings">${icon("settings")}设置</button></nav><footer><span data-mode-label>${label}</span> · <span data-runtime-label>${runtimeLabel}</span></footer></aside><section class="workspace"><section class="conversation" data-view-panel="conversation"><header>${escapeHtml(state.workspaceName)}<span data-model-label>${escapeHtml(selectedSessionModel.name)}</span></header><section class="message-list" data-conversation-messages aria-live="polite"><article class="assistant-message"><b>沧</b><div class="message-body"><p>你好，我是沧渡。你可以让我采集资料、整理知识库或生成文档。</p></div></article></section><section class="input-card"><textarea data-conversation-input placeholder="帮你采集资料、整理知识库、生成文档报告……"></textarea><div class="input-toolbar"><div class="input-mode-selector" data-mode-selector role="group" aria-label="本会话执行模式">${modeButtons}</div><div class="input-toolbar-actions"><select class="input-model-selector" data-session-model aria-label="会话模型">${sessionModelOptions}</select><select class="input-reasoning-selector" data-session-reasoning aria-label="会话思考强度">${sessionReasoningOptions}</select><button class="send" data-conversation-send data-running="${state.running ? "true" : "false"}" aria-label="${state.running ? "停止" : "发送"}"><span data-send-icon${state.running ? " hidden" : ""}>${icon("send")}</span><span data-stop-icon${state.running ? "" : " hidden"}>${icon("stop")}</span></button></div></div></section></section><section class="knowledge-view" data-view-panel="knowledge" hidden><header><h1>知识库</h1><button class="secondary" data-knowledge-add>${icon("plus")}添加文件</button></header><div class="knowledge-summary" aria-live="polite"><div><strong data-knowledge-documents>—</strong><span>个来源</span></div><div><strong data-knowledge-chunks>—</strong><span>个分段</span></div><p data-knowledge-status>打开知识库时自动读取本地索引。</p></div><section class="knowledge-list" data-knowledge-list></section><div class="empty-state" data-knowledge-empty>${icon("library")}<h2>知识库为空</h2><p>添加 Markdown、PDF 或 Office 文档，沧渡会在本地提取并建立分段索引。</p></div><dialog class="knowledge-dialog" data-knowledge-remove-dialog><form method="dialog"><h2>确认移除来源</h2><p>将从本地知识库删除“<strong data-knowledge-remove-title></strong>”及其分段索引，原文件不会被删除。</p><menu><button value="cancel">取消</button><button value="confirm">确认移除</button></menu></form></dialog></section><section class="settings-view" data-view-panel="settings" hidden><header><h1>设置</h1></header><form data-settings-form data-secret-name="${escapeHtml(state.secretName)}"><label>模型供应商<select name="providerId">${providers}</select></label><label>默认模型<select name="modelId">${models}</select></label><label>API 协议<select name="protocol"><option value="chat_completions"${state.protocol === "chat_completions" ? " selected" : ""}>Chat Completions</option><option value="responses"${state.protocol === "responses" ? " selected" : ""}>Responses</option></select></label><label>默认思考强度<select name="reasoningLevel"><option value="${escapeHtml(state.reasoningLevel)}">${escapeHtml(state.reasoningLevel)}</option></select></label><label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="已加密保存的 key 不会回显"></label><label>默认执行模式<select name="mode">${defaultModeOptions}</select><small>完全访问仅能在会话中确认后临时启用，不会作为默认值保存。</small></label><div class="settings-actions"><span data-settings-status>尚未检查密钥</span><button class="primary" type="submit">保存设置</button></div></form></section></section>${rightPanel}<dialog class="source-dialog" data-source-dialog aria-labelledby="source-detail-title"><form method="dialog"><header><div><span>知识库来源</span><h2 id="source-detail-title" data-source-detail-title></h2></div><button value="close" aria-label="关闭来源详情">${icon("close")}</button></header><dl><div><dt>类型</dt><dd data-source-detail-type></dd></div><div><dt>分段</dt><dd data-source-detail-ordinal></dd></div><div><dt>入库时间</dt><dd data-source-detail-time></dd></div><div><dt>标签</dt><dd data-source-detail-tags></dd></div><div><dt>URI</dt><dd data-source-detail-uri></dd></div></dl><p data-source-detail-content></p></form></dialog><dialog class="full-access-dialog" data-full-access-dialog aria-labelledby="full-access-title"><form method="dialog"><div class="approval-heading">${icon("warning")}<div><h2 id="full-access-title">启用完全访问？</h2><p>这是仅对当前会话生效的高风险模式。</p></div></div><div class="full-access-impact"><strong>启用后会发生什么</strong><p>沧渡可执行原本需要逐项确认的高风险动作，包括工作区外写入、删除、网络发送和系统配置变更。所有动作仍会记入可审计账本。</p><p>它不会保存为默认模式；新建会话时将恢复你在设置中选择的默认模式。</p></div><menu><button value="cancel">取消</button><button value="enable">启用完全访问</button></menu></form></dialog><dialog class="approval-dialog" data-approval-dialog aria-labelledby="approval-title"><form method="dialog"><div class="approval-heading">${icon("warning")}<div><h2 id="approval-title">需要你的确认</h2><p>沧渡想要执行以下操作：</p></div></div><dl><div><dt>操作</dt><dd data-approval-action></dd></div><div><dt>目标</dt><dd data-approval-target></dd></div><div><dt>需要确认的原因</dt><dd data-approval-reason></dd></div><div><dt>可能影响</dt><dd data-approval-impact></dd></div></dl><label class="approval-remember"><input type="checkbox" data-approval-remember>本会话内，相同操作、目标和影响范围总是允许</label><p class="approval-error" data-approval-error aria-live="assertive"></p><menu><button class="approval-deny" value="deny">拒绝</button><button class="approval-approve" value="approve" data-approval-approve>仅此一次允许</button></menu></form></dialog></main>`;
}
export const desktopStyles = `:root{--brand:#0e7490;--brand-weak:#e0f2f7;--send:#34b3a0;--side:#f7f7f8;--border:#e8e8ea;--text:#1f2933;--weak:#5f6b76;--danger:#b91c1c;--surface:#fff;font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{margin:0;color:var(--text)}[hidden]{display:none!important}button,select,input,textarea{font:inherit}.app-shell{display:flex;min-height:100vh}.sidebar{box-sizing:border-box;width:220px;flex:none;background:var(--side);border-right:1px solid var(--border);padding:16px;display:flex;flex-direction:column}.new-session,.send,.primary{border:0;border-radius:6px;color:#fff}.new-session{background:var(--brand);padding:8px 16px;font-weight:600}.sidebar nav{display:grid;gap:6px;margin-top:16px}.nav{display:flex;gap:8px;border:0;background:transparent;padding:10px;text-align:left}.nav.active{border-left:3px solid var(--brand);color:var(--brand)}footer{margin-top:auto;font-size:12px}.workspace{flex:1;min-width:0}.conversation,.knowledge-view,.settings-view{height:100vh;box-sizing:border-box;overflow:auto}.conversation{display:flex;flex-direction:column}.conversation header,.knowledge-view header,.settings-view header{height:44px;box-sizing:border-box;border-bottom:1px solid var(--border);padding:10px 24px;display:flex;justify-content:space-between;align-items:center}.knowledge-view h1,.settings-view h1{font-size:16px;margin:0}.message-list{flex:1;overflow:auto;padding:0 24px}.assistant-message,.user-message{display:flex;gap:8px;max-width:860px;margin:24px auto}.assistant-message b,.user-message b{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--brand);color:#fff}.message-body{min-width:0}.assistant-message p,.user-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:12px 16px;border:1px solid var(--border);border-radius:4px 16px 16px}.user-message{flex-direction:row-reverse}.user-message b{background:#475467}.user-message p{background:#ecfdf8;border-color:#c6eee5;border-radius:16px 4px 16px 16px}.input-card{box-sizing:border-box;width:min(800px,calc(100% - 48px));margin:12px auto 24px;border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}.input-card:focus-within{border-color:var(--brand);box-shadow:0 2px 16px rgba(14,116,144,.12)}.input-card textarea{box-sizing:border-box;width:100%;min-height:80px;max-height:200px;border:0;padding:12px 16px;resize:vertical;outline:0}.input-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px}.input-mode-selector{display:inline-flex;align-items:center;min-width:0;border-radius:6px;background:var(--side);padding:2px}.input-mode{border:0;border-radius:4px;background:transparent;color:var(--weak);padding:4px 10px;white-space:nowrap;font-size:12px}.input-mode:hover{color:var(--text)}.input-mode.active{background:var(--surface);color:var(--brand);font-weight:600}.input-mode:disabled{cursor:not-allowed;opacity:.55}.input-toolbar-actions{display:flex;align-items:center;gap:8px;min-width:0}.input-model-selector,.input-reasoning-selector{min-width:0;max-width:132px;border:1px solid var(--border);border-radius:6px;background:var(--surface);padding:5px 7px;color:var(--text);font-size:12px}.input-reasoning-selector{max-width:76px}.input-model-selector:disabled,.input-reasoning-selector:disabled{cursor:not-allowed;opacity:.55}.send{width:36px;height:36px;flex:none;background:var(--send);display:grid;place-items:center}.send[data-running=true]{background:#b42318}.send span{display:grid;place-items:center}.empty-state{max-width:520px;margin:18vh auto;text-align:center;color:#667085}.empty-state>svg{width:42px;height:42px}.settings-view form{max-width:680px;margin:28px auto;display:grid;gap:18px}.settings-view label{display:grid;gap:7px;font-weight:600}.settings-view label small{color:var(--weak);font-weight:400;line-height:1.5}.settings-view select,.settings-view input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff}.settings-actions{display:flex;align-items:center;justify-content:space-between;color:#667085}.primary{background:var(--brand);padding:9px 16px;font-weight:600}.secondary{border:1px solid var(--border);border-radius:6px;background:#fff;padding:7px 12px;display:flex;gap:6px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}@media(max-width:1080px){.input-mode{padding-inline:6px}.input-model-selector{max-width:94px}.input-reasoning-selector{max-width:64px}}`;
const knowledgeStyles = `.knowledge-summary{box-sizing:border-box;max-width:860px;margin:24px auto 12px;padding:16px;display:flex;align-items:center;gap:24px;border:1px solid var(--border);border-radius:12px;background:var(--side)}.knowledge-summary div{display:grid;min-width:84px}.knowledge-summary strong{font-size:20px;color:var(--brand)}.knowledge-summary span,.knowledge-summary p{font-size:12px;color:var(--weak)}.knowledge-summary p{margin:0 0 0 auto}.knowledge-list{box-sizing:border-box;max-width:860px;margin:0 auto 24px;display:grid;gap:12px}.knowledge-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:16px;border:1px solid var(--border);border-radius:6px;background:var(--surface)}.knowledge-card h2{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}.knowledge-card-meta{margin:0;color:var(--weak);font-size:12px}.knowledge-card-uri{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--weak);font-size:12px}.knowledge-card .remove-source{grid-column:2;grid-row:1/4;align-self:center;border:1px solid var(--danger);border-radius:6px;background:transparent;color:var(--danger);padding:7px 12px}.knowledge-card .remove-source:hover{background:var(--danger);color:#fff}.knowledge-view .empty-state{margin-top:12vh}.knowledge-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(440px,calc(100% - 32px));border:1px solid var(--danger);border-radius:12px;padding:24px;color:var(--text)}.knowledge-dialog::backdrop{background:rgba(0,0,0,.4)}.knowledge-dialog h2{margin:0 0 8px;font-size:20px}.knowledge-dialog p{margin:0 0 16px;line-height:1.6}.knowledge-dialog menu{display:flex;justify-content:flex-end;gap:12px;margin:0;padding:0}.knowledge-dialog button{border-radius:6px;padding:8px 16px}.knowledge-dialog [value=cancel]{border:1px solid var(--border);background:var(--surface)}.knowledge-dialog [value=confirm]{border:0;background:var(--danger);color:#fff}@media(max-width:1080px){.knowledge-summary,.knowledge-list{margin-left:24px;margin-right:24px}.knowledge-summary{align-items:flex-start;flex-wrap:wrap}.knowledge-summary p{flex-basis:100%;margin:0}}`;
export const sourceStyles = `.right-panel{box-sizing:border-box;width:280px;height:100vh;flex:none;border-left:1px solid var(--border);background:var(--side);display:flex;flex-direction:column}.right-tabs{height:44px;box-sizing:border-box;border-bottom:1px solid var(--border);display:flex}.right-tab{position:relative;min-width:0;flex:1;border:0;background:transparent;color:var(--weak);display:flex;align-items:center;justify-content:center;gap:5px;font-size:12px}.right-tab.active{color:var(--brand);font-weight:600}.right-tab.active::after{content:"";position:absolute;inset:auto 10px 0;height:2px;background:var(--brand)}.right-tab small{min-width:16px;border-radius:9999px;background:var(--border);font-size:10px}.right-body{min-height:0;flex:1;overflow:auto}.right-section-title{margin:12px 12px 8px;color:var(--weak);font-size:12px}.right-empty{box-sizing:border-box;padding:64px 20px;text-align:center;color:var(--weak);font-size:12px;line-height:1.6}.right-empty svg{width:28px;height:28px}.source-list{display:grid;gap:8px;padding:0 8px 12px}.source-card{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:6px;background:var(--surface);padding:10px;text-align:left;display:grid;grid-template-columns:20px minmax(0,1fr);gap:5px 8px;color:var(--text)}.source-card:hover,.source-card:focus-visible{border-color:var(--brand)}.source-card>svg{grid-row:1/4;color:var(--brand)}.source-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.source-card small{color:var(--weak)}.source-card .source-preview{grid-column:2;margin:0;display:-webkit-box;overflow:hidden;-webkit-line-clamp:3;-webkit-box-orient:vertical;color:var(--weak);font-size:12px;line-height:1.5}.source-card mark{background:var(--brand-weak);color:inherit}.message-sources{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.message-source{border:0;border-radius:9999px;background:var(--side);color:var(--brand);padding:4px 8px;font-size:12px;display:flex;align-items:center;gap:4px}.message-source svg{width:14px;height:14px}.browser-body{display:flex;flex-direction:column}.browser-address{padding:8px;border-bottom:1px solid var(--border)}.browser-address input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 8px}.browser-body webview{flex:1;min-height:480px}.source-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(680px,calc(100% - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--border);border-radius:12px;padding:24px;background:var(--surface);color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.12)}.source-dialog::backdrop{background:rgba(0,0,0,.4)}.source-dialog header{display:flex;justify-content:space-between;gap:16px}.source-dialog header span{color:var(--weak);font-size:12px}.source-dialog h2{margin:4px 0 0;font-size:20px}.source-dialog header button{width:32px;height:32px;border:0;border-radius:6px;background:transparent}.source-dialog dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin:20px 0;padding:16px;border:1px solid var(--border);border-radius:6px}.source-dialog dl div{min-width:0}.source-dialog dt{color:var(--weak);font-size:12px}.source-dialog dd{margin:4px 0 0;overflow-wrap:anywhere;font-size:13px}.source-dialog [data-source-detail-uri]{font-family:ui-monospace,Consolas,"Cascadia Mono",monospace}.source-dialog>form>p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}@media(max-width:1080px){.right-panel{width:240px}}`;
const approvalStyles = `.approval-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(480px,calc(100% - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--danger);border-radius:12px;padding:24px;background:var(--surface);color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.12)}.approval-dialog::backdrop{background:rgba(0,0,0,.4)}.approval-heading{display:flex;align-items:flex-start;gap:12px}.approval-heading>svg{width:40px;height:40px;flex:none;color:var(--danger)}.approval-heading h2{margin:0;font-size:20px}.approval-heading p{margin:4px 0 0;color:var(--weak)}.approval-dialog dl{display:grid;gap:8px;margin:16px 0;padding:16px;border:1px solid var(--border);border-radius:6px;background:var(--side)}.approval-dialog dl div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px}.approval-dialog dt{color:var(--weak)}.approval-dialog dd{margin:0;overflow-wrap:anywhere}.approval-remember{display:flex;align-items:flex-start;gap:8px;line-height:1.5}.approval-remember input{width:16px;height:16px;margin-top:3px;accent-color:var(--brand);flex:none}.approval-error{min-height:20px;margin:8px 0 0;color:var(--danger);font-size:12px}.approval-dialog menu{display:flex;justify-content:flex-end;gap:12px;margin:8px 0 0;padding:0}.approval-dialog button{border-radius:6px;padding:8px 16px;font-weight:600}.approval-deny{border:1px solid var(--danger);background:transparent;color:var(--danger)}.approval-deny:hover{background:var(--danger);color:#fff}.approval-approve{border:0;background:var(--brand);color:#fff}.approval-dialog button:focus-visible,.approval-remember input:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.full-access-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(500px,calc(100% - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--danger);border-radius:12px;padding:24px;background:var(--surface);color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.12)}.full-access-dialog::backdrop{background:rgba(0,0,0,.4)}.full-access-impact{margin:18px 0;padding:16px;border:1px solid var(--border);border-radius:6px;background:var(--side)}.full-access-impact p{margin:8px 0 0;color:var(--weak);line-height:1.6}.full-access-dialog menu{display:flex;justify-content:flex-end;gap:12px;margin:0;padding:0}.full-access-dialog button{border-radius:6px;padding:8px 16px;font-weight:600}.full-access-dialog [value=cancel]{border:1px solid var(--border);background:var(--surface)}.full-access-dialog [value=enable]{border:0;background:var(--danger);color:#fff}`;
export const actionStyles = `.message-actions{--ledger-planned:#6b7280;--ledger-authorized:#2563eb;--ledger-dispatched:#0891b2;--ledger-observed:#7c3aed;--ledger-verified:#15803d;--ledger-unknown:#ea580c;display:grid;gap:8px;margin-top:8px}.action-card{border:1px solid var(--border);border-radius:6px;background:var(--surface);overflow:hidden}.action-card[data-action-state=unknown]{border-color:var(--ledger-unknown)}.action-card[data-action-state=denied]{border-color:var(--danger)}.action-card summary{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;list-style:none}.action-card summary::-webkit-details-marker{display:none}.action-card summary>svg{color:var(--brand)}.action-summary{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.action-state{display:inline-flex;align-items:center;gap:4px;border-radius:9999px;padding:3px 7px;color:var(--action-state-color);background:color-mix(in srgb,var(--action-state-color) 9%,transparent);font-size:11px}.action-state svg{width:13px;height:13px}.action-card[data-action-state=planned]{--action-state-color:var(--ledger-planned)}.action-card[data-action-state=authorized]{--action-state-color:var(--ledger-authorized)}.action-card[data-action-state=dispatched]{--action-state-color:var(--ledger-dispatched)}.action-card[data-action-state=observed]{--action-state-color:var(--ledger-observed)}.action-card[data-action-state=verified]{--action-state-color:var(--ledger-verified)}.action-card[data-action-state=unknown]{--action-state-color:var(--ledger-unknown)}.action-card[data-action-state=denied]{--action-state-color:var(--danger)}.action-detail{border-top:1px solid var(--border);padding:10px 12px;background:var(--side)}.action-detail pre{max-height:180px;overflow:auto;margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Consolas,"Cascadia Mono",monospace;color:var(--weak)}.action-timeline{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:8px;color:var(--weak);font-size:11px}.action-timeline span:not(:last-child)::after{content:"→";margin-left:5px;color:var(--border)}}`;
export const desktopRendererScript = `(() => {
  const modeDefinitions = ${escapeJsonForScript(desktopConfig.executionModes)};
  const actionLedgerConfig = ${escapeJsonForScript(desktopConfig.actionLedger)};
  const api = window.aquawisp;
  const form = document.querySelector("[data-settings-form]");
  const provider = form?.elements.namedItem("providerId");
  const model = form?.elements.namedItem("modelId");
  const protocol = form?.elements.namedItem("protocol");
  const reasoning = form?.elements.namedItem("reasoningLevel");
  const defaultModeSelect = form?.elements.namedItem("mode");
  const apiKey = form?.elements.namedItem("apiKey");
  const status = document.querySelector("[data-settings-status]");
  const messages = document.querySelector("[data-conversation-messages]");
  const conversationInput = document.querySelector("[data-conversation-input]");
  const conversationButton = document.querySelector("[data-conversation-send]");
  const newSessionButton = document.querySelector("[data-new-session]");
  const sendIcon = document.querySelector("[data-send-icon]");
  const stopIcon = document.querySelector("[data-stop-icon]");
  const knowledgeAddButton = document.querySelector("[data-knowledge-add]");
  const knowledgeList = document.querySelector("[data-knowledge-list]");
  const knowledgeEmpty = document.querySelector("[data-knowledge-empty]");
  const knowledgeStatus = document.querySelector("[data-knowledge-status]");
  const knowledgeDocumentCount = document.querySelector("[data-knowledge-documents]");
  const knowledgeChunkCount = document.querySelector("[data-knowledge-chunks]");
  const knowledgeRemoveDialog = document.querySelector("[data-knowledge-remove-dialog]");
  const knowledgeRemoveTitle = document.querySelector("[data-knowledge-remove-title]");
  const approvalDialog = document.querySelector("[data-approval-dialog]");
  const approvalAction = document.querySelector("[data-approval-action]");
  const approvalTarget = document.querySelector("[data-approval-target]");
  const approvalReason = document.querySelector("[data-approval-reason]");
  const approvalImpact = document.querySelector("[data-approval-impact]");
  const approvalRemember = document.querySelector("[data-approval-remember]");
  const approvalApprove = document.querySelector("[data-approval-approve]");
  const approvalError = document.querySelector("[data-approval-error]");
  const sourceList = document.querySelector("[data-source-list]");
  const sourceEmpty = document.querySelector("[data-source-empty]");
  const sourceCount = document.querySelector("[data-source-count]");
  const sourceDialog = document.querySelector("[data-source-dialog]");
  const sourceDetailTitle = document.querySelector("[data-source-detail-title]");
  const sourceDetailType = document.querySelector("[data-source-detail-type]");
  const sourceDetailOrdinal = document.querySelector("[data-source-detail-ordinal]");
  const sourceDetailTime = document.querySelector("[data-source-detail-time]");
  const sourceDetailTags = document.querySelector("[data-source-detail-tags]");
  const sourceDetailUri = document.querySelector("[data-source-detail-uri]");
  const sourceDetailContent = document.querySelector("[data-source-detail-content]");
  const sessionModeButtons = Array.from(document.querySelectorAll("[data-session-mode]"));
  const fullAccessDialog = document.querySelector("[data-full-access-dialog]");
  const sessionModelSelect = document.querySelector("[data-session-model]");
  const sessionReasoningSelect = document.querySelector("[data-session-reasoning]");
  const sourceTypeLabels = { file: "本地文件", web: "网页", manual: "手动资料" };
  let sessionId = "session-" + crypto.randomUUID();
  let activeRunId;
  let activeAssistant;
  let running = false;
  let cancellationRequested = false;
  let knowledgeLoaded = false;
  let pendingKnowledgeRemoval;
  const initialMode = document.querySelector("[data-session-mode][aria-pressed=true]")?.dataset.sessionMode ?? modeDefinitions.find(({ canBeDefault }) => canBeDefault)?.id;
  let defaultMode = initialMode;
  let sessionMode = initialMode;
  let defaultSessionModelId = sessionModelSelect instanceof HTMLSelectElement ? sessionModelSelect.value : undefined;
  let defaultSessionReasoningLevel = sessionReasoningSelect instanceof HTMLSelectElement ? sessionReasoningSelect.value : undefined;
  let pendingSessionMode;
  let activeApproval;
  const actionDetails = new Map();
  const sources = new Map();
  const appendMessage = (role, content) => {
    if (!(messages instanceof HTMLElement)) return undefined;
    const article = document.createElement("article");
    article.className = role === "user" ? "user-message" : "assistant-message";
    const avatar = document.createElement("b");
    avatar.textContent = role === "user" ? "你" : "沧";
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    const body = document.createElement("div");
    body.className = "message-body";
    body.append(paragraph);
    article.append(avatar, body);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return paragraph;
  };
  const setRunning = (nextRunning) => {
    running = nextRunning;
    if (conversationButton instanceof HTMLButtonElement) {
      conversationButton.dataset.running = String(nextRunning);
      conversationButton.setAttribute("aria-label", nextRunning ? "停止" : "发送");
      conversationButton.disabled = nextRunning && activeRunId === undefined;
    }
    if (newSessionButton instanceof HTMLButtonElement) newSessionButton.disabled = nextRunning;
    for (const button of sessionModeButtons) {
      if (button instanceof HTMLButtonElement) button.disabled = nextRunning;
    }
    if (sessionModelSelect instanceof HTMLSelectElement) sessionModelSelect.disabled = nextRunning;
    if (sessionReasoningSelect instanceof HTMLSelectElement) sessionReasoningSelect.disabled = nextRunning;
    if (sendIcon instanceof HTMLElement) sendIcon.hidden = nextRunning;
    if (stopIcon instanceof HTMLElement) stopIcon.hidden = !nextRunning;
  };
  const setSessionMode = (nextMode) => {
    const definition = modeDefinitions.find(({ id }) => id === nextMode);
    if (!definition) return;
    sessionMode = definition.id;
    for (const button of sessionModeButtons) {
      const selected = button.dataset.sessionMode === sessionMode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const modeLabel = document.querySelector("[data-mode-label]");
    if (modeLabel) modeLabel.textContent = definition.label;
  };
  for (const button of sessionModeButtons) {
    button.addEventListener("click", () => {
      if (running) return;
      const definition = modeDefinitions.find(({ id }) => id === button.dataset.sessionMode);
      if (!definition) return;
      if (definition.id === sessionMode) return;
      if (definition.requiresConfirmation) {
        pendingSessionMode = definition.id;
        if (fullAccessDialog instanceof HTMLDialogElement && !fullAccessDialog.open) fullAccessDialog.showModal();
        return;
      }
      setSessionMode(definition.id);
    });
  }
  fullAccessDialog?.addEventListener("close", () => {
    if (!(fullAccessDialog instanceof HTMLDialogElement)) return;
    const nextMode = pendingSessionMode;
    pendingSessionMode = undefined;
    if (fullAccessDialog.returnValue === "enable" && nextMode) setSessionMode(nextMode);
  });
  const synchronizeSessionModel = (useModelDefault) => {
    if (!(sessionModelSelect instanceof HTMLSelectElement) || !(sessionReasoningSelect instanceof HTMLSelectElement)) return;
    const selected = sessionModelSelect.selectedOptions[0];
    const levels = selected?.dataset.levels?.split(",").filter(Boolean) ?? [];
    const previousLevel = sessionReasoningSelect.value;
    sessionReasoningSelect.replaceChildren(...levels.map((level) => new Option(level, level)));
    const nextLevel = useModelDefault ? selected?.dataset.defaultLevel : previousLevel;
    if (nextLevel && levels.includes(nextLevel)) sessionReasoningSelect.value = nextLevel;
    const selectedName = selected?.textContent ?? sessionModelSelect.value;
    for (const modelLabel of document.querySelectorAll("[data-model-label]")) modelLabel.textContent = selectedName;
  };
  const rebuildSessionModels = (settings) => {
    if (!(model instanceof HTMLSelectElement) || !(sessionModelSelect instanceof HTMLSelectElement) || !(sessionReasoningSelect instanceof HTMLSelectElement)) return;
    const options = Array.from(model.options)
      .filter((option) => option.dataset.provider === settings.providerId && (option.dataset.protocols?.split(",") ?? []).includes(settings.protocol))
      .map((sourceOption) => {
        const option = new Option(sourceOption.textContent ?? sourceOption.value, sourceOption.value);
        option.dataset.levels = sourceOption.dataset.levels ?? "";
        option.dataset.defaultLevel = sourceOption.dataset.defaultLevel ?? "";
        return option;
      });
    sessionModelSelect.replaceChildren(...options);
    sessionModelSelect.value = settings.modelId;
    synchronizeSessionModel(true);
    if (Array.from(sessionReasoningSelect.options).some(({ value }) => value === settings.reasoningLevel)) sessionReasoningSelect.value = settings.reasoningLevel;
  };
  sessionModelSelect?.addEventListener("change", () => synchronizeSessionModel(true));
  const closeApproval = () => {
    activeApproval = undefined;
    if (approvalDialog instanceof HTMLDialogElement && approvalDialog.open) {
      approvalDialog.returnValue = "";
      approvalDialog.close();
    }
  };
  const showApproval = (request) => {
    activeApproval = request;
    if (approvalAction) approvalAction.textContent = request.actionType;
    if (approvalTarget) approvalTarget.textContent = request.target;
    if (approvalReason) approvalReason.textContent = request.riskReason;
    if (approvalImpact) approvalImpact.textContent = request.impact;
    if (approvalRemember instanceof HTMLInputElement) approvalRemember.checked = false;
    if (approvalApprove) approvalApprove.textContent = "仅此一次允许";
    if (approvalError) approvalError.textContent = "";
    if (approvalDialog instanceof HTMLDialogElement && !approvalDialog.open) approvalDialog.showModal();
  };
  const isSource = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return typeof value.chunkId === "string" && typeof value.documentId === "string" && Number.isInteger(value.ordinal) && value.ordinal >= 0 && typeof value.uri === "string" && typeof value.title === "string" && (value.sourceType === "file" || value.sourceType === "web" || value.sourceType === "manual") && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string") && typeof value.updatedAt === "string" && typeof value.content === "string" && typeof value.score === "number" && Number.isFinite(value.score);
  };
  const sourceIcon = (sourceType) => {
    const template = document.querySelector('[data-source-icon="' + sourceType + '"]');
    return template instanceof HTMLTemplateElement ? template.content.cloneNode(true) : document.createTextNode("");
  };
  const actionIcon = (iconName) => {
    const template = document.querySelector('[data-action-icon="' + iconName + '"]');
    return template instanceof HTMLTemplateElement ? template.content.cloneNode(true) : document.createTextNode("");
  };
  const actionStateIcon = (state) => {
    const iconName = state === "verified" ? "verified" : state === "unknown" || state === "denied" ? "warning" : "progress";
    const template = document.querySelector('[data-action-state-icon="' + iconName + '"]');
    return template instanceof HTMLTemplateElement ? template.content.cloneNode(true) : document.createTextNode("");
  };
  const stringifyActionDetail = (value) => {
    const serialized = JSON.stringify(value, null, 2) ?? String(value);
    const limit = actionLedgerConfig.maximumDetailCharacters;
    return serialized.length > limit ? serialized.slice(0, limit) + "\\n…已截断" : serialized;
  };
  const summarizeAction = (action) => {
    const field = actionLedgerConfig.summaryFields.find((name) => typeof action.input[name] === "string" && action.input[name].trim());
    return field ? action.toolName + " · " + action.input[field] : action.toolName;
  };
  const attachActionCard = (detail) => {
    if (!(activeAssistant instanceof HTMLParagraphElement)) return;
    const body = activeAssistant.parentElement;
    if (!(body instanceof HTMLElement)) return;
    let container = body.querySelector(".message-actions");
    if (!(container instanceof HTMLElement)) {
      container = document.createElement("div");
      container.className = "message-actions";
      body.append(container);
    }
    const card = document.createElement("details");
    card.className = "action-card";
    card.dataset.actionId = detail.action.id;
    detail.element = card;
    container.append(card);
  };
  const renderActionCard = (detail) => {
    const card = detail.element;
    if (!(card instanceof HTMLDetailsElement)) return;
    const wasOpen = card.open;
    card.dataset.actionState = detail.state;
    const summary = document.createElement("summary");
    const iconName = actionLedgerConfig.toolIcons.find(({ toolName }) => toolName === detail.action.toolName)?.icon ?? "generic";
    summary.append(actionIcon(iconName));
    const title = document.createElement("span");
    title.className = "action-summary";
    title.textContent = summarizeAction(detail.action);
    const badge = document.createElement("span");
    badge.className = "action-state";
    badge.append(actionStateIcon(detail.state));
    const badgeLabel = document.createElement("span");
    badgeLabel.textContent = actionLedgerConfig.states.find(({ id }) => id === detail.state)?.label ?? detail.state;
    badge.append(badgeLabel);
    summary.append(title, badge);
    const detailBody = document.createElement("div");
    detailBody.className = "action-detail";
    const payload = document.createElement("pre");
    payload.textContent = stringifyActionDetail({ input: detail.action.input, authorization: detail.authorization, approval: detail.approval, observation: detail.observation, verification: detail.verification, reason: detail.reason });
    const timeline = document.createElement("div");
    timeline.className = "action-timeline";
    for (const state of detail.timeline) {
      const item = document.createElement("span");
      item.textContent = actionLedgerConfig.states.find(({ id }) => id === state)?.label ?? state;
      timeline.append(item);
    }
    detailBody.append(payload, timeline);
    card.replaceChildren(summary, detailBody);
    card.open = wasOpen;
  };
  const updateActionCard = (actionId, state, extra = {}) => {
    const detail = actionDetails.get(actionId);
    if (!detail) return undefined;
    detail.state = state;
    if (detail.timeline.at(-1) !== state) detail.timeline.push(state);
    Object.assign(detail, extra);
    renderActionCard(detail);
    return detail;
  };
  const appendHighlighted = (container, content, query) => {
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    const start = normalizedQuery === "" ? -1 : content.toLocaleLowerCase().indexOf(normalizedQuery.toLocaleLowerCase());
    if (start < 0) {
      container.textContent = content;
      return;
    }
    container.append(document.createTextNode(content.slice(0, start)));
    const mark = document.createElement("mark");
    mark.textContent = content.slice(start, start + normalizedQuery.length);
    container.append(mark, document.createTextNode(content.slice(start + normalizedQuery.length)));
  };
  const openSource = (source) => {
    if (sourceDetailTitle) sourceDetailTitle.textContent = source.title;
    if (sourceDetailType) sourceDetailType.textContent = sourceTypeLabels[source.sourceType];
    if (sourceDetailOrdinal) sourceDetailOrdinal.textContent = "第 " + String(source.ordinal + 1) + " 段";
    if (sourceDetailTime) sourceDetailTime.textContent = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(source.updatedAt));
    if (sourceDetailTags) sourceDetailTags.textContent = source.tags.length > 0 ? source.tags.join("、") : "无";
    if (sourceDetailUri) sourceDetailUri.textContent = source.uri;
    if (sourceDetailContent) sourceDetailContent.textContent = source.content;
    if (sourceDialog instanceof HTMLDialogElement && !sourceDialog.open) sourceDialog.showModal();
  };
  const createSourceCard = (source) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "source-card";
    card.append(sourceIcon(source.sourceType));
    const title = document.createElement("strong");
    title.textContent = source.title;
    const metadata = document.createElement("small");
    metadata.textContent = sourceTypeLabels[source.sourceType] + " · 第 " + String(source.ordinal + 1) + " 段";
    const preview = document.createElement("span");
    preview.className = "source-preview";
    appendHighlighted(preview, source.content, source.query);
    card.append(title, metadata, preview);
    card.addEventListener("click", () => openSource(source));
    return card;
  };
  const renderSources = () => {
    if (sourceCount) sourceCount.textContent = String(sources.size);
    if (sourceEmpty instanceof HTMLElement) sourceEmpty.hidden = sources.size > 0;
    if (sourceList instanceof HTMLElement) sourceList.replaceChildren(...Array.from(sources.values(), createSourceCard));
  };
  const attachMessageSource = (source) => {
    if (!(activeAssistant instanceof HTMLParagraphElement)) return;
    const body = activeAssistant.parentElement;
    if (!(body instanceof HTMLElement)) return;
    let container = body.querySelector(".message-sources");
    if (!(container instanceof HTMLElement)) {
      container = document.createElement("div");
      container.className = "message-sources";
      body.append(container);
    }
    if (Array.from(container.querySelectorAll("[data-source-chunk]")).some((item) => item.dataset.sourceChunk === source.chunkId)) return;
    const citation = document.createElement("button");
    citation.type = "button";
    citation.className = "message-source";
    citation.dataset.sourceChunk = source.chunkId;
    citation.append(sourceIcon(source.sourceType));
    const label = document.createElement("span");
    label.textContent = source.title + " · " + String(source.ordinal + 1);
    citation.append(label);
    citation.addEventListener("click", () => openSource(source));
    container.append(citation);
  };
  const collectSources = (observation, action) => {
    if (!observation.ok || !Array.isArray(observation.output)) return;
    for (const candidate of observation.output) {
      if (!isSource(candidate)) continue;
      const source = { ...candidate, query: action.query };
      sources.set(source.chunkId, source);
      attachMessageSource(source);
    }
    renderSources();
  };
  const finishRun = () => {
    closeApproval();
    activeRunId = undefined;
    activeAssistant = undefined;
    cancellationRequested = false;
    actionDetails.clear();
    setRunning(false);
  };
  api.conversation.onEvent((runEvent) => {
    if (runEvent.type === "run.created") {
      if (!running || activeRunId !== undefined) return;
      activeRunId = runEvent.runId;
      if (conversationButton instanceof HTMLButtonElement) conversationButton.disabled = false;
      return;
    }
    if (!running || runEvent.runId !== activeRunId) return;
    if (runEvent.type === "action.planned") {
      const action = runEvent.payload.action;
      const detail = { action, toolName: action.toolName, query: typeof action.input.query === "string" ? action.input.query : "", state: "planned", timeline: ["planned"] };
      actionDetails.set(action.id, detail);
      attachActionCard(detail);
      renderActionCard(detail);
    } else if (runEvent.type === "action.authorized") {
      updateActionCard(runEvent.payload.actionId, "authorized", { authorization: runEvent.payload.decision });
    } else if (runEvent.type === "action.denied") {
      updateActionCard(runEvent.payload.actionId, "denied", { authorization: runEvent.payload.decision });
    } else if (runEvent.type === "action.dispatched") {
      updateActionCard(runEvent.payload.actionId, "dispatched");
    } else if (runEvent.type === "action.observed") {
      const action = actionDetails.get(runEvent.payload.actionId);
      updateActionCard(runEvent.payload.actionId, "observed", { observation: runEvent.payload.observation });
      if (action?.toolName === "kb.search") collectSources(runEvent.payload.observation, action);
    } else if (runEvent.type === "action.verified") {
      updateActionCard(runEvent.payload.actionId, "verified", { verification: runEvent.payload.verification });
    } else if (runEvent.type === "action.unknown") {
      updateActionCard(runEvent.payload.actionId, "unknown", { reason: runEvent.payload.reason });
    } else if (runEvent.type === "approval.required") {
      const action = actionDetails.get(runEvent.payload.request.actionId);
      if (action) {
        action.approval = runEvent.payload.request;
        renderActionCard(action);
      }
      showApproval(runEvent.payload.request);
    } else if (runEvent.type === "approval.resolved") {
      const action = actionDetails.get(runEvent.payload.resolution.actionId);
      if (action) {
        action.approval = runEvent.payload.resolution;
        renderActionCard(action);
      }
    } else if (runEvent.type === "model.delta") {
      if (!(activeAssistant instanceof HTMLParagraphElement)) activeAssistant = appendMessage("assistant", "");
      if (activeAssistant instanceof HTMLParagraphElement) activeAssistant.textContent += runEvent.payload.delta;
      if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
    } else if (runEvent.type === "run.completed") {
      if (!(activeAssistant instanceof HTMLParagraphElement)) activeAssistant = appendMessage("assistant", runEvent.payload.finalOutput);
      finishRun();
    } else if (runEvent.type === "run.failed") {
      const failure = "运行失败：" + runEvent.payload.message;
      if (activeAssistant instanceof HTMLParagraphElement) activeAssistant.textContent += (activeAssistant.textContent ? "\\n\\n" : "") + failure;
      else appendMessage("assistant", failure);
      finishRun();
    } else if (runEvent.type === "run.cancelled") {
      const cancelled = "本次生成已停止。";
      if (activeAssistant instanceof HTMLParagraphElement) activeAssistant.textContent += (activeAssistant.textContent ? "\\n\\n" : "") + cancelled;
      else appendMessage("assistant", cancelled);
      finishRun();
    }
  });
  approvalDialog?.addEventListener("cancel", (event) => event.preventDefault());
  approvalRemember?.addEventListener("change", () => {
    if (approvalApprove && approvalRemember instanceof HTMLInputElement) {
      approvalApprove.textContent = approvalRemember.checked ? "允许并记住本会话" : "仅此一次允许";
    }
  });
  approvalDialog?.addEventListener("close", async () => {
    if (!(approvalDialog instanceof HTMLDialogElement) || activeApproval === undefined) return;
    const choice = approvalDialog.returnValue;
    if (choice !== "approve" && choice !== "deny") return;
    const request = activeApproval;
    const rememberForSession =
      choice === "approve" &&
      approvalRemember instanceof HTMLInputElement &&
      approvalRemember.checked;
    if (approvalError) approvalError.textContent = "正在提交你的决定…";
    try {
      await api.approvals.resolve({
        approvalId: request.id,
        runId: request.runId,
        decision: choice,
        rememberForSession,
      });
      activeApproval = undefined;
    } catch (error) {
      if (approvalError) approvalError.textContent = error instanceof Error ? error.message : "审批提交失败";
      if (!approvalDialog.open) approvalDialog.showModal();
    }
  });
  const submitConversation = async () => {
    if (!(conversationInput instanceof HTMLTextAreaElement) || !(sessionModelSelect instanceof HTMLSelectElement) || !(sessionReasoningSelect instanceof HTMLSelectElement)) return;
    if (running) {
      if (activeRunId === undefined || cancellationRequested) return;
      cancellationRequested = true;
      if (conversationButton instanceof HTMLButtonElement) conversationButton.disabled = true;
      try {
        await api.conversation.cancel({ runId: activeRunId });
      } catch (error) {
        cancellationRequested = false;
        if (conversationButton instanceof HTMLButtonElement) conversationButton.disabled = false;
        appendMessage("assistant", error instanceof Error ? error.message : "停止请求失败");
      }
      return;
    }
    const userInput = conversationInput.value.trim();
    if (!userInput) return;
    appendMessage("user", userInput);
    conversationInput.value = "";
    activeAssistant = appendMessage("assistant", "");
    cancellationRequested = false;
    setRunning(true);
    try {
      const result = await api.conversation.start({
        sessionId,
        userInput,
        mode: sessionMode,
        modelId: sessionModelSelect.value,
        reasoningLevel: sessionReasoningSelect.value,
      });
      if (running && result.status === "completed") {
        if (activeAssistant instanceof HTMLParagraphElement && !activeAssistant.textContent) activeAssistant.textContent = result.finalOutput ?? "";
        finishRun();
      } else if (running && result.status === "failed") {
        if (activeAssistant instanceof HTMLParagraphElement && !activeAssistant.textContent) activeAssistant.textContent = "运行失败：" + (result.errorMessage ?? result.errorCode ?? "未知错误");
        finishRun();
      } else if (running && result.status === "cancelled") {
        if (activeAssistant instanceof HTMLParagraphElement && !activeAssistant.textContent) activeAssistant.textContent = "本次生成已停止。";
        finishRun();
      }
    } catch (error) {
      if (activeAssistant instanceof HTMLParagraphElement && !activeAssistant.textContent) activeAssistant.textContent = error instanceof Error ? error.message : "对话请求失败";
      finishRun();
    }
  };
  conversationButton?.addEventListener("click", () => { void submitConversation(); });
  conversationInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submitConversation();
    }
  });
  newSessionButton?.addEventListener("click", () => {
    if (running || !(messages instanceof HTMLElement)) return;
    sessionId = "session-" + crypto.randomUUID();
    actionDetails.clear();
    sources.clear();
    renderSources();
    setSessionMode(defaultMode);
    if (sessionModelSelect instanceof HTMLSelectElement && defaultSessionModelId) sessionModelSelect.value = defaultSessionModelId;
    synchronizeSessionModel(false);
    if (sessionReasoningSelect instanceof HTMLSelectElement && defaultSessionReasoningLevel) sessionReasoningSelect.value = defaultSessionReasoningLevel;
    messages.replaceChildren();
    appendMessage("assistant", "你好，我是沧渡。你可以让我采集资料、整理知识库或生成文档。");
    if (conversationInput instanceof HTMLTextAreaElement) conversationInput.focus();
  });
  const setKnowledgeBusy = (busy) => {
    if (knowledgeAddButton instanceof HTMLButtonElement) knowledgeAddButton.disabled = busy;
  };
  const renderKnowledge = (state) => {
    if (knowledgeDocumentCount) knowledgeDocumentCount.textContent = String(state.status.documentCount);
    if (knowledgeChunkCount) knowledgeChunkCount.textContent = String(state.status.chunkCount);
    if (knowledgeEmpty instanceof HTMLElement) knowledgeEmpty.hidden = state.documents.length > 0;
    if (!(knowledgeList instanceof HTMLElement)) return;
    const cards = state.documents.map((documentSummary) => {
      const card = document.createElement("article");
      card.className = "knowledge-card";
      const title = document.createElement("h2");
      title.textContent = documentSummary.title;
      const metadata = document.createElement("p");
      metadata.className = "knowledge-card-meta";
      metadata.textContent = "本地文件 · " + String(documentSummary.chunkCount) + " 个分段 · " + new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(documentSummary.updatedAt));
      const uri = document.createElement("p");
      uri.className = "knowledge-card-uri";
      uri.textContent = documentSummary.uri;
      uri.title = documentSummary.uri;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-source";
      remove.textContent = "移除";
      remove.addEventListener("click", () => {
        pendingKnowledgeRemoval = documentSummary.id;
        if (knowledgeRemoveTitle) knowledgeRemoveTitle.textContent = documentSummary.title;
        if (knowledgeRemoveDialog instanceof HTMLDialogElement) knowledgeRemoveDialog.showModal();
      });
      card.append(title, metadata, uri, remove);
      return card;
    });
    knowledgeList.replaceChildren(...cards);
  };
  const refreshKnowledge = async () => {
    setKnowledgeBusy(true);
    if (knowledgeStatus) knowledgeStatus.textContent = "正在读取本地索引…";
    try {
      const state = await api.knowledge.list();
      renderKnowledge(state);
      knowledgeLoaded = true;
      if (knowledgeStatus) knowledgeStatus.textContent = "索引状态已更新";
    } catch (error) {
      if (knowledgeStatus) knowledgeStatus.textContent = error instanceof Error ? error.message : "知识库读取失败";
    } finally {
      setKnowledgeBusy(false);
    }
  };
  knowledgeAddButton?.addEventListener("click", async () => {
    setKnowledgeBusy(true);
    if (knowledgeStatus) knowledgeStatus.textContent = "请选择需要添加的文件…";
    try {
      const result = await api.knowledge.addFiles();
      renderKnowledge(result.state);
      knowledgeLoaded = true;
      if (knowledgeStatus) {
        knowledgeStatus.textContent = result.cancelled
          ? "已取消添加"
          : result.failures.length > 0
            ? "已添加 " + String(result.imported.length) + " 个文件，" + String(result.failures.length) + " 个失败：" + result.failures.map((failure) => failure.fileName + "（" + failure.message + "）").join("；")
            : "已添加 " + String(result.imported.length) + " 个文件";
      }
    } catch (error) {
      if (knowledgeStatus) knowledgeStatus.textContent = error instanceof Error ? error.message : "添加文件失败";
    } finally {
      setKnowledgeBusy(false);
    }
  });
  knowledgeRemoveDialog?.addEventListener("close", async () => {
    if (!(knowledgeRemoveDialog instanceof HTMLDialogElement)) return;
    const documentId = pendingKnowledgeRemoval;
    pendingKnowledgeRemoval = undefined;
    if (knowledgeRemoveDialog.returnValue !== "confirm" || typeof documentId !== "string") return;
    setKnowledgeBusy(true);
    if (knowledgeStatus) knowledgeStatus.textContent = "正在移除来源…";
    try {
      const state = await api.knowledge.remove({ documentId });
      renderKnowledge(state);
      if (knowledgeStatus) knowledgeStatus.textContent = "来源及其分段索引已移除，原文件未改动";
    } catch (error) {
      if (knowledgeStatus) knowledgeStatus.textContent = error instanceof Error ? error.message : "移除来源失败";
    } finally {
      setKnowledgeBusy(false);
    }
  });
  const showView = (name) => {
    document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== name; });
    document.querySelectorAll("[data-view]").forEach((button) => { button.classList.toggle("active", button.dataset.view === name); });
    if (name === "knowledge" && !knowledgeLoaded) void refreshKnowledge();
  };
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-right-tab]").forEach((button) => button.addEventListener("click", () => {
    const name = button.dataset.rightTab;
    document.querySelectorAll("[data-right-tab]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    document.querySelectorAll("[data-right-body]").forEach((body) => { body.hidden = body.dataset.rightBody !== name; });
  }));
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
    defaultMode = settings.mode;
    defaultSessionModelId = settings.modelId;
    defaultSessionReasoningLevel = settings.reasoningLevel;
    rebuildSessionModels(settings);
    if (defaultModeSelect instanceof HTMLSelectElement) defaultModeSelect.value = settings.mode;
    const present = await api.secrets.has(settings.secretName);
    if (status) status.textContent = present ? "API Key 已加密保存" : "尚未保存 API Key";
  }).catch(() => { if (status) status.textContent = "设置状态读取失败"; });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(provider instanceof HTMLSelectElement) || !(model instanceof HTMLSelectElement) || !(protocol instanceof HTMLSelectElement) || !(reasoning instanceof HTMLSelectElement) || !(defaultModeSelect instanceof HTMLSelectElement) || !(apiKey instanceof HTMLInputElement)) return;
    if (status) status.textContent = "正在保存…";
    try {
      const secretName = form.dataset.secretName;
      if (!secretName) throw new Error("密钥名称缺失");
      if (apiKey.value.trim()) await api.secrets.set(secretName, apiKey.value);
      const saved = await api.settings.set({ providerId: provider.value, modelId: model.value, protocol: protocol.value, reasoningLevel: reasoning.value, secretName, mode: defaultModeSelect.value });
      apiKey.value = "";
      defaultMode = saved.mode;
      defaultSessionModelId = saved.modelId;
      defaultSessionReasoningLevel = saved.reasoningLevel;
      rebuildSessionModels(saved);
      if (status) status.textContent = "设置已保存";
    } catch (error) { if (status) status.textContent = error instanceof Error ? error.message : "设置保存失败"; }
  });
})();`;
function icon(
  name:
    | "plus"
    | "chat"
    | "library"
    | "settings"
    | "send"
    | "stop"
    | "browser"
    | "warning"
    | "source"
    | "artifact"
    | "file"
    | "web"
    | "manual"
    | "close"
    | "search"
    | "write"
    | "terminal"
    | "action"
    | "progress"
    | "check",
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
    warning: "M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3v.01",
    source: "M5 3h11l3 3v15H5V3Zm11 0v4h4M8 11h8M8 15h8",
    artifact: "M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10",
    file: "M6 3h8l4 4v14H6V3Zm8 0v5h5",
    web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3ZM3 12h18",
    manual: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
    close: "M6 6l12 12M18 6 6 18",
    search: "m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z",
    write: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4M4 4h6",
    terminal: "M4 5h16v14H4V5Zm3 4 3 3-3 3m5 0h5",
    action: "M6 4h12v16H6V4Zm3 5h6m-6 4h6m-6 4h4",
    progress: "M12 4a8 8 0 1 0 8 8",
    check: "M5 12l4 4L19 6",
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

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
