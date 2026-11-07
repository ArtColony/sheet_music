// "View PostScript": a window that shows a score's PostScript program with
// line numbers, syntax colours and a scroll area, like pscat's gallery.
//
// A document from this engraver has two parts: the library (between
// %%BeginProlog and %%EndProlog: lib/sm_engrave.ps glyphs, lib/sm_abc.ps
// layout, the ABC parser ...) and the score: a short driver and the ABC
// source itself, which the library parses, lays out and draws when pscat runs
// the file. The window opens on
// the score; tabs switch to the library or the whole file, and clicking any
// sm- name jumps to its definition. Line numbers are always the line in the
// whole file.
//
// Used by the gallery (index.html: links with class "view-ps") and the editor
// (its "PS" view). Self-contained: it adds its own <dialog> and styles.

const STYLE = `
.psv { padding: 0; border: 1px solid var(--line, #ccc); border-radius: 10px; background: var(--bg, #fff); color: var(--ink, #111);
  width: min(1100px, calc(100vw - 32px)); max-width: none; height: min(88vh, 1000px); max-height: none; box-shadow: 0 12px 48px rgba(0,0,0,.35); }
.psv[open] { display: flex; flex-direction: column; }
.psv::backdrop { background: rgba(8, 10, 14, .66); }
html.psv-open { overflow: hidden; }
.psv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: 12px 16px; border-bottom: 1px solid var(--line, #ccc); background: var(--panel, #fafafa); }
.psv-title { flex: 1 1 260px; min-width: 0; }
.psv-name { margin: 0; font: 700 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--accent, #7a3e1d); overflow-wrap: anywhere; }
.psv-meta { margin: 2px 0 0; color: var(--muted, #666); font-size: 13px; }
.psv-actions { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.psv-actions a { color: var(--accent, #7a3e1d); }
.psv-actions button, .psv-tabs button { font: inherit; font-size: 13px; color: var(--ink, #111); background: var(--panel, #fff); border: 1px solid var(--line, #ccc); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.psv-tabs { display: flex; gap: 6px; flex: 1 0 100%; flex-wrap: wrap; align-items: center; }
.psv-tabs button[aria-pressed="true"] { background: var(--accent, #7a3e1d); color: var(--accent-ink, #fff); border-color: var(--accent, #7a3e1d); }
.psv-hint { color: var(--muted, #666); font-size: 12.5px; margin-left: 6px; }
.psv-body { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: flex-start; background: var(--code, #fbf8f1);
  font: 12.5px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace; tab-size: 2; overscroll-behavior: contain; }
.psv-body pre { margin: 0; padding: 12px 0; flex: none; font: inherit; background: transparent; border: 0; }
.psv-gutter { position: sticky; left: 0; z-index: 1; text-align: right; padding: 12px 10px 12px 14px !important; color: var(--muted, #888);
  background: var(--panel, #f4f4f4); border-right: 1px solid var(--line, #ddd); user-select: none; -webkit-user-select: none; }
.psv-code { padding: 12px 18px 12px 14px !important; white-space: pre; }
.psv-code .c { color: #7c7a72; font-style: italic; }
.psv-code .d { color: #8a6d1d; }
.psv-code .s { color: #2e7d32; }
.psv-code .n { color: #1f5fa8; }
.psv-code .l { color: #8b3a8f; }
.psv-code .sm { color: var(--accent, #7a3e1d); font-weight: 600; cursor: pointer; text-decoration: underline dotted 1px; text-underline-offset: 3px; }
.psv-code .sm:hover { text-decoration-style: solid; }
.psv-code .def { background: rgba(224, 161, 111, .25); border-radius: 3px; }
.psv-code .flash { animation: psv-flash 1.6s ease-out; }
@keyframes psv-flash { from { background: rgba(255, 196, 0, .55); } to { background: transparent; } }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .psv-code .c { color: #9a968c; } :root:not([data-theme="light"]) .psv-code .d { color: #d8b45a; }
  :root:not([data-theme="light"]) .psv-code .s { color: #8fd18f; } :root:not([data-theme="light"]) .psv-code .n { color: #8ab8f0; } :root:not([data-theme="light"]) .psv-code .l { color: #d39bd6; } }
:root[data-theme="dark"] .psv-code .c { color: #9a968c; } :root[data-theme="dark"] .psv-code .d { color: #d8b45a; } :root[data-theme="dark"] .psv-code .s { color: #8fd18f; }
:root[data-theme="dark"] .psv-code .n { color: #8ab8f0; } :root[data-theme="dark"] .psv-code .l { color: #d39bd6; }
@media (max-width: 700px) { .psv { width: 100vw; height: 100dvh; border-radius: 0; border: 0; } }
`;

const esc = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/** One line of PostScript -> HTML with token classes. */
export function highlight(line) {
  if (/^%%|^%!/.test(line)) return `<span class="d">${esc(line)}</span>`;
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === '%') { out += `<span class="c">${esc(line.slice(i))}</span>`; break; }
    if (ch === '(') { // string, with nesting and escapes
      let depth = 0, j = i;
      for (; j < n; j++) {
        if (line[j] === '\\') { j++; continue; }
        if (line[j] === '(') depth++;
        else if (line[j] === ')' && --depth === 0) break;
      }
      out += `<span class="s">${esc(line.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }
    const m = /^(\/?)([^\s()<>[\]{}/%]+)/.exec(line.slice(i));
    if (m) {
      const [tok, slash, word] = m;
      if (/^sm-[\w-]+$/.test(word)) out += `<span class="sm${slash ? ' l' : ''}" data-sm="${esc(word)}">${esc(tok)}</span>`;
      else if (slash) out += `<span class="l">${esc(tok)}</span>`;
      else if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(word)) out += `<span class="n">${esc(tok)}</span>`;
      else out += esc(tok);
      i += tok.length; continue;
    }
    out += esc(ch); i++;
  }
  return out;
}

/** Split an engraver document into its views. */
function viewsOf(text) {
  const lines = text.replace(/\n$/, '').split('\n');
  const a = lines.indexOf('%%BeginProlog'), b = lines.indexOf('%%EndProlog');
  if (a < 0 || b < a) return [{ id: 'all', label: 'Whole file', from: 0, to: lines.length, lines }];
  return [
    { id: 'score', label: 'Score program', from: b + 1, to: lines.length, lines },
    { id: 'lib', label: `Library (${b - a - 1} lines)`, from: a + 1, to: b, lines },
    { id: 'all', label: 'Whole file', from: 0, to: lines.length, lines },
  ];
}

let dialog, els, state = null, opener = null;

function build() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  dialog = document.createElement('dialog');
  dialog.className = 'psv';
  dialog.setAttribute('aria-labelledby', 'psv-name');
  dialog.innerHTML = `
    <div class="psv-head">
      <div class="psv-title"><p class="psv-name" id="psv-name"></p><p class="psv-meta"></p></div>
      <div class="psv-actions"><a class="psv-raw" target="_blank" rel="noopener">Raw file</a><a class="psv-lib" href="https://github.com/ArtColony/sheet_music/tree/main/lib" target="_blank" rel="noopener">Library on GitHub</a><button type="button" class="psv-close">Close</button></div>
      <div class="psv-tabs" role="group" aria-label="Part of the file"></div>
    </div>
    <div class="psv-body" tabindex="0" role="region" aria-label="PostScript source"><pre class="psv-gutter" aria-hidden="true"></pre><pre class="psv-code"><code></code></pre></div>`;
  document.body.append(dialog);
  els = {
    name: dialog.querySelector('.psv-name'), meta: dialog.querySelector('.psv-meta'), raw: dialog.querySelector('.psv-raw'),
    tabs: dialog.querySelector('.psv-tabs'), body: dialog.querySelector('.psv-body'),
    gutter: dialog.querySelector('.psv-gutter'), code: dialog.querySelector('.psv-code code'),
  };
  dialog.querySelector('.psv-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('psv-open');
    if (els.raw.dataset.blob) { URL.revokeObjectURL(els.raw.href); delete els.raw.dataset.blob; }
    if (opener && opener.focus) opener.focus();
  });
  els.tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });
  els.code.addEventListener('click', (e) => { const s = e.target.closest('[data-sm]'); if (s) jumpTo(s.dataset.sm); });
}

function show(id, line) {
  const v = state.views.find((x) => x.id === id) || state.views[0];
  state.view = v.id;
  for (const b of els.tabs.querySelectorAll('button[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v.id));
  const nums = [], html = [];
  for (let k = v.from; k < v.to; k++) {
    nums.push(k + 1);
    const def = /^\/(sm-[\w-]+)\s/.exec(v.lines[k]);
    html.push(def ? `<span class="def" id="psv-def-${def[1]}">${highlight(v.lines[k])}</span>` : highlight(v.lines[k]));
  }
  els.gutter.textContent = nums.join('\n');
  els.code.innerHTML = html.join('\n');
  els.body.scrollTop = 0; els.body.scrollLeft = 0;
  if (line !== undefined) {
    const lh = parseFloat(getComputedStyle(els.body).lineHeight) || 19;
    els.body.scrollTop = Math.max(0, (line - v.from) * lh - 60);
  }
}

function jumpTo(name) {
  const lib = state.views.find((v) => v.id === 'lib') || state.views.find((v) => v.id === 'all');
  const k = lib.lines.findIndex((l, i) => i >= lib.from && i < lib.to && l.startsWith('/' + name + ' '));
  if (k < 0) return;
  show(lib.id, k);
  const el = els.code.querySelector(`#psv-def-${CSS.escape ? CSS.escape(name) : name}`);
  if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1700); }
}

/**
 * Open the window. { name, text, meta?, raw? (URL of the file) }. The text is
 * an engraver document (or any PostScript).
 */
export function openPostScript({ name, text, meta, raw, download }) {
  if (!dialog) build();
  opener = document.activeElement;
  const views = viewsOf(text);
  state = { views, view: views[0].id };
  const lines = views[0].lines.length;
  const v0 = views[0];
  const calls = v0.lines.slice(v0.from, v0.to).filter((l) => /\ssm-[\w-]+\s*$/.test(l)).length;
  els.name.textContent = name;
  const selfEngraving = v0.lines.slice(v0.from, v0.to).some((l) => /\bsm-abc-readsrc\b/.test(l));
  const what = views.length < 2 ? '' : selfEngraving ? ' · the source is embedded; the library engraves it as pscat runs the file' : ` · ${calls} drawing calls into the glyph library`;
  els.meta.textContent = meta || `${lines} lines · ${(new Blob([text]).size / 1024).toFixed(1)} KB${what}`;
  if (raw) els.raw.href = raw;
  else { els.raw.href = URL.createObjectURL(new Blob([text], { type: download ? 'application/postscript' : 'text/plain' })); els.raw.dataset.blob = '1'; }
  if (download) { els.raw.download = name; els.raw.textContent = 'Download'; els.raw.removeAttribute('target'); }
  else { els.raw.removeAttribute('download'); els.raw.textContent = 'Raw file'; els.raw.target = '_blank'; }
  els.tabs.innerHTML = views.length > 1
    ? views.map((v) => `<button type="button" data-view="${v.id}">${esc(v.label)}</button>`).join('') + '<span class="psv-hint">Click any <b>sm-</b> name to jump to its definition in the library.</span>'
    : '';
  show(views[0].id);
  document.documentElement.classList.add('psv-open');
  dialog.showModal();
  els.body.focus();
}

// Gallery pages: links with class "view-ps" open their href in the window.
export function wireLinks(root = document) {
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('a.view-ps');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || typeof HTMLDialogElement !== 'function') return;
    e.preventDefault();
    try {
      const text = await (await fetch(a.href)).text();
      openPostScript({ name: a.dataset.name || a.getAttribute('href').split('/').pop(), text, raw: a.href });
    } catch { location.href = a.href; }
  });
}
