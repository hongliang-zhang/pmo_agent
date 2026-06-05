export function renderPmoAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PMO Agent</title>
  <style>${PMO_APP_CSS}</style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">P</span>
        <div>
          <strong>PMO Agent</strong>
          <small>MAAS 平台状态核查</small>
        </div>
      </div>
      <nav class="nav" aria-label="主导航">
        <button data-view="dashboard" class="active">总览</button>
        <button data-view="reports">报告</button>
        <button data-view="risks">风险</button>
        <button data-view="stories">需求</button>
        <button data-view="people">人员</button>
        <button data-view="evidence">GitLab 迭代</button>
        <button data-view="approvals">审批</button>
        <button data-view="runs">运行</button>
        <button data-view="ops">运维</button>
        <button data-view="settings">设置</button>
        <button data-view="chat">Chat</button>
        <button data-view="agent">Agent</button>
      </nav>
      <div class="side-note">
        <span>策略</span>
        <p>只读聚合。沟通和字段更新默认进入草稿或审批。</p>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">PMO Control Room</p>
          <h1 id="page-title">总览</h1>
        </div>
        <div class="top-actions">
          <a class="ghost-link" href="/reports/latest-pmo-audit.html" target="_blank" rel="noreferrer">最新日报</a>
          <button id="refresh">刷新</button>
        </div>
      </header>
      <section id="status" class="status">正在读取 PMO 数据...</section>
      <section id="content" class="content" aria-live="polite"></section>
    </main>
    <aside class="agent-panel">
      <div class="agent-head">
        <div>
          <p class="eyebrow">Agent</p>
          <h2>问 PMO</h2>
        </div>
      </div>
      <div id="chat-log" class="chat-log">
        <div class="agent-card">
          <span>当前上下文</span>
          <strong>最新 PMO 状态</strong>
          <p>基于日报、风险、证据链、运行记录和审批数据回答；不会直接执行高风险动作。</p>
        </div>
        <div class="prompt-grid">
          <button type="button" data-prompt="今天有哪些风险？">今日风险</button>
          <button type="button" data-prompt="谁需要沟通？">沟通清单</button>
          <button type="button" data-prompt="代码有进展但需求没同步的有哪些？">同步缺口</button>
          <button type="button" data-prompt="最近一次运行是否成功？">运行状态</button>
        </div>
        <div class="bubble bot">可以直接问具体人、需求、风险或运行记录。我会明确说明证据和不确定性。</div>
      </div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" autocomplete="off" placeholder="输入问题..." />
        <button type="submit">发送</button>
      </form>
    </aside>
  </div>
  <script>${PMO_APP_JS}</script>
</body>
</html>`
}

const PMO_APP_CSS = `
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-muted: #f2f4f7;
  --surface-subtle: #fafbfc;
  --ink: #16181d;
  --muted: #687182;
  --soft: #8a93a5;
  --line: #e4e7ec;
  --line-strong: #d0d5dd;
  --accent: #155eef;
  --accent-ink: #0f3ca8;
  --accent-soft: #eff4ff;
  --danger: #b42318;
  --danger-soft: #fff1f0;
  --warn: #b54708;
  --warn-soft: #fff6e5;
  --ok: #067647;
  --ok-soft: #ecfdf3;
  --shadow: 0 1px 2px rgba(16, 24, 40, .06), 0 12px 28px rgba(16, 24, 40, .06);
  --radius: 10px;
  --radius-sm: 7px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--bg);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
button, input { font: inherit; }
a {
  color: #1d2939;
  text-decoration: none;
  text-underline-offset: 3px;
}
a:hover { color: var(--accent); text-decoration: underline; }
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr) 360px;
}
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  padding: 18px 14px;
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 18px;
  border-right: 1px solid rgba(255,255,255,.08);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 12px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.brand-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  background: linear-gradient(180deg, #ffffff, #dbeafe);
  color: #12337c;
  border-radius: var(--radius-sm);
  font-weight: 800;
  box-shadow: inset 0 0 0 1px rgba(21,94,239,.15);
}
.brand strong, .brand small { display: block; }
.brand strong { font-size: 14px; letter-spacing: .01em; }
.brand small { color: #aab6c8; margin-top: 2px; font-size: 12px; }
.nav {
  display: grid;
  grid-template-columns: 1fr;
  gap: 3px;
}
.nav button {
  width: 100%;
  min-height: 36px;
  border: 1px solid transparent;
  background: transparent;
  color: #cbd5e1;
  border-radius: var(--radius-sm);
  text-align: left;
  padding: 0 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 620;
  letter-spacing: 0;
}
.nav button:hover, .nav button.active {
  background: rgba(255,255,255,.08);
  border-color: rgba(255,255,255,.1);
  color: #fff;
}
.nav button.active { box-shadow: inset 3px 0 0 #60a5fa; background: rgba(255,255,255,.1); }
.side-note {
  margin-top: auto;
  border-top: 1px solid rgba(255,255,255,.08);
  padding: 14px 4px 0;
  color: #aab6c8;
  line-height: 1.55;
  font-size: 12px;
}
.side-note span {
  color: #bfdbfe;
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
  font-weight: 800;
}
.side-note p { margin: 8px 0 0; }
.main {
  padding: 0 24px 36px;
  min-width: 0;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
  min-height: 84px;
  margin: 0 -24px 18px;
  padding: 18px 24px 14px;
  background: rgba(247,248,250,.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.eyebrow {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 12px;
  letter-spacing: .08em;
  text-transform: uppercase;
  font-weight: 800;
}
h1, h2, h3 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.15; font-weight: 720; }
h2 { font-size: 15px; font-weight: 700; }
h3 { font-size: 14px; font-weight: 680; }
.top-actions { display: flex; gap: 10px; align-items: center; }
.top-actions button, .chat-form button {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-sm);
  min-height: 36px;
  padding: 0 13px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  box-shadow: 0 1px 2px rgba(16,24,40,.12);
}
.top-actions button:hover, .chat-form button:hover { background: var(--accent-ink); border-color: var(--accent-ink); }
.top-actions button:focus-visible, .chat-form button:focus-visible, .nav button:focus-visible, input:focus-visible, a:focus-visible {
  outline: 2px solid rgba(21,94,239,.45);
  outline-offset: 2px;
}
.ghost-link {
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  text-decoration: none;
  background: var(--surface);
  color: #344054;
  font-size: 13px;
  font-weight: 650;
  box-shadow: 0 1px 1px rgba(16,24,40,.03);
}
.status {
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--muted);
  background: var(--surface);
  margin-bottom: 16px;
  font-size: 13px;
  box-shadow: 0 1px 1px rgba(16,24,40,.03);
}
.status.error { color: var(--danger); border-color: rgba(180,35,24,.35); }
.content { display: grid; gap: 16px; }
.date-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.date-toolbar label {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}
.date-toolbar input {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  color: var(--ink);
  background: #fff;
}
.date-toolbar .ghost-link { min-height: 36px; }
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 12px;
}
.summary-card {
  padding: 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 1px 2px rgba(16,24,40,.04);
}
.summary-card span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}
.summary-card strong {
  display: block;
  margin-top: 10px;
  font-size: 24px;
  line-height: 1;
  font-weight: 720;
}
.summary-card p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
}
.metric, .panel, .item, .table-wrap {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.metric {
  padding: 14px 14px 13px;
  min-height: 98px;
  box-shadow: 0 1px 2px rgba(16,24,40,.04);
}
.metric span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}
.metric strong {
  display: block;
  font-size: 30px;
  line-height: 1;
  margin-top: 13px;
  font-weight: 720;
  letter-spacing: -.02em;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr);
  gap: 16px;
}
.section-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.panel {
  padding: 14px;
  box-shadow: 0 1px 2px rgba(16,24,40,.04);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.list { display: grid; gap: 8px; }
.item {
  padding: 12px;
  box-shadow: none;
  background: var(--surface-subtle);
}
.item:hover { border-color: var(--line-strong); background: #fff; }
.priority-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}
.priority-card:hover { border-color: var(--line-strong); background: #fff; }
.priority-card.danger { border-left: 3px solid #f04438; }
.priority-card.warn { border-left: 3px solid #f79009; }
.priority-card.ok { border-left: 3px solid #12b76a; }
.priority-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}
.priority-title {
  font-weight: 680;
  line-height: 1.38;
}
.priority-meta {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.priority-action {
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: #fff;
  color: #344054;
  border: 1px solid var(--line);
  font-size: 12px;
  line-height: 1.5;
}
.priority-action strong {
  display: block;
  margin-bottom: 3px;
  color: var(--ink);
  font-size: 11px;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.person-list, .board-grid {
  display: grid;
  gap: 10px;
}
.person-row {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.person-row summary {
  list-style: none;
  cursor: pointer;
  padding: 12px;
}
.person-row summary::-webkit-details-marker { display: none; }
.person-summary {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(220px, 1.5fr) minmax(260px, 2fr);
  gap: 14px;
  align-items: center;
}
.person-name {
  font-weight: 720;
  line-height: 1.35;
}
.person-metrics {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.person-focus {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}
.person-row[open] summary {
  border-bottom: 1px solid var(--line);
  background: var(--surface-subtle);
}
.iteration-list {
  display: grid;
  gap: 10px;
  padding: 12px;
  background: #fff;
}
.iteration-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}
.iteration-card h3 {
  margin: 0 0 6px;
  font-size: 14px;
}
.iteration-facts {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.evidence-links {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.evidence-links a {
  display: inline-flex;
  max-width: 220px;
  min-height: 24px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  color: #344054;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.progress-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.board-grid {
  grid-template-columns: repeat(5, minmax(180px, 1fr));
  align-items: start;
}
.board-column {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.board-head {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-muted);
}
.board-head strong { font-size: 14px; }
.board-body {
  display: grid;
  gap: 8px;
  padding: 10px;
}
.mini-card {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.mini-card strong {
  display: block;
  font-size: 12px;
  line-height: 1.4;
  margin-bottom: 5px;
}
.item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.item-title { font-weight: 660; line-height: 1.38; }
.item-title a, td a { font-weight: 660; text-decoration: none; }
.item-title a:hover, td a:hover { text-decoration: underline; }
.item-meta {
  color: var(--muted);
  font-size: 12px;
  margin-top: 6px;
  line-height: 1.45;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
.chip {
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--surface-muted);
  color: #475467;
  font-size: 11px;
  font-weight: 650;
  line-height: 20px;
  white-space: nowrap;
  border: 1px solid rgba(16,24,40,.04);
}
.chip.danger { background: var(--danger-soft); color: var(--danger); border-color: #ffd5d2; }
.chip.warn { background: var(--warn-soft); color: var(--warn); border-color: #fedf89; }
.chip.ok { background: var(--ok-soft); color: var(--ok); border-color: #abefc6; }
.table-wrap {
  overflow: auto;
  box-shadow: none;
  background: var(--surface);
}
table {
  width: 100%;
  border-collapse: collapse;
  min-width: 760px;
}
th, td {
  text-align: left;
  border-bottom: 1px solid var(--line);
  padding: 10px 12px;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .02em;
  background: var(--surface-muted);
  position: sticky;
  top: 0;
  z-index: 1;
}
td { line-height: 1.45; font-size: 13px; }
tbody tr:hover { background: var(--surface-subtle); }
tbody tr:last-child td { border-bottom: 0; }
.agent-panel {
  position: sticky;
  top: 0;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  border-left: 1px solid var(--line);
  background: var(--surface);
  box-shadow: -1px 0 0 rgba(16,24,40,.02);
}
.agent-head {
  padding: 18px 18px 12px;
  border-bottom: 1px solid var(--line);
}
.chat-log {
  padding: 14px 16px 18px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: linear-gradient(180deg, #fff, #fbfcfe);
}
.agent-card {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-subtle);
}
.agent-card span {
  display: block;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.agent-card strong {
  display: block;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 4px;
}
.agent-card p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.prompt-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.prompt-grid button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: #344054;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.prompt-grid button:hover {
  border-color: #b2c5ff;
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.bubble {
  max-width: 94%;
  padding: 10px 11px;
  border-radius: var(--radius-sm);
  line-height: 1.55;
  white-space: pre-wrap;
  font-size: 13px;
}
.bubble.bot { background: var(--accent-soft); border: 1px solid #d7e3ff; color: #1d2939; align-self: flex-start; }
.bubble.user { background: #111827; color: #fff; align-self: flex-end; }
.chat-form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}
.chat-form input {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0 12px;
  min-height: 40px;
  background: #fff;
  color: var(--ink);
}
.chat-form input::placeholder { color: #98a2b3; }
.empty {
  padding: 24px;
  color: var(--muted);
  border: 1px dashed var(--line);
  border-radius: var(--radius);
  background: var(--surface-subtle);
  font-size: 13px;
}
.chat-workspace {
  min-height: calc(100vh - 162px);
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.chat-rail {
  min-width: 0;
  padding: 14px;
  background: #fbfcfe;
  border-right: 1px solid var(--line);
  display: grid;
  align-content: start;
  gap: 14px;
}
.chat-rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.chat-rail-head strong {
  font-size: 14px;
}
.chat-source {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #c7d7fe;
  background: #eef4ff;
  color: #1241a8;
  font-size: 11px;
  font-weight: 750;
}
.chat-thread-list, .chat-suggestion-list {
  display: grid;
  gap: 8px;
}
.chat-thread, .chat-suggestion {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: #344054;
  text-align: left;
  padding: 9px 10px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.35;
}
.chat-thread:hover, .chat-suggestion:hover {
  border-color: #b2c5ff;
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.chat-thread.active {
  border-color: #b2c5ff;
  background: var(--accent-soft);
  color: var(--accent-ink);
  box-shadow: inset 3px 0 0 #3b82f6;
}
.chat-rail-section {
  display: grid;
  gap: 8px;
}
.chat-rail-section h3 {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
}
.chat-main {
  min-width: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background:
    linear-gradient(180deg, rgba(248,250,252,.96), rgba(255,255,255,.98)),
    radial-gradient(circle at top right, rgba(21,94,239,.08), transparent 34%);
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(255,255,255,.82);
  backdrop-filter: blur(10px);
}
.chat-header h2 {
  font-size: 18px;
}
.chat-header p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.chat-context-chips {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.pmo-chat-log {
  overflow: auto;
  padding: 22px min(7vw, 70px);
  display: grid;
  align-content: start;
  gap: 14px;
}
.pmo-chat-empty {
  max-width: 860px;
  margin: 22px auto;
  display: grid;
  gap: 18px;
}
.pmo-chat-empty-card {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255,255,255,.86);
  box-shadow: 0 12px 28px rgba(16,24,40,.06);
}
.pmo-chat-empty-card h3 {
  font-size: 18px;
  margin-bottom: 8px;
}
.pmo-chat-empty-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}
.pmo-chat-prompt-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.pmo-chat-prompt {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  min-height: 78px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(16,24,40,.04);
}
.pmo-chat-prompt strong {
  display: block;
  margin-bottom: 6px;
  color: var(--ink);
}
.pmo-chat-prompt span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}
.pmo-chat-prompt:hover {
  border-color: #b2c5ff;
  background: #f8fbff;
}
.pmo-message {
  max-width: 860px;
  width: fit-content;
  min-width: 220px;
  padding: 13px 14px;
  border-radius: 12px;
  white-space: pre-wrap;
  line-height: 1.65;
  box-shadow: 0 1px 2px rgba(16,24,40,.04);
}
.pmo-message.user {
  justify-self: end;
  background: #111827;
  color: #fff;
  border-top-right-radius: 4px;
}
.pmo-message.assistant, .pmo-message.loading, .pmo-message.error {
  justify-self: start;
  background: #fff;
  color: #1d2939;
  border: 1px solid var(--line);
  border-top-left-radius: 4px;
}
.pmo-message.loading {
  color: var(--muted);
}
.pmo-message.error {
  border-color: #ffd5d2;
  background: var(--danger-soft);
  color: var(--danger);
}
.pmo-answer-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.pmo-answer-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.pmo-answer-links a {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-subtle);
  font-size: 12px;
}
.pmo-chat-composer {
  padding: 16px min(7vw, 70px) 18px;
  border-top: 1px solid var(--line);
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(10px);
}
.pmo-chat-composer form {
  max-width: 860px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}
.pmo-chat-composer textarea {
  width: 100%;
  min-height: 54px;
  max-height: 160px;
  resize: vertical;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 12px 13px;
  color: var(--ink);
  background: #fff;
  line-height: 1.45;
}
.pmo-chat-composer button {
  min-height: 54px;
  min-width: 76px;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-weight: 750;
  cursor: pointer;
}
.pmo-chat-composer button:hover {
  background: var(--accent-ink);
  border-color: var(--accent-ink);
}
.pmo-chat-hint {
  max-width: 860px;
  margin: 8px auto 0;
  color: var(--muted);
  font-size: 11px;
}
@media (max-width: 1180px) {
  .shell { grid-template-columns: 220px minmax(0,1fr); }
  .agent-panel { grid-column: 2; height: 520px; position: relative; border-left: 0; border-top: 1px solid var(--line); }
  .metric-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  .split { grid-template-columns: 1fr; }
  .summary-strip { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  .section-grid { grid-template-columns: 1fr; }
  .board-grid { grid-template-columns: repeat(2, minmax(180px, 1fr)); }
  .person-summary { grid-template-columns: 1fr; gap: 8px; }
  .iteration-card { grid-template-columns: 1fr; }
  .chat-workspace { grid-template-columns: 1fr; }
  .chat-rail { display: none; }
}
@media (max-width: 720px) {
  .shell { display: block; }
  .sidebar {
    position: relative;
    height: auto;
    padding: 14px;
  }
  .brand { padding-bottom: 10px; }
  .nav { grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .nav button { text-align: center; min-height: 38px; padding: 0 8px; }
  .nav button.active { box-shadow: inset 0 -2px 0 #60a5fa; }
  .side-note { display: none; }
  .main { padding: 0 14px 20px; }
  .topbar {
    position: relative;
    margin: 0 -14px 14px;
    padding: 16px 14px;
  }
  .topbar { align-items: flex-start; flex-direction: column; }
  .date-toolbar { align-items: stretch; flex-direction: column; }
  .metric-grid { grid-template-columns: 1fr; }
  .summary-strip { grid-template-columns: 1fr 1fr; }
  .summary-card { padding: 12px; }
  .summary-card strong { font-size: 22px; }
  .card-grid { grid-template-columns: 1fr; }
  .progress-grid { grid-template-columns: 1fr; }
  .board-grid { grid-template-columns: 1fr; }
  h1 { font-size: 24px; }
  .agent-panel { height: 460px; grid-column: auto; }
  .table-wrap {
    overflow: visible;
    border: 0;
    background: transparent;
  }
  table,
  tbody,
  tr,
  td {
    display: block;
    width: 100%;
  }
  table { min-width: 0; border-collapse: separate; border-spacing: 0 8px; }
  thead { display: none; }
  tbody tr {
    padding: 11px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(16,24,40,.04);
  }
  tbody tr:hover { background: var(--surface); }
  td {
    display: grid;
    grid-template-columns: minmax(76px, 30%) minmax(0, 1fr);
    gap: 10px;
    border: 0;
    padding: 5px 0;
    font-size: 12px;
  }
  td::before {
    content: attr(data-label);
    color: var(--muted);
    font-size: 11px;
    font-weight: 750;
  }
  td:empty { display: none; }
  .chat-log { min-height: 260px; }
  .pmo-chat-log { padding: 16px 12px; }
  .pmo-chat-prompt-grid { grid-template-columns: 1fr; }
  .pmo-chat-composer { padding: 12px; }
  .pmo-chat-composer form { grid-template-columns: 1fr; }
  .pmo-chat-composer button { min-height: 42px; }
  .chat-header { align-items: flex-start; flex-direction: column; }
}
`

const PMO_APP_JS = `
const viewPathMap = {
  dashboard: '/app',
  reports: '/app/reports',
  risks: '/app/risks',
  stories: '/app/stories',
  people: '/app/people',
  evidence: '/app/evidence',
  approvals: '/app/approvals',
  runs: '/app/runs',
  ops: '/app/ops',
  settings: '/app/settings',
  chat: '/app/chat',
  agent: '/app/agent'
};
const pathViewMap = Object.fromEntries(Object.entries(viewPathMap).map(([view, path]) => [path, view]));
const state = { data: null, view: viewFromPath(location.pathname), date: dateFromUrl() || todayChinaDate(), chatMessages: [] };
const titleByView = {
  dashboard: '总览',
  reports: '报告',
  risks: '风险',
  stories: '需求',
  people: '人员',
  evidence: 'GitLab 迭代',
  approvals: '审批',
  runs: '运行',
  ops: '运维',
  settings: '设置',
  chat: 'Chat',
  agent: 'Agent'
};
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const link = (href, label) => href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(label) + '</a>' : escapeHtml(label);

async function loadState() {
  $('#status').className = 'status';
  $('#status').textContent = '正在读取 PMO 数据...';
  try {
    const params = new URLSearchParams();
    if (state.date) params.set('date', state.date);
    const res = await fetch('/api/app/state?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
    $('#status').textContent = '数据更新时间：' + new Date(state.data.generatedAt).toLocaleString() + '；查看日期：' + (state.data.selectedDate ?? state.date) + '；日报：' + (state.data.latestReport?.date ?? '暂无');
    render();
  } catch (error) {
    $('#status').className = 'status error';
    $('#status').textContent = '读取失败：' + error.message;
  }
}

function render() {
  $('#page-title').textContent = titleByView[state.view] || '总览';
  document.querySelectorAll('.nav button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (!state.data) return;
  const views = {
    dashboard: renderDashboard,
    reports: renderReports,
    risks: renderRisks,
    stories: renderStories,
    people: renderPeople,
    evidence: renderEvidence,
    approvals: renderApprovals,
    runs: renderRuns,
    ops: renderOps,
    settings: renderSettings,
    chat: renderChat,
    agent: renderAgent
  };
  $('#content').innerHTML = (views[state.view] || renderDashboard)(state.data);
  bindDynamicControls();
}

function renderDashboard(data) {
  const d = data.dashboard;
  return [
    '<div class="metric-grid">',
    metric('聚焦需求', d.focused, '进入日报主体的需求'),
    metric('今日有进展', d.progressed, '飞书或 GitLab 有新证据'),
    metric('风险需求', d.risky, '需要关注或推进'),
    metric('P0/P1 风险', d.highPriorityRisks, '优先处理'),
    '</div>',
    '<div class="split">',
    panel('优先风险', list(data.risks.slice(0, 6).map(riskItem))),
    panel('建议沟通', list(data.people.filter(p => p.suggestedContacts || p.highPriorityRisks).slice(0, 6).map(personItem))),
    '</div>',
    '<div class="split">',
    panel('GitLab 有进展但需求未同步', list(data.evidence.filter(e => !e.storyId).slice(0, 6).map(evidenceItem))),
    panel('可以不打扰', list((data.quietStories || []).slice(0, 6).map(storyItem))),
    '</div>',
    panel('最近 GitLab 迭代', list(recentGitLabEvidence(data).slice(0, 8).map(evidenceItem)))
  ].join('');
}

function recentGitLabEvidence(data) {
  return (data.evidence || [])
    .filter(e => String(e.type || '').startsWith('gitlab_'))
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
}

function renderRisks(data) {
  if (!data.risks.length) return empty('当前没有风险。');
  const sorted = data.risks.slice().sort(compareRisk);
  const urgent = sorted.filter(r => r.priority === 'P0' || r.priority === 'P1');
  const high = sorted.filter(r => r.severity === 'high' && r.priority !== 'P0' && r.priority !== 'P1');
  const missingInfo = sorted.filter(r => !urgent.includes(r) && !high.includes(r) && /missing|缺/.test(String(r.category) + String(r.description)));
  const other = sorted.filter(r => !urgent.includes(r) && !high.includes(r) && !missingInfo.includes(r));
  return [
    '<div class="summary-strip">',
    summaryCard('P0/P1 风险', urgent.length, '今天优先处理'),
    summaryCard('高风险', high.length, '非 P0/P1 但影响较高'),
    summaryCard('信息缺失', missingInfo.length, '目标、排期、测试或下一步缺口'),
    summaryCard('已降噪', Math.max(0, data.risks.length - Math.min(sorted.length, 36)), '低优先级风险不在首屏铺开'),
    '</div>',
    '<div class="section-grid">',
    riskSection('优先处理', 'P0/P1 或已影响交付判断的风险。', urgent.slice(0, 12), 'danger'),
    riskSection('高风险跟进', '不一定马上打扰，但需要 owner 给出下一步。', high.slice(0, 12), 'danger'),
    riskSection('信息维护缺口', '先补齐目标、排期、测试计划或下一步，再判断是否升级。', missingInfo.slice(0, 12), 'warn'),
    riskSection('其余风险样本', '保留代表性样本，避免把历史沉积无差别铺满页面。', other.slice(0, 12), 'warn'),
    '</div>'
  ].join('');
}

function renderPeople(data) {
  if (!data.people.length) return empty('暂无人员状态。');
  return table(['人', '需求', '风险', '建议沟通', '问题'], data.people.map(p => [
    '<strong>' + escapeHtml(p.name) + '</strong>',
    escapeHtml(p.storyTitles.slice(0, 4).join('；') || '-'),
    chip(String(p.highPriorityRisks), p.highPriorityRisks ? 'danger' : 'ok') + ' P0/P1/高风险',
    chip(String(p.suggestedContacts), p.suggestedContacts ? 'warn' : 'ok'),
    escapeHtml(p.questions[0] || '暂无必须打扰的问题')
  ]));
}

function renderStories(data) {
  const toolbar = dateToolbar(data);
  if (!data.latestReport) return toolbar + empty('当天暂无 PMO 日报，因此没有飞书项目需求状态。请选择已有日报日期查看。');
  const todayProgress = data.storyProgress || [];
  const board = data.storyBoard || [];
  const boardCount = board.reduce((sum, group) => sum + group.count, 0);
  const highRiskCount = board.reduce((sum, group) => sum + group.highRiskCount, 0);
  const incompleteCount = board.reduce((sum, group) => sum + group.incompleteCount, 0);
  return [
    toolbar,
    '<div class="summary-strip">',
    summaryCard('今天有进展', todayProgress.length, '字段、评论、文档或 GitLab 证据变化'),
    summaryCard('看板活跃需求', boardCount, '近 1-2 个月活跃或有风险/证据'),
    summaryCard('高风险', highRiskCount, 'P0/P1 或 high risk'),
    summaryCard('信息缺失', incompleteCount, '近期活跃但目标/排期/测试/下一步不足'),
    '</div>',
    panel('A. 今天有进展', todayProgress.length ? '<div class="progress-grid">' + todayProgress.map(storyProgressCard).join('') + '</div>' : empty('今天没有检测到飞书项目字段、评论、文档或 GitLab 匹配变化。')),
    panel('B. 项目看板', board.length ? '<div class="board-grid">' + board.map(boardColumn).join('') + '</div>' : empty('近 1-2 个月没有活跃需求。')),
    panel('已降噪/历史沉积', '<div class="empty">长期无更新、无风险、无交付证据的需求不进入默认主体视图；当前日报降噪 ' + escapeHtml(data.dashboard.suppressed || 0) + ' 个。</div>')
  ].join('');
}

function renderEvidence(data) {
  const toolbar = dateToolbar(data);
  if (!data.latestReport) return toolbar + empty('当天暂无 PMO 日报，因此没有 GitLab 迭代数据。请选择已有日报日期查看。');
  if (!data.gitlabPeople?.length) return toolbar + empty('当天暂无 GitLab 迭代证据。');
  const gitlab = recentGitLabEvidence(data);
  const people = data.gitlabPeople || [];
  const totals = people.reduce((acc, person) => {
    acc.mr += person.mrCount; acc.commit += person.commitCount; acc.pipeline += person.pipelineCount; acc.unmatched += person.unmatched; acc.failed += person.failedPipelines; acc.blocked += person.blockedMrs;
    return acc;
  }, { mr: 0, commit: 0, pipeline: 0, unmatched: 0, failed: 0, blocked: 0 });
  return [
    toolbar,
    '<div class="summary-strip">',
    summaryCard('参与人员', people.length, '按 GitLab author 聚合'),
    summaryCard('MR / Commit / Pipeline', totals.mr + ' / ' + totals.commit + ' / ' + totals.pipeline, '当天代码交付证据'),
    summaryCard('失败/卡住', totals.failed + ' / ' + totals.blocked, '失败 pipeline / 可能卡住 MR'),
    summaryCard('未同步需求', totals.unmatched, '代码进展未匹配飞书需求'),
    '</div>',
    panel('当天每个人具体迭代了什么', '<div class="person-list">' + people.map(personIterationRow).join('') + '</div>'),
    panel('未关联飞书需求的代码进展', list(gitlab.filter(e => !e.storyId).slice(0, 8).map(evidenceItem)))
  ].join('');
}

function dateToolbar(data) {
  const current = state.date || data.selectedDate || todayChinaDate();
  const dates = (data.availableReportDates || []).map(date => '<option value="' + escapeHtml(date) + '"></option>').join('');
  return '<div class="date-toolbar"><label>查看日期<input id="evidence-date" type="date" value="' + escapeHtml(current) + '" list="report-dates"><datalist id="report-dates">' + dates + '</datalist></label><div class="top-actions"><button type="button" id="apply-date">查看当天</button><button type="button" class="ghost-link" id="today-date">今天</button></div></div>';
}

function renderRuns(data) {
  const runs = data.runs || [];
  if (!runs.length) return empty('暂无运行记录。');
  return table(['日期', '状态', '开始', '结束', '产物', '失败处理'], runs.map(run => [
    escapeHtml(run.date || '-'),
    chip(run.status || '-', run.status === 'success' ? 'ok' : 'danger'),
    escapeHtml(run.startedAt || '-'),
    escapeHtml(run.finishedAt || '-'),
    run.artifacts?.reportHtmlPath ? link('/reports/' + run.artifacts.reportHtmlPath.split('/').pop(), '日报') : '-',
    run.status === 'failed' ? '可通过 /runs/{runId}/retry-stage 重试失败阶段；高风险动作仍需审批。' : '无需处理'
  ]));
}

function renderApprovals(data) {
  const drafts = data.drafts || [];
  const pendingDrafts = drafts.filter(d => d.status === 'pending');
  const approval = data.approvalCenter || {};
  const pendingCommunicationDrafts = approval.pendingCommunicationDrafts || [];
  const pendingProjectUpdates = approval.pendingProjectUpdates || [];
  return [
    '<div class="metric-grid">',
    metric('待审批总数', data.dashboard.pendingApprovals, '沟通草稿 + 项目字段更新'),
    metric('待发送草稿', data.dashboard.pendingDrafts, '已生成但未发送'),
    metric('沟通审批', pendingCommunicationDrafts.length, '来自审批中心'),
    metric('字段更新审批', pendingProjectUpdates.length, '高风险写操作默认不直写'),
    '</div>',
    panel('沟通草稿', drafts.length ? table(['状态', '对象', '优先级', '需求', '原因'], drafts.map(d => [
      chip(d.status || '-', d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'warn' : ''),
      escapeHtml(d.recipient?.name || d.recipient || '-'),
      chip(d.priority || '-', d.priority === 'high' ? 'danger' : 'warn'),
      escapeHtml((d.storyTitles || []).slice(0, 3).join('；') || '-'),
      escapeHtml(d.reason || '-')
    ])) : empty('暂无沟通草稿')),
    panel('项目字段更新审批', pendingProjectUpdates.length ? table(['动作', '需求', '字段', '状态'], pendingProjectUpdates.map(a => [
      escapeHtml(a.id || a.actionId || '-'),
      escapeHtml(a.storyTitle || a.storyId || '-'),
      escapeHtml(a.field || '-'),
      chip(a.status || 'pending', 'warn')
    ])) : empty('暂无待审批字段更新'))
  ].join('');
}

function renderOps(data) {
  const ops = data.ops || {};
  const alerts = ops.alerts || [];
  const botEvents = data.botEvents || [];
  const workerEvents = ops.workerEvents || [];
  return [
    '<div class="metric-grid">',
    metric('Ops alerts', alerts.length, '运行面板告警'),
    metric('Bot 事件', data.dashboard.botEvents, '飞书 webhook 审计'),
    metric('Worker 事件', workerEvents.length, '定时运行记录'),
    metric('失败运行', data.dashboard.failedRuns, '最近 runs.json'),
    '</div>',
    panel('告警', alerts.length ? list(alerts.slice(0, 8).map(a => '<article class="item"><div class="item-title">' + escapeHtml(a.title || a.type || 'Alert') + '</div><div class="item-meta">' + escapeHtml(a.message || a.reason || JSON.stringify(a)) + '</div></article>')) : empty('暂无告警')),
    panel('Bot 审计', botEvents.length ? table(['时间', '决策', '原因', '命令', '会话'], botEvents.slice(0, 20).map(e => [
      escapeHtml(e.at || '-'),
      chip(e.decision || '-', e.decision === 'replied' ? 'ok' : 'warn'),
      escapeHtml(e.reason || '-'),
      escapeHtml(e.command || '-'),
      escapeHtml(e.chatType || '-')
    ])) : empty('暂无 Bot 事件')),
    panel('Worker 事件', workerEvents.length ? table(['时间', '类型', '状态', '摘要'], workerEvents.slice(0, 20).map(e => [
      escapeHtml(e.at || e.startedAt || '-'),
      escapeHtml(e.type || e.event || '-'),
      chip(e.status || '-', e.status === 'success' ? 'ok' : e.status === 'failed' ? 'danger' : ''),
      escapeHtml(e.summary || e.message || '-')
    ])) : empty('暂无 Worker 事件'))
  ].join('');
}

function renderReports(data) {
  if (!data.reports.length) return empty('暂无报告。');
  return table(['日期', '标题', 'HTML', 'Markdown', 'JSON'], data.reports.map(report => [
    escapeHtml(report.date || '-'),
    escapeHtml(report.title),
    report.htmlFile ? link('/reports/' + report.htmlFile, '打开') : '-',
    report.markdownFile ? link('/reports/' + report.markdownFile, '查看') : '-',
    report.jsonFile ? link('/reports/' + report.jsonFile, '数据') : '-'
  ]));
}

function renderSettings(data) {
  const settings = data.settings || { dataSources: [], capabilities: [], accessControl: [], artifacts: [] };
  return [
    '<div class="metric-grid">',
    metric('数据源', settings.dataSources.length, 'GitLab / 飞书项目 / 文档 / Bot'),
    metric('能力项', settings.capabilities.length, '启用或审批保护'),
    metric('访问控制', settings.accessControl.filter(x => x.status === 'enabled').length, '已启用控制项'),
    metric('产物', settings.artifacts.filter(x => x.status === 'present').length, '可读取文件'),
    '</div>',
    '<div class="split">',
    panel('数据源状态', statusList(settings.dataSources)),
    panel('能力边界', statusList(settings.capabilities)),
    '</div>',
    '<div class="split">',
    panel('访问控制', statusList(settings.accessControl)),
    panel('产物状态', statusList(settings.artifacts)),
    '</div>',
    panel('线上入口', table(['入口', '说明'], [
      [link('/app', 'PMO 控制台'), '内部工作台，Basic Auth 保护'],
      [link('/reports/latest-pmo-audit.html', '最新日报'), 'HTML 日报'],
      [link('/reports/index.html', '报告索引'), '历史报告列表'],
      [link('/health', '健康检查'), '公开健康检查']
    ]))
  ].join('');
}

function renderChat(data) {
  const d = data.dashboard;
  return [
    '<section class="chat-workspace" aria-label="PMO Agent Chat">',
    '<aside class="chat-rail">',
    '<div class="chat-rail-head"><strong>PMO Chat</strong><span class="chat-source">Inspired by Open WebUI</span></div>',
    '<div class="chat-rail-section"><h3>会话模板</h3><div class="chat-thread-list">',
    chatThread('状态核查', '红黄绿、延期风险、隐藏风险', true),
    chatThread('风险推进', 'P0/P1、blocker、建议沟通', false),
    chatThread('交付证据', 'GitLab MR、commit、pipeline', false),
    chatThread('人员进展', '按 owner / author 查询', false),
    '</div></div>',
    '<div class="chat-rail-section"><h3>快捷问题</h3><div class="chat-suggestion-list">',
    chatSuggestion('当前整体是绿灯黄灯还是红灯？为什么？'),
    chatSuggestion('本周有哪些实质进展？'),
    chatSuggestion('今天 GitLab 上谁有交付证据？'),
    chatSuggestion('哪些信息缺失导致你无法判断状态？'),
    chatSuggestion('哪些事项可以不打扰？'),
    '</div></div>',
    '<div class="agent-card"><span>安全边界</span><strong>只读优先</strong><p>Chat 可以解释、汇总、生成草稿；发送飞书消息和写回飞书项目字段仍走审批。</p></div>',
    '</aside>',
    '<div class="chat-main">',
    '<header class="chat-header"><div><p class="eyebrow">MAAS 平台</p><h2>PMO 状态问答</h2><p>复用日报、需求、风险、GitLab 证据、运行记录和审批状态回答。</p></div><div class="chat-context-chips">',
    chip('日期 ' + (data.selectedDate || data.latestReport?.date || state.date)),
    chip('风险 ' + d.risky, d.risky ? 'warn' : 'ok'),
    chip('P0/P1 ' + d.highPriorityRisks, d.highPriorityRisks ? 'danger' : 'ok'),
    chip('进展 ' + d.progressed, d.progressed ? 'ok' : ''),
    '</div></header>',
    '<div id="pmo-chat-log" class="pmo-chat-log" aria-live="polite">',
    state.chatMessages.length ? state.chatMessages.map(renderChatMessage).join('') : renderChatEmpty(),
    '</div>',
    '<div class="pmo-chat-composer"><form id="pmo-chat-form"><textarea id="pmo-chat-input" rows="2" placeholder="问项目状态、风险、人员进展、GitLab 交付证据..."></textarea><button type="submit">发送</button></form><div class="pmo-chat-hint">Enter 发送，Shift+Enter 换行。回答会标明证据或置信度；高风险动作只生成草稿或审批建议。</div></div>',
    '</div>',
    '</section>'
  ].join('');
}

function chatThread(title, subtitle, active) {
  return '<button type="button" class="chat-thread ' + (active ? 'active' : '') + '" data-chat-prompt="' + escapeHtml(title) + '"><strong>' + escapeHtml(title) + '</strong><br><span>' + escapeHtml(subtitle) + '</span></button>';
}

function chatSuggestion(prompt) {
  return '<button type="button" class="chat-suggestion" data-chat-prompt="' + escapeHtml(prompt) + '">' + escapeHtml(prompt) + '</button>';
}

function renderChatEmpty() {
  const prompts = [
    ['项目状态', '当前整体是绿灯黄灯还是红灯？为什么？', '结论前置，列证据、风险和下一步。'],
    ['今日/本周进展', '本周有哪些实质进展？', '只看真实变化，不铺历史沉积需求。'],
    ['交付证据', '今天 GitLab 上谁有交付证据？', '按人聚合 MR、commit、pipeline 和同步风险。'],
    ['信息缺口', '哪些信息缺失导致你无法判断状态？', '列 owner、目标、排期、测试计划、下一步缺口。'],
  ];
  return '<div class="pmo-chat-empty"><div class="pmo-chat-empty-card"><h3>问 PMO Agent 一个具体问题</h3><p>这个页面是独立 Chat 入口，参考 Open WebUI 的会话体验，但回答范围限定在 MAAS 平台 PMO 数据：日报、飞书项目、GitLab 迭代、运行记录和审批状态。</p></div><div class="pmo-chat-prompt-grid">' + prompts.map(([title, prompt, hint]) => '<button type="button" class="pmo-chat-prompt" data-chat-prompt="' + escapeHtml(prompt) + '"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(prompt) + '<br>' + escapeHtml(hint) + '</span></button>').join('') + '</div></div>';
}

function renderChatMessage(message) {
  if (message.role === 'assistant' && message.answer) {
    return '<article class="pmo-message assistant">' + escapeHtml(message.answer.text || '') + renderAnswerMeta(message.answer) + renderAnswerLinks(message.answer.links || []) + '</article>';
  }
  return '<article class="pmo-message ' + escapeHtml(message.role) + '">' + escapeHtml(message.text || '') + '</article>';
}

function renderAnswerMeta(answer) {
  return '<div class="pmo-answer-meta">' + chip('intent ' + (answer.intent || 'unknown')) + chip('confidence ' + (answer.confidence || 'unknown'), answer.confidence === 'high' ? 'ok' : answer.confidence === 'medium' ? 'warn' : 'danger') + '</div>';
}

function renderAnswerLinks(links) {
  return links.length ? '<div class="pmo-answer-links">' + links.map(item => link(item.url, item.label)).join('') + '</div>' : '';
}

function renderAgent(data) {
  return [
    panel('自然语言入口', table(['能力', '示例', '安全边界'], [
      ['整体风险', '今天有哪些风险？本周最需要关注什么？', '只读回答，附规则和证据来源'],
      ['人员状态', '王建辉在做什么？谁需要沟通？', '只给建议沟通，不直接发送'],
      ['需求解释', '企业套餐购买为什么是风险？', '回答状态、证据、风险和下一步'],
      ['交付同步', '代码有进展但需求没同步的有哪些？', '列孤立证据，不直接改字段'],
      ['日报生成', '生成日报 2026-06-02', '飞书 Bot 明确命令可触发；写回仍需审批']
    ])),
    panel('当前上下文', list([
      '<article class="item"><div class="item-title">最新报告</div><div class="item-meta">' + escapeHtml(data.latestReport?.title || '暂无') + '</div></article>',
      '<article class="item"><div class="item-title">高风险</div><div class="item-meta">P0/P1 ' + escapeHtml(data.dashboard.highPriorityRisks) + ' 个；风险需求 ' + escapeHtml(data.dashboard.risky) + ' 个</div></article>',
      '<article class="item"><div class="item-title">审批保护</div><div class="item-meta">发送飞书消息和写回飞书项目字段都不会由自然语言直接执行。</div></article>'
    ]))
  ].join('');
}

function metric(label, value, hint) {
  return '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><div class="item-meta">' + escapeHtml(hint) + '</div></div>';
}

function summaryCard(label, value, hint) {
  return '<div class="summary-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><p>' + escapeHtml(hint) + '</p></div>';
}

function panel(title, body) {
  return '<section class="panel"><div class="panel-head"><h2>' + escapeHtml(title) + '</h2></div>' + body + '</section>';
}

function list(items) {
  return items.length ? '<div class="list">' + items.join('') + '</div>' : empty('暂无数据');
}

function riskItem(r) {
  return '<article class="item"><div class="item-head"><div><div class="item-title">' + link(r.storyUrl, r.storyTitle) + '</div><div class="item-meta">' + escapeHtml(r.description) + '</div></div><div>' + chip(r.priority, r.priority === 'P0' || r.priority === 'P1' ? 'danger' : 'warn') + '</div></div><div class="chips">' + chip(r.severity, r.severity === 'high' ? 'danger' : 'warn') + chip(r.owner || '未指定') + '</div></article>';
}

function riskSection(title, subtitle, risks, tone) {
  const body = risks.length ? '<div class="list">' + risks.map(r => priorityRiskCard(r, tone)).join('') + '</div>' : empty('暂无需要展示的事项。');
  return '<section class="panel"><div class="panel-head"><div><h2>' + escapeHtml(title) + '</h2><div class="item-meta">' + escapeHtml(subtitle) + '</div></div>' + chip(String(risks.length), tone) + '</div>' + body + '</section>';
}

function priorityRiskCard(r, tone) {
  const kind = tone || (r.priority === 'P0' || r.priority === 'P1' || r.severity === 'high' ? 'danger' : 'warn');
  return '<article class="priority-card ' + escapeHtml(kind) + '"><div class="priority-top"><div><div class="priority-title">' + link(r.storyUrl, r.storyTitle) + '</div><div class="priority-meta">' + escapeHtml(r.description) + '</div></div><div class="chips">' + chip(r.priority, kind) + chip(r.severity, r.severity === 'high' ? 'danger' : 'warn') + '</div></div><div class="priority-action"><strong>建议动作</strong>' + escapeHtml(r.suggestedAction || '先确认 owner、目标和下一步。') + '</div><div class="chips">' + chip(r.owner || '未指定', r.owner ? '' : 'warn') + chip(r.whyNow || r.category || '证据不足') + '</div></article>';
}

function personItem(p) {
  return '<article class="item"><div class="item-title">' + escapeHtml(p.name) + '</div><div class="item-meta">需求 ' + p.stories + ' 个；风险 ' + p.riskyStories + ' 个；建议沟通 ' + p.suggestedContacts + ' 条</div><div class="chips">' + chip('P0/P1/高风险 ' + p.highPriorityRisks, p.highPriorityRisks ? 'danger' : 'ok') + '</div></article>';
}

function evidenceItem(e) {
  return '<article class="item"><div class="item-title">' + link(e.url, e.title) + '</div><div class="item-meta">' + escapeHtml(e.storyTitle || '未匹配飞书需求') + ' · ' + escapeHtml(e.author || 'unknown') + '</div><div class="chips">' + chip(e.type, e.storyTitle ? 'ok' : 'warn') + chip(e.confidence || 'unknown') + '</div></article>';
}

function personIterationRow(person) {
  const displayName = person.author === 'unknown' ? 'unknown（pipeline 未携带 author）' : (person.displayName || person.author);
  const authorMeta = person.displayName && person.displayName !== person.author ? 'GitLab: ' + person.author + ' · ' + identitySourceLabel(person.identitySource) : identitySourceLabel(person.identitySource);
  const repos = (person.repos || []).slice(0, 3).join('、') || 'unknown repo';
  const stories = (person.stories || []).slice(0, 3).join('、') || '未匹配飞书需求';
  const riskChips = [
    person.failedPipelines ? chip('失败 pipeline ' + person.failedPipelines, 'danger') : '',
    person.blockedMrs ? chip('卡住 MR ' + person.blockedMrs, 'danger') : '',
    person.unmatched ? chip('未同步 ' + person.unmatched, 'warn') : chip('需求已同步', 'ok'),
  ].join('');
  return '<details class="person-row"><summary><div class="person-summary"><div><div class="person-name">' + escapeHtml(displayName) + '</div><div class="item-meta">' + escapeHtml(authorMeta) + ' · 共 ' + escapeHtml(person.total) + ' 条 GitLab 证据</div></div><div class="person-metrics">' + chip('MR ' + person.mrCount) + chip('commit ' + person.commitCount) + chip('pipeline ' + person.pipelineCount) + riskChips + '</div><div class="person-focus">Repo：' + escapeHtml(repos) + '<br>需求：' + escapeHtml(stories) + '</div></div></summary><div class="iteration-list">' + (person.items || []).map(iterationCard).join('') + '</div></details>';
}

function identitySourceLabel(source) {
  if (source === 'gitlab_email') return '邮箱匹配';
  if (source === 'manual_alias') return '人工映射';
  return 'GitLab author';
}

function iterationCard(item) {
  const risk = (item.risks || []).length ? '<div class="chips">' + item.risks.map(text => chip(text, /失败|卡住|未关联/.test(text) ? 'warn' : '')).join('') + '</div>' : '<div class="chips">' + chip('暂无明显风险', 'ok') + '</div>';
  const evidence = (item.evidence || []).slice(0, 8).map(e => link(e.url, e.type.replace('gitlab_', '') + ' · ' + (e.title || e.id))).join('');
  return '<article class="iteration-card"><div><h3>' + link(item.storyUrl, item.storyTitle || item.title) + '</h3><div class="item-meta">' + escapeHtml(item.summary || '暂无概括') + '</div><div class="evidence-links">' + evidence + '</div></div><aside class="iteration-facts"><span>Repo：' + escapeHtml(item.repo) + '</span><span>迭代人：' + escapeHtml(item.author) + '</span><span>耗时：' + escapeHtml(item.durationLabel) + '</span><span>复杂度：' + escapeHtml(item.complexity) + ' · ' + escapeHtml(item.complexityReason) + '</span><span>匹配飞书：' + (item.matched ? '已匹配' : '未匹配') + ' · ' + escapeHtml(item.confidence) + '</span>' + risk + '</aside></article>';
}

function storyItem(story) {
  return '<article class="item"><div class="item-title">' + link(story.url, story.title) + '</div><div class="item-meta">' + escapeHtml(story.status || '-') + ' · ' + escapeHtml(story.owners.join('、') || '未指定') + '</div><div class="chips">' + chip('风险 ' + story.riskCount, story.riskCount ? 'warn' : 'ok') + chip('证据 ' + story.evidenceCount, story.evidenceCount ? 'ok' : '') + '</div></article>';
}

function storyProgressCard(story) {
  const changes = (story.changes || []).slice(0, 3).map(change => '<li>' + escapeHtml(change) + '</li>').join('');
  return '<article class="priority-card ' + escapeHtml(story.riskLevel) + '"><div class="priority-top"><div><div class="priority-title">' + link(story.url, story.title) + '</div><div class="priority-meta">' + escapeHtml(story.status || '-') + ' · ' + escapeHtml((story.owners || []).join('、') || '未指定') + ' · 更新 ' + escapeHtml(story.updatedAt || '-') + '</div></div>' + chip(story.riskLevel, story.riskLevel) + '</div><div class="priority-action"><strong>今天变化</strong><ul>' + changes + '</ul></div><div class="priority-action"><strong>下一步</strong>' + escapeHtml(story.nextStep || '暂无明确下一步') + '</div><div class="chips">' + (story.sources || []).map(source => chip(source, /GitLab/.test(source) ? 'ok' : '')).join('') + (story.missingInfo ? chip('信息缺失', 'warn') : '') + (story.hasGitLabEvidence ? chip('有关联 GitLab', 'ok') : '') + chip(story.confidence || 'unknown') + '</div></article>';
}

function boardColumn(group) {
  const recent = (group.recent || []).slice(0, 5).map(boardStoryMini).join('');
  const stalled = (group.stalled || []).slice(0, 3).map(story => '<div class="mini-card"><strong>' + link(story.url, story.title) + '</strong><div class="item-meta">卡住/待补：' + escapeHtml((story.reasons || []).slice(0, 1).join('；') || '风险待处理') + '</div></div>').join('');
  return '<section class="board-column"><div class="board-head"><strong>' + escapeHtml(group.status) + '</strong><div class="person-metrics">' + chip('需求 ' + group.count) + chip('高风险 ' + group.highRiskCount, group.highRiskCount ? 'danger' : 'ok') + chip('信息缺失 ' + group.incompleteCount, group.incompleteCount ? 'warn' : 'ok') + '</div></div><div class="board-body">' + (recent || empty('暂无近期进展')) + (stalled ? '<div class="item-meta">卡住较久</div>' + stalled : '') + '</div></section>';
}

function boardStoryMini(story) {
  return '<div class="mini-card"><strong>' + link(story.url, story.title) + '</strong><div class="item-meta">' + escapeHtml((story.owners || []).join('、') || '未指定') + ' · ' + escapeHtml(story.updatedAt || '-') + '</div><div class="chips">' + chip(story.health || 'unknown', story.health === 'red' ? 'danger' : story.health === 'yellow' ? 'warn' : story.health === 'green' ? 'ok' : '') + chip('风险 ' + story.riskCount, story.highRiskCount ? 'danger' : story.riskCount ? 'warn' : 'ok') + chip('GitLab ' + story.evidenceCount, story.evidenceCount ? 'ok' : 'warn') + '</div></div>';
}

function storySection(title, subtitle, stories, tone) {
  const body = stories.length ? '<div class="card-grid">' + stories.map(story => priorityStoryCard(story, tone)).join('') + '</div>' : empty('暂无需要展示的事项。');
  return '<section class="panel"><div class="panel-head"><div><h2>' + escapeHtml(title) + '</h2><div class="item-meta">' + escapeHtml(subtitle) + '</div></div>' + chip(String(stories.length), tone) + '</div>' + body + '</section>';
}

function priorityStoryCard(story, tone) {
  const healthKind = story.health === 'red' ? 'danger' : story.health === 'yellow' ? 'warn' : story.health === 'green' ? 'ok' : '';
  const reason = (story.reasons || []).slice(0, 2).join('；') || story.progressSummary || '暂无下一步线索';
  const kind = tone || healthKind || (story.riskCount ? 'warn' : 'ok');
  return '<article class="priority-card ' + escapeHtml(kind) + '"><div class="priority-top"><div><div class="priority-title">' + link(story.url, story.title) + '</div><div class="priority-meta">ID ' + escapeHtml(story.id) + ' · ' + escapeHtml(story.status || '-') + ' · ' + escapeHtml(story.owners.join('、') || '未指定') + '</div></div>' + chip(story.health || 'unknown', healthKind) + '</div><div class="priority-action"><strong>下一步线索</strong>' + escapeHtml(reason) + '</div><div class="chips">' + chip('风险 ' + story.riskCount, story.highRiskCount ? 'danger' : story.riskCount ? 'warn' : 'ok') + chip('证据 ' + story.evidenceCount, story.evidenceCount ? 'ok' : 'warn') + chip(story.workstream || '未分组') + '</div></article>';
}

function statusList(items) {
  return list((items || []).map(item => '<article class="item"><div class="item-head"><div><div class="item-title">' + escapeHtml(item.name) + '</div><div class="item-meta">' + escapeHtml(item.detail) + '</div></div>' + chip(item.status, statusKind(item.status)) + '</div></article>'));
}

function statusKind(status) {
  if (/connected|enabled|present/.test(status)) return 'ok';
  if (/approval_required|degraded/.test(status)) return 'warn';
  if (/missing|disabled/.test(status)) return 'danger';
  return '';
}

function table(headers, rows) {
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((cell, index) => '<td data-label="' + escapeHtml(headers[index] || '') + '">' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}

function compareRisk(a, b) {
  const priorityScore = value => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[value] ?? 4);
  const severityScore = value => ({ high: 0, medium: 1, low: 2 }[value] ?? 3);
  return priorityScore(a.priority) - priorityScore(b.priority) || severityScore(a.severity) - severityScore(b.severity) || String(a.storyTitle).localeCompare(String(b.storyTitle), 'zh-CN');
}

function compareStory(a, b) {
  const healthScore = value => ({ red: 0, yellow: 1, green: 2 }[value] ?? 3);
  return (b.highRiskCount || 0) - (a.highRiskCount || 0) || (b.riskCount || 0) - (a.riskCount || 0) || healthScore(a.health) - healthScore(b.health) || (b.evidenceCount || 0) - (a.evidenceCount || 0);
}

function chip(text, kind) {
  return '<span class="chip ' + escapeHtml(kind || '') + '">' + escapeHtml(text) + '</span>';
}

function empty(text) {
  return '<div class="empty">' + escapeHtml(text) + '</div>';
}

document.querySelectorAll('.nav button').forEach(button => {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    const path = pathForCurrentState();
    if (location.pathname + location.search !== path) history.pushState({ view: state.view, date: state.date }, '', path);
    render();
  });
});
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => {
    const input = $('#chat-input');
    input.value = button.dataset.prompt || '';
    input.focus();
    $('#chat-form').requestSubmit();
  });
});
window.addEventListener('popstate', () => {
  state.view = viewFromPath(location.pathname);
  state.date = dateFromUrl() || state.date || todayChinaDate();
  loadState();
});
$('#refresh').addEventListener('click', loadState);
$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addBubble(text, 'user');
  try {
    const res = await fetch('/api/app/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, date: state.date })
    });
    const body = await res.json();
    addBubble(body.answer?.text || body.error?.message || '没有返回内容', 'bot');
  } catch (error) {
    addBubble('请求失败：' + error.message, 'bot');
  }
});
function addBubble(text, type) {
  const node = document.createElement('div');
  node.className = 'bubble ' + type;
  node.textContent = text;
  $('#chat-log').appendChild(node);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}
loadState();

function viewFromPath(pathname) {
  return pathViewMap[pathname.replace(/\\/+$/, '') || '/app'] || 'dashboard';
}

function bindDynamicControls() {
  const apply = $('#apply-date');
  const input = $('#evidence-date');
  const today = $('#today-date');
  if (apply && input) {
    apply.addEventListener('click', () => {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(input.value)) return;
      state.date = input.value;
      history.pushState({ view: state.view, date: state.date }, '', pathForCurrentState());
      loadState();
    });
  }
  if (today && input) {
    today.addEventListener('click', () => {
      state.date = todayChinaDate();
      input.value = state.date;
      history.pushState({ view: state.view, date: state.date }, '', pathForCurrentState());
      loadState();
    });
  }
  bindPmoChatControls();
}

function bindPmoChatControls() {
  document.querySelectorAll('[data-chat-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      const input = $('#pmo-chat-input');
      if (!input) return;
      input.value = button.dataset.chatPrompt || '';
      input.focus();
      $('#pmo-chat-form')?.requestSubmit();
    });
  });
  const form = $('#pmo-chat-form');
  const input = $('#pmo-chat-input');
  if (!form || !input) return;
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendPmoChatMessage({ role: 'user', text });
    const loadingId = appendPmoChatMessage({ role: 'loading', text: '正在查询 PMO 状态、风险和证据...' });
    try {
      const res = await fetch('/api/app/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          date: state.date,
          history: state.chatMessages.filter(message => message.role === 'user' || message.role === 'assistant').slice(-8)
        })
      });
      const body = await res.json();
      removePmoChatMessage(loadingId);
      if (!res.ok || !body.success) throw new Error(body.error?.message || '请求失败');
      appendPmoChatMessage({ role: 'assistant', answer: body.answer });
    } catch (error) {
      removePmoChatMessage(loadingId);
      appendPmoChatMessage({ role: 'error', text: '请求失败：' + error.message });
    }
  });
}

function appendPmoChatMessage(message) {
  const id = message.id || 'msg-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  state.chatMessages.push({ ...message, id });
  renderPmoChatLog();
  return id;
}

function removePmoChatMessage(id) {
  state.chatMessages = state.chatMessages.filter(message => message.id !== id);
  renderPmoChatLog();
}

function renderPmoChatLog() {
  const log = $('#pmo-chat-log');
  if (!log) return;
  log.innerHTML = state.chatMessages.length ? state.chatMessages.map(renderChatMessage).join('') : renderChatEmpty();
  log.scrollTop = log.scrollHeight;
  bindPmoChatPromptButtons();
}

function bindPmoChatPromptButtons() {
  document.querySelectorAll('#pmo-chat-log [data-chat-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      const input = $('#pmo-chat-input');
      if (!input) return;
      input.value = button.dataset.chatPrompt || '';
      input.focus();
      $('#pmo-chat-form')?.requestSubmit();
    });
  });
}

function pathForCurrentState() {
  const path = viewPathMap[state.view] || '/app';
  const params = new URLSearchParams();
  if (state.date) params.set('date', state.date);
  const query = params.toString();
  return query ? path + '?' + query : path;
}

function dateFromUrl() {
  const date = new URLSearchParams(location.search).get('date');
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(date || '') ? date : '';
}

function todayChinaDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
`
