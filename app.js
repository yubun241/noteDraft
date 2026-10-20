// note drafts — GitHub Pages で動く静的 SPA。
// 下書きは private repo の <dir>/*.md に保存し、GitHub Contents API を PAT で直接叩く。
// note への受け渡しは Markdown → HTML を clipboard(text/html) に載せて貼り付ける。
// 構想（WHY/HOW/WHAT）は frontmatter に持ち、本文とは分離する。note には出さず、AI 用プロンプトの材料にする。

import MarkdownIt from "https://esm.sh/markdown-it@14";

// ---------- 設定 ----------
const CFG_KEY = "note-drafts.config";
const DEFAULT_PROMPT_EMPTY =
  "上記の構想に基づいて、note 記事の見出し構成（H2/H3）と各節で書くべき要点を提案してください。構想に穴や矛盾があれば先に指摘してください。";
const DEFAULT_PROMPT_BODY =
  "上記の構想と本文を照らし合わせ、(1) WHY が本文で達成できているか、(2) 論理の飛躍や根拠不足、(3) 削るべき箇所、を指摘してください。書き直し案は求めていません。";
const cfg = {
  load() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch { return null; }
  },
  save(v) { localStorage.setItem(CFG_KEY, JSON.stringify(v)); },
};

// ---------- 構想フレームワーク ----------
// key は frontmatter のキー、label はプロンプトに出す見出し。
const FRAME = [
  { section: "WHY",  key: "why",  label: "読み手になってほしい姿 / 伝えたいこと" },
  { section: "HOW",  key: "how",  label: "どのような内容 / 自分が思ったこと" },
  { section: "WHAT", key: "what", label: "具体的な内容" },
];
const FRAME_KEYS = FRAME.map((f) => f.key);
// 旧形式（2欄分割）からの移行: 読込時に結合する
const LEGACY_MERGE = { why: ["why_reader", "why_message"], how: ["how_content", "how_thought"] };

// ---------- GitHub Contents API ----------
class GitHubRepo {
  constructor({ owner, repo, branch, dir, token }) {
    Object.assign(this, { owner, repo, branch, dir: dir.replace(/^\/+|\/+$/g, ""), token });
  }
  get base() { return `https://api.github.com/repos/${this.owner}/${this.repo}/contents`; }
  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }
  async req(method, path, body) {
    const url = `${this.base}/${path}` + (method === "GET" ? `?ref=${encodeURIComponent(this.branch)}&t=${Date.now()}` : "");
    const res = await fetch(url, {
      method,
      headers: this.headers(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }
  async list() {
    const items = (await this.req("GET", this.dir)) || [];
    return items.filter((i) => i.type === "file" && i.name.endsWith(".md"))
      .map((i) => ({ name: i.name, path: i.path, sha: i.sha }));
  }
  async read(name) {
    const f = await this.req("GET", `${this.dir}/${name}`);
    if (!f) return null;
    return { name, sha: f.sha, text: b64decode(f.content) };
  }
  async write(name, text, sha, message) {
    const body = { message, content: b64encode(text), branch: this.branch };
    if (sha) body.sha = sha; // 楽観ロック: sha が古ければ 409
    const r = await this.req("PUT", `${this.dir}/${name}`, body);
    return r.content.sha;
  }
  async remove(name, sha, message) {
    await this.req("DELETE", `${this.dir}/${name}`, { message, sha, branch: this.branch });
  }
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------- frontmatter ----------
// 扱うのは「key: 値」と「key: |」+ 2スペース字下げのブロックスカラーだけ。YAML 全般は扱わない。
function emptyMeta() {
  const m = { title: "", status: "draft" };
  for (const k of FRAME_KEYS) m[k] = "";
  return m;
}
function parseDoc(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = emptyMeta();
  if (!m) return { meta, body: text };
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (raw === "|") {
      const buf = [];
      while (i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1] === "")) {
        buf.push(lines[++i].replace(/^  /, ""));
      }
      meta[key] = buf.join("\n").replace(/\n+$/, "");
    } else {
      meta[key] = raw.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
    }
  }
  for (const [k, olds] of Object.entries(LEGACY_MERGE)) {
    if (!meta[k]) meta[k] = olds.map((o) => meta[o]).filter(Boolean).join("\n\n");
    for (const o of olds) delete meta[o];
  }
  return { meta, body: text.slice(m[0].length) };
}
function buildDoc(meta, body) {
  const t = meta.title.replace(/"/g, '\\"');
  const out = [`title: "${t}"`, `status: ${meta.status || "draft"}`];
  for (const k of FRAME_KEYS) {
    const v = (meta[k] || "").trim();
    if (!v) continue;
    out.push(`${k}: |`, ...v.split("\n").map((l) => `  ${l}`));
  }
  return `---\n${out.join("\n")}\n---\n${body}`;
}

// ---------- Markdown → HTML（note 貼り付け用） ----------
const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });

// note のエディタが解釈できる要素に寄せる。表は未対応なので段落化はせず、そのまま出す（手修正前提）。
function toNoteHtml(body) {
  let html = md.render(body);
  html = html.replace(/<pre><code class="language-[^"]*">/g, "<pre><code>");
  return html;
}

// ---------- AI 用プロンプト ----------
function buildAiPrompt(meta, body, prompts) {
  const lines = [`# 記事の構想: ${meta.title || "(無題)"}`, ""];
  for (const f of FRAME) {
    const v = (meta[f.key] || "").trim() || "(未記入)";
    lines.push(`## ${f.section}（${f.label}）`, v, "");
  }
  const hasBody = body.trim().length > 0;
  if (hasBody) lines.push("## 現在の本文", "```markdown", body.trim(), "```", "");
  lines.push("---", hasBody ? prompts.body : prompts.empty);
  return lines.join("\n");
}

// ---------- UI 状態 ----------
const $ = (id) => document.getElementById(id);
const ui = {
  repoLabel: $("repoLabel"), status: $("status"), list: $("draftList"),
  title: $("titleInput"), statusSel: $("statusSelect"), editor: $("editor"), preview: $("preview"),
  frame: $("frame"), empty: $("empty"), frameFields: Object.fromEntries(FRAME_KEYS.map((k) => [k, document.querySelector(`[data-field="${k}"]`)])),
  btnSave: $("btnSave"), btnCopy: $("btnCopy"), btnCopyTitle: $("btnCopyTitle"), btnCopyAi: $("btnCopyAi"),
  btnPreview: $("btnTogglePreview"), btnFrame: $("btnToggleFrame"),
  btnDelete: $("btnDelete"), btnNew: $("btnNew"), btnRefresh: $("btnRefresh"),
  btnSettings: $("btnSettings"), dlg: $("settingsDialog"),
};

let repo = null;
let current = null; // { name, sha, meta, body }
let dirty = false;
let previewOn = false;
let frameOn = true;

function setStatus(msg, kind = "") {
  ui.status.textContent = msg;
  ui.status.className = `status ${kind}`;
  if (msg) setTimeout(() => { if (ui.status.textContent === msg) ui.status.textContent = ""; }, 4000);
}
function setDirty(v) {
  dirty = v;
  ui.btnSave.disabled = !v || !current;
  document.title = (v ? "● " : "") + (current?.meta.title || "note drafts");
}
function slugify(title) {
  const s = title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s || "untitled";
}
function todayPrefix() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 何も開いていないときは空状態、開いたら編集面を出す
function showWorkspace(open) {
  ui.empty.classList.toggle("hidden", open);
  ui.editor.classList.toggle("hidden", !open);
  ui.frame.classList.toggle("hidden", !open || !frameOn);
  ui.preview.classList.toggle("hidden", !open || !previewOn);
  for (const el of [ui.title, ui.statusSel, ui.btnCopy, ui.btnCopyTitle, ui.btnCopyAi, ui.btnDelete]) el.disabled = !open;
}

// UI ⇄ current の同期
function loadToUi(meta, body) {
  ui.title.value = meta.title;
  ui.statusSel.value = meta.status || "draft";
  ui.editor.value = body;
  for (const k of FRAME_KEYS) ui.frameFields[k].value = meta[k] || "";
  showWorkspace(!!current);
}
function readFromUi() {
  current.meta.title = ui.title.value.trim();
  current.meta.status = ui.statusSel.value;
  current.body = ui.editor.value;
  for (const k of FRAME_KEYS) current.meta[k] = ui.frameFields[k].value;
}
function clearUi() {
  current = null;
  loadToUi(emptyMeta(), "");
  setDirty(false);
  renderPreview();
}

// ---------- 操作 ----------
async function refreshList() {
  if (!repo) return;
  try {
    const items = await repo.list();
    items.sort((a, b) => b.name.localeCompare(a.name));
    ui.list.innerHTML = "";
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it.name.replace(/\.md$/, "");
      li.dataset.name = it.name;
      if (current?.name === it.name) li.classList.add("active");
      li.onclick = () => openDraft(it.name);
      ui.list.appendChild(li);
    }
  } catch (e) {
    setStatus(`一覧取得失敗: ${e.message}`, "err");
  }
}

async function openDraft(name) {
  if (dirty && !confirm("未保存の変更があります。破棄して開きますか？")) return;
  try {
    const f = await repo.read(name);
    if (!f) { setStatus("ファイルが見つかりません", "err"); return; }
    const { meta, body } = parseDoc(f.text);
    current = { name, sha: f.sha, meta, body };
    loadToUi(meta, body);
    setDirty(false);
    renderPreview();
    for (const li of ui.list.children) li.classList.toggle("active", li.dataset.name === name);
  } catch (e) {
    setStatus(`読込失敗: ${e.message}`, "err");
  }
}

function newDraft() {
  if (dirty && !confirm("未保存の変更があります。破棄しますか？")) return;
  current = { name: null, sha: null, meta: emptyMeta(), body: "" };
  loadToUi(current.meta, "");
  setDirty(true);
  renderPreview();
  for (const li of ui.list.children) li.classList.remove("active");
  ui.title.focus();
}

async function save() {
  if (!repo || !current) return;
  readFromUi();
  if (!current.name) current.name = `${todayPrefix()}-${slugify(current.meta.title)}.md`;
  const text = buildDoc(current.meta, current.body);
  ui.btnSave.disabled = true;
  try {
    current.sha = await repo.write(current.name, text, current.sha, `draft: ${current.meta.title || current.name}`);
    setDirty(false);
    setStatus("保存しました", "ok");
    await refreshList();
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      setStatus("競合: 別の場所で更新されています。再読込してから保存してください。", "err");
    } else {
      setStatus(`保存失敗: ${e.message}`, "err");
    }
    ui.btnSave.disabled = false;
  }
}

async function remove() {
  if (!current?.name) { clearUi(); return; }
  if (!confirm(`${current.name} を削除しますか？`)) return;
  try {
    await repo.remove(current.name, current.sha, `delete: ${current.name}`);
    clearUi();
    setStatus("削除しました", "ok");
    await refreshList();
  } catch (e) {
    setStatus(`削除失敗: ${e.message}`, "err");
  }
}

async function copyForNote() {
  const body = ui.editor.value;
  const html = toNoteHtml(body);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([body], { type: "text/plain" }),
      }),
    ]);
    setStatus("note 用 HTML をコピーしました。note の本文欄に貼り付けてください。", "ok");
  } catch (e) {
    await navigator.clipboard.writeText(body);
    setStatus(`HTML コピー不可のため Markdown をコピーしました (${e.message})`, "err");
  }
}

async function copyForAi() {
  if (!current) current = { name: null, sha: null, meta: emptyMeta(), body: "" };
  readFromUi();
  const c = cfg.load() || {};
  const prompt = buildAiPrompt(current.meta, current.body, {
    empty: c.promptEmpty || DEFAULT_PROMPT_EMPTY,
    body: c.promptBody || DEFAULT_PROMPT_BODY,
  });
  await navigator.clipboard.writeText(prompt);
  setStatus(current.body.trim() ? "構想＋本文をレビュー依頼としてコピーしました" : "構想を構成提案依頼としてコピーしました", "ok");
}

function renderPreview() {
  if (!previewOn) return;
  ui.preview.innerHTML = md.render(ui.editor.value);
}
function togglePreview() {
  previewOn = !previewOn;
  ui.btnPreview.classList.toggle("active", previewOn);
  showWorkspace(!!current);
  renderPreview();
}
function toggleFrame() {
  frameOn = !frameOn;
  ui.btnFrame.classList.toggle("active", frameOn);
  localStorage.setItem("note-drafts.frameOn", frameOn ? "1" : "0");
  showWorkspace(!!current);
}

// ---------- 設定ダイアログ ----------
function openSettings() {
  const c = cfg.load() || {};
  $("cfgOwner").value = c.owner || "";
  $("cfgRepo").value = c.repo || "";
  $("cfgBranch").value = c.branch || "main";
  $("cfgDir").value = c.dir || "drafts";
  $("cfgToken").value = c.token || "";
  $("cfgPromptEmpty").value = c.promptEmpty || DEFAULT_PROMPT_EMPTY;
  $("cfgPromptBody").value = c.promptBody || DEFAULT_PROMPT_BODY;
  ui.dlg.showModal();
}
async function applyConfig() {
  const c = cfg.load();
  if (!c?.token) { repo = null; ui.repoLabel.textContent = "未設定"; return; }
  repo = new GitHubRepo(c);
  ui.repoLabel.textContent = `${c.owner}/${c.repo}@${c.branch}/${c.dir}`;
  await refreshList();
}

// ---------- イベント ----------
ui.btnSettings.onclick = openSettings;
$("btnCfgCancel").onclick = () => ui.dlg.close();
ui.dlg.querySelector("form").onsubmit = (e) => {
  if (e.submitter?.value !== "ok") return;
  cfg.save({
    owner: $("cfgOwner").value.trim(), repo: $("cfgRepo").value.trim(),
    branch: $("cfgBranch").value.trim(), dir: $("cfgDir").value.trim(), token: $("cfgToken").value.trim(),
    promptEmpty: $("cfgPromptEmpty").value.trim(), promptBody: $("cfgPromptBody").value.trim(),
  });
  applyConfig();
};
ui.btnNew.onclick = newDraft;
ui.btnRefresh.onclick = refreshList;
ui.btnSave.onclick = save;
ui.btnDelete.onclick = remove;
ui.btnCopy.onclick = copyForNote;
ui.btnCopyAi.onclick = copyForAi;
ui.btnCopyTitle.onclick = async () => { await navigator.clipboard.writeText(ui.title.value); setStatus("タイトルをコピーしました", "ok"); };
ui.btnPreview.onclick = togglePreview;
ui.btnFrame.onclick = toggleFrame;

ui.editor.addEventListener("input", () => { setDirty(true); renderPreview(); });
ui.title.addEventListener("input", () => setDirty(true));
ui.statusSel.addEventListener("change", () => setDirty(true));
for (const k of FRAME_KEYS) ui.frameFields[k].addEventListener("input", () => setDirty(true));

// Tab でインデント、⌘S/Ctrl+S で保存
ui.editor.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en, value } = ui.editor;
    ui.editor.value = value.slice(0, s) + "  " + value.slice(en);
    ui.editor.selectionStart = ui.editor.selectionEnd = s + 2;
    setDirty(true);
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) save(); }
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- 起動 ----------
if (localStorage.getItem("note-drafts.frameOn") === "0") { frameOn = false; ui.btnFrame.classList.remove("active"); }
showWorkspace(false);
window.__noteDraftsReady = true;
applyConfig().then(() => { if (!repo) openSettings(); });
