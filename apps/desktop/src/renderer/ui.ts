export type DesktopMode = "plan" | "work" | "full_access";
export interface DesktopViewState {
  readonly mode: DesktopMode;
  readonly workspaceName: string;
  readonly modelName: string;
  readonly running: boolean;
  readonly runtimeStatus: "connected" | "disconnected";
  readonly browserVisible: boolean;
}
export function createDesktopMarkup(state: DesktopViewState): string {
  const label = { plan: "计划", work: "工作", full_access: "完全访问" }[state.mode];
  const runtimeLabel = state.runtimeStatus === "connected" ? "运行时已连接" : "运行时未连接";
  const browserPanel = state.browserVisible
    ? `<aside class="browser-panel"><header>${icon("browser")}可视浏览器</header><div class="browser-address"><input aria-label="浏览器地址" value="about:blank" readonly></div><webview src="about:blank"></webview></aside>`
    : "";
  return `<main class="app-shell"><aside class="sidebar"><button class="new-session">${icon("plus")}新建会话</button><nav><button class="nav active">${icon("chat")}会话</button><button class="nav">${icon("library")}知识库</button></nav><footer>${label} · ${runtimeLabel}</footer></aside><section class="conversation"><header>${escapeHtml(state.workspaceName)}<span>${escapeHtml(state.modelName)}</span></header><article class="assistant-message"><b>沧</b><p>你好，我是沧渡。你可以让我采集资料、整理知识库或生成文档。</p></article><section class="input-card"><textarea placeholder="帮你采集资料、整理知识库、生成文档报告……"></textarea><button class="send" aria-label="${state.running ? "停止" : "发送"}">${icon(state.running ? "stop" : "send")}</button></section></section>${browserPanel}</main>`;
}
export const desktopStyles = `:root{--brand:#0e7490;--send:#34b3a0;--side:#f7f7f8;--border:#e8e8ea;--text:#1f2933;font-family:system-ui,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}body{margin:0;color:var(--text)}.app-shell{display:flex;min-height:100vh}.sidebar{width:220px;background:var(--side);border-right:1px solid var(--border);padding:16px;display:flex;flex-direction:column}.new-session,.send{border:0;border-radius:6px;color:#fff}.new-session{background:var(--brand);padding:8px 16px;font-weight:600}.nav{margin-top:16px}.nav button{display:flex;gap:8px;border:0;background:transparent;padding:10px}.nav .active{border-left:3px solid var(--brand);color:var(--brand)}footer{margin-top:auto;font-size:12px}.conversation{flex:1;min-width:0}.conversation header{height:44px;border-bottom:1px solid var(--border);padding:10px 24px;display:flex;justify-content:space-between}.assistant-message{display:flex;gap:8px;max-width:860px;margin:24px auto}.assistant-message p{padding:12px 16px;border:1px solid var(--border);border-radius:4px 16px 16px}.input-card{width:min(800px,calc(100% - 48px));margin:40vh auto 24px;border:1px solid var(--border);border-radius:12px;padding:12px;display:flex}.input-card:focus-within{border-color:var(--brand);box-shadow:0 2px 16px rgba(14,116,144,.12)}textarea{flex:1;border:0;min-height:80px;font:inherit}.send{width:36px;height:36px;background:var(--send)}.browser-panel{width:280px;border-left:1px solid var(--border);display:flex;flex-direction:column}.browser-panel header{height:44px;padding:10px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border);font-weight:600}.browser-address{padding:8px;border-bottom:1px solid var(--border)}.browser-address input{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 8px}.browser-panel webview{flex:1;min-height:480px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8}`;
function icon(name: "plus" | "chat" | "library" | "send" | "stop" | "browser"): string {
  const paths = {
    plus: "M12 5v14M5 12h14",
    chat: "M4 5h16v11H8l-4 3V5Z",
    library: "M5 4h5v16H5zM14 4h5v16h-5z",
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
