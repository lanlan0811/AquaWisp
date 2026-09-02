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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'"><title>沧渡 AquaWisp</title><style>${desktopStyles}${knowledgeStyles}${approvalStyles}</style></head><body>${createDesktopMarkup(state)}<script nonce="${scriptNonce}">${desktopRendererScript}</script></body></html>`;
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
  return `<main class="app-shell"><aside class="sidebar"><button class="new-session" data-new-session>${icon("plus")}新建会话</button><nav><button class="nav active" data-view="conversation">${icon("chat")}会话</button><button class="nav" data-view="knowledge">${icon("library")}知识库</button><button class="nav" data-view="settings">${icon("settings")}设置</button></nav><footer><span data-mode-label>${label}</span> · <span data-runtime-label>${runtimeLabel}</span></footer></aside><section class="workspace"><section class="conversation" data-view-panel="conversation"><header>${escapeHtml(state.workspaceName)}<span data-model-label>${escapeHtml(state.modelName)}</span></header><section class="message-list" data-conversation-messages aria-live="polite"><article class="assistant-message"><b>沧</b><p>你好，我是沧渡。你可以让我采集资料、整理知识库或生成文档。</p></article></section><section class="input-card"><textarea data-conversation-input placeholder="帮你采集资料、整理知识库、生成文档报告……"></textarea><button class="send" data-conversation-send data-running="${state.running ? "true" : "false"}" aria-label="${state.running ? "停止" : "发送"}"><span data-send-icon${state.running ? " hidden" : ""}>${icon("send")}</span><span data-stop-icon${state.running ? "" : " hidden"}>${icon("stop")}</span></button></section></section><section class="knowledge-view" data-view-panel="knowledge" hidden><header><h1>知识库</h1><button class="secondary" data-knowledge-add>${icon("plus")}添加文件</button></header><div class="knowledge-summary" aria-live="polite"><div><strong data-knowledge-documents>—</strong><span>个来源</span></div><div><strong data-knowledge-chunks>—</strong><span>个分段</span></div><p data-knowledge-status>打开知识库时自动读取本地索引。</p></div><section class="knowledge-list" data-knowledge-list></section><div class="empty-state" data-knowledge-empty>${icon("library")}<h2>知识库为空</h2><p>添加 Markdown、PDF 或 Office 文档，沧渡会在本地提取并建立分段索引。</p></div><dialog class="knowledge-dialog" data-knowledge-remove-dialog><form method="dialog"><h2>确认移除来源</h2><p>将从本地知识库删除“<strong data-knowledge-remove-title></strong>”及其分段索引，原文件不会被删除。</p><menu><button value="cancel">取消</button><button value="confirm">确认移除</button></menu></form></dialog></section><section class="settings-view" data-view-panel="settings" hidden><header><h1>设置</h1></header><form data-settings-form data-secret-name="${escapeHtml(state.secretName)}"><label>模型供应商<select name="providerId">${providers}</select></label><label>默认模型<select name="modelId">${models}</select></label><label>API 协议<select name="protocol"><option value="chat_completions"${state.protocol === "chat_completions" ? " selected" : ""}>Chat Completions</option><option value="responses"${state.protocol === "responses" ? " selected" : ""}>Responses</option></select></label><label>默认思考强度<select name="reasoningLevel"><option value="${escapeHtml(state.reasoningLevel)}">${escapeHtml(state.reasoningLevel)}</option></select></label><label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="已加密保存的 key 不会回显"></label><label>执行模式<select name="mode"><option value="plan"${state.mode === "plan" ? " selected" : ""}>计划</option><option value="work"${state.mode === "work" ? " selected" : ""}>工作</option><option value="full_access"${state.mode === "full_access" ? " selected" : ""}>完全访问</option></select></label><div class="settings-actions"><span data-settings-status>尚未检查密钥</span><button class="primary" type="submit">保存设置</button></div></form></section></section>${browserPanel}<dialog class="approval-dialog" data-approval-dialog aria-labelledby="approval-title"><form method="dialog"><div class="approval-heading">${icon("warning")}<div><h2 id="approval-title">需要你的确认</h2><p>沧渡想要执行以下操作：</p></div></div><dl><div><dt>操作</dt><dd data-approval-action></dd></div><div><dt>目标</dt><dd data-approval-target></dd></div><div><dt>需要确认的原因</dt><dd data-approval-reason></dd></div><div><dt>可能影响</dt><dd data-approval-impact></dd></div></dl><label class="approval-remember"><input type="checkbox" data-approval-remember>本会话内，相同操作、目标和影响范围总是允许</label><p class="approval-error" data-approval-error aria-live="assertive"></p><menu><button class="approval-deny" value="deny">拒绝</button><button class="approval-approve" value="approve" data-approval-approve>仅此一次允许</button></menu></form></dialog></main>`;
}
export const desktopStyles = `:root{--brand:#0e7490;--send:#34b3a0;--side:#f7f7f8;--border:#e8e8ea;--text:#1f2933;--weak:#5f6b76;--danger:#b91c1c;--surface:#fff;font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{margin:0;color:var(--text)}[hidden]{display:none!important}button,select,input,textarea{font:inherit}.app-shell{display:flex;min-height:100vh}.sidebar{box-sizing:border-box;width:220px;flex:none;background:var(--side);border-right:1px solid var(--border);padding:16px;display:flex;flex-direction:column}.new-session,.send,.primary{border:0;border-radius:6px;color:#fff}.new-session{background:var(--brand);padding:8px 16px;font-weight:600}.sidebar nav{display:grid;gap:6px;margin-top:16px}.nav{display:flex;gap:8px;border:0;background:transparent;padding:10px;text-align:left}.nav.active{border-left:3px solid var(--brand);color:var(--brand)}footer{margin-top:auto;font-size:12px}.workspace{flex:1;min-width:0}.conversation,.knowledge-view,.settings-view{height:100vh;box-sizing:border-box;overflow:auto}.conversation{display:flex;flex-direction:column}.conversation header,.knowledge-view header,.settings-view header{height:44px;box-sizing:border-box;border-bottom:1px solid var(--border);padding:10px 24px;display:flex;justify-content:space-between;align-items:center}.knowledge-view h1,.settings-view h1{font-size:16px;margin:0}.message-list{flex:1;overflow:auto;padding:0 24px}.assistant-message,.user-message{display:flex;gap:8px;max-width:860px;margin:24px auto}.assistant-message b,.user-message b{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--brand);color:#fff}.assistant-message p,.user-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:12px 16px;border:1px solid var(--border);border-radius:4px 16px 16px}.user-message{flex-direction:row-reverse}.user-message b{background:#475467}.user-message p{background:#ecfdf8;border-color:#c6eee5;border-radius:16px 4px 16px 16px}.input-card{box-sizing:border-box;width:min(800px,calc(100% - 48px));margin:12px auto 24px;border:1px solid var(--border);border-radius:12px;padding:12px;display:flex}.input-card:focus-within{border-color:var(--brand);box-shadow:0 2px 16px rgba(14,116,144,.12)}textarea{flex:1;border:0;min-height:80px;resize:vertical;outline:0}.send{width:36px;height:36px;background:var(--send);display:grid;place-items:center}.send[data-running=true]{background:#b42318}.send span{display:grid;place-items:center}.empty-state{max-width:520px;margin:18vh auto;text-align:center;color:#667085}.empty-state>svg{width:42px;height:42px}.settings-view form{max-width:680px;margin:28px auto;display:grid;gap:18px}.settings-view label{display:grid;gap:7px;font-weight:600}.settings-view select,.settings-view input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:#fff}.settings-actions{display:flex;align-items:center;justify-content:space-between;color:#667085}.primary{background:var(--brand);padding:9px 16px;font-weight:600}.secondary{border:1px solid var(--border);border-radius:6px;background:#fff;padding:7px 12px;display:flex;gap:6px}.browser-panel{width:280px;flex:none;border-left:1px solid var(--border);display:flex;flex-direction:column}.browser-panel header{height:44px;padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);font-weight:600}.browser-address{padding:8px;border-bottom:1px solid var(--border)}.browser-address input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 8px}.browser-panel webview{flex:1;min-height:480px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}`;
const knowledgeStyles = `.knowledge-summary{box-sizing:border-box;max-width:860px;margin:24px auto 12px;padding:16px;display:flex;align-items:center;gap:24px;border:1px solid var(--border);border-radius:12px;background:var(--side)}.knowledge-summary div{display:grid;min-width:84px}.knowledge-summary strong{font-size:20px;color:var(--brand)}.knowledge-summary span,.knowledge-summary p{font-size:12px;color:var(--weak)}.knowledge-summary p{margin:0 0 0 auto}.knowledge-list{box-sizing:border-box;max-width:860px;margin:0 auto 24px;display:grid;gap:12px}.knowledge-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 16px;padding:16px;border:1px solid var(--border);border-radius:6px;background:var(--surface)}.knowledge-card h2{margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}.knowledge-card-meta{margin:0;color:var(--weak);font-size:12px}.knowledge-card-uri{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--weak);font-size:12px}.knowledge-card .remove-source{grid-column:2;grid-row:1/4;align-self:center;border:1px solid var(--danger);border-radius:6px;background:transparent;color:var(--danger);padding:7px 12px}.knowledge-card .remove-source:hover{background:var(--danger);color:#fff}.knowledge-view .empty-state{margin-top:12vh}.knowledge-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(440px,calc(100% - 32px));border:1px solid var(--danger);border-radius:12px;padding:24px;color:var(--text)}.knowledge-dialog::backdrop{background:rgba(0,0,0,.4)}.knowledge-dialog h2{margin:0 0 8px;font-size:20px}.knowledge-dialog p{margin:0 0 16px;line-height:1.6}.knowledge-dialog menu{display:flex;justify-content:flex-end;gap:12px;margin:0;padding:0}.knowledge-dialog button{border-radius:6px;padding:8px 16px}.knowledge-dialog [value=cancel]{border:1px solid var(--border);background:var(--surface)}.knowledge-dialog [value=confirm]{border:0;background:var(--danger);color:#fff}@media(max-width:1080px){.knowledge-summary,.knowledge-list{margin-left:24px;margin-right:24px}.knowledge-summary{align-items:flex-start;flex-wrap:wrap}.knowledge-summary p{flex-basis:100%;margin:0}}`;
const approvalStyles = `.approval-dialog{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(480px,calc(100% - 32px));max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--danger);border-radius:12px;padding:24px;background:var(--surface);color:var(--text);box-shadow:0 4px 20px rgba(0,0,0,.12)}.approval-dialog::backdrop{background:rgba(0,0,0,.4)}.approval-heading{display:flex;align-items:flex-start;gap:12px}.approval-heading>svg{width:40px;height:40px;flex:none;color:var(--danger)}.approval-heading h2{margin:0;font-size:20px}.approval-heading p{margin:4px 0 0;color:var(--weak)}.approval-dialog dl{display:grid;gap:8px;margin:16px 0;padding:16px;border:1px solid var(--border);border-radius:6px;background:var(--side)}.approval-dialog dl div{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px}.approval-dialog dt{color:var(--weak)}.approval-dialog dd{margin:0;overflow-wrap:anywhere}.approval-remember{display:flex;align-items:flex-start;gap:8px;line-height:1.5}.approval-remember input{width:16px;height:16px;margin-top:3px;accent-color:var(--brand);flex:none}.approval-error{min-height:20px;margin:8px 0 0;color:var(--danger);font-size:12px}.approval-dialog menu{display:flex;justify-content:flex-end;gap:12px;margin:8px 0 0;padding:0}.approval-dialog button{border-radius:6px;padding:8px 16px;font-weight:600}.approval-deny{border:1px solid var(--danger);background:transparent;color:var(--danger)}.approval-deny:hover{background:var(--danger);color:#fff}.approval-approve{border:0;background:var(--brand);color:#fff}.approval-dialog button:focus-visible,.approval-remember input:focus-visible{outline:2px solid var(--brand);outline-offset:2px}`;
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
  const modeLabels = { plan: "计划", work: "工作", full_access: "完全访问" };
  let sessionId = "session-" + crypto.randomUUID();
  let activeRunId;
  let activeAssistant;
  let running = false;
  let cancellationRequested = false;
  let knowledgeLoaded = false;
  let pendingKnowledgeRemoval;
  let activeApproval;
  const appendMessage = (role, content) => {
    if (!(messages instanceof HTMLElement)) return undefined;
    const article = document.createElement("article");
    article.className = role === "user" ? "user-message" : "assistant-message";
    const avatar = document.createElement("b");
    avatar.textContent = role === "user" ? "你" : "沧";
    const paragraph = document.createElement("p");
    paragraph.textContent = content;
    article.append(avatar, paragraph);
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
    if (sendIcon instanceof HTMLElement) sendIcon.hidden = nextRunning;
    if (stopIcon instanceof HTMLElement) stopIcon.hidden = !nextRunning;
  };
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
  const finishRun = () => {
    closeApproval();
    activeRunId = undefined;
    activeAssistant = undefined;
    cancellationRequested = false;
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
    if (runEvent.type === "approval.required") {
      showApproval(runEvent.payload.request);
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
    if (!(conversationInput instanceof HTMLTextAreaElement)) return;
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
      const result = await api.conversation.start({ sessionId, userInput });
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
  name: "plus" | "chat" | "library" | "settings" | "send" | "stop" | "browser" | "warning",
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
