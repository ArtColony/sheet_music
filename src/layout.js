// Score -> PostScript page descriptions that call lib/sm_engrave.ps.
//
// The layout is entirely here, in plain arithmetic on exact rationals and
// fixed-precision numbers, so it is deterministic: the same score and options
// always give the same PostScript bytes, in Node or in a browser.
//
// Units: "sp" is one staff space (options.sp points). Vertical positions in a
// staff are "pos" = staff steps from the centre line (a line or a space each
// step), so y = centre + pos * sp / 2.
import { F, add, sub, cmp, val, key as fkey, ZERO } from './frac.js';
import { num, nums, text as pstext, approxWidth } from './ps.js';

export const PAPERS = { letter: [612, 792], a4: [595.28, 841.89] };
const STEPS = 'CDEFGAB';
const HW = 0.615; // half width of a black/half notehead (sp)
const HWW = 0.82; // whole note
const STEM_W = 0.12;
const ACC_W = { sharp: 1.15, flat: 0.95, natural: 0.75, dsharp: 0.95, dflat: 1.75 };
const ACC_PROC = { sharp: 'sm-acc-sharp', flat: 'sm-acc-flat', natural: 'sm-acc-natural', dsharp: 'sm-acc-dsharp', dflat: 'sm-acc-dflat' };
const KEY_SHARPS = [4, 1, 5, 2, -1, 3, 0];
const KEY_FLATS = [0, 3, -1, 2, -2, 1, -3];
const ABOVE_DECOS = new Set(['fermata', 'trill', 'roll', 'uppermordent', 'lowermordent', 'upbow', 'downbow', 'segno', 'coda', 'breath']);
const HEAD_DECOS = { staccato: 'sm-art-staccato', tenuto: 'sm-art-tenuto', accent: 'sm-art-accent', marcato: 'sm-art-marcato' };

const clefMid = (c) => {
  const signD = { G: 4 * 7 + 4, F: 3 * 7 + 3, C: 4 * 7 + 0 }[c.sign];
  return signD + (3 - c.line) * 2 + (c.octave || 0) * 7;
};
const posOf = (n, clef) => n.oct * 7 + STEPS.indexOf(n.step) - clefMid(clef);
const keyOffset = (clef) => { let o = 34 - clefMid(clef); o -= 7 * Math.round(o / 7); return o; };
const beamsOf = (type) => Math.max(0, Math.round(-Math.log2(val(type))) - 2);
const spaceFor = (t) => 1.0 + 1.45 * Math.log2(1 + 16 * val(t));

export function engrave(score, options = {}) {
  const o = { paper: 'letter', sp: 5.5, margin: 50, top: 46, bottom: 44, breaks: 'source', footer: '', ...options };
  const [PW, PH] = PAPERS[o.paper] || PAPERS.letter;
  const sp = o.sp;
  const warnings = [];
  const S = score.staves.length;
  const left = o.margin;
  const right = PW - o.margin;
  const multi = S > 1;

  // ------------------------------------------------------------ state per measure
  // key / time / clefs in force at each measure, and whether each changes there
  let keyNow = score.initial.key;
  let timeNow = score.initial.time;
  const clefNow = score.staves.map((s) => s.clef);
  const ms = score.measures;
  ms.forEach((m, i) => {
    m._prevKey = keyNow;
    if (m.key && i > 0 && m.key.fifths !== keyNow.fifths) { m._keyChange = true; keyNow = m.key; }
    else if (m.key && i === 0) keyNow = m.key;
    if (m.time && i > 0 && (m.time.num !== timeNow.num || m.time.den !== timeNow.den || m.time.symbol !== timeNow.symbol)) { m._timeChange = true; timeNow = m.time; }
    else if (m.time && i === 0) timeNow = m.time;
    m._clefChange = [];
    for (let s = 0; s < S; s++) {
      const c = m.clefs && m.clefs[s];
      if (c && (c.sign !== clefNow[s].sign || c.line !== clefNow[s].line || (c.octave || 0) !== (clefNow[s].octave || 0))) {
        if (i > 0) m._clefChange[s] = c;
        clefNow[s] = c;
      }
    }
    m._key = keyNow; m._time = timeNow; m._clef = clefNow.slice();
  });
  if (ms.length && ms[0].clefs) ms[0].clefs.forEach((c, s) => { if (c) score.staves[s].clef = c; });

  // ------------------------------------------------------------ event geometry
  for (const m of ms) {
    for (let s = 0; s < S; s++) {
      const evs = m.staves[s].events;
      let t = ZERO;
      for (const e of evs) {
        e._g = { onset: t, staff: s, m };
        t = add(t, e.dur);
        if (e.kind === 'note') {
          e._g.heads = e.notes.map((n) => ({ pos: posOf(n, m._clef[s]), note: n, dx: 0 })).sort((a, b) => a.pos - b.pos);
        }
      }
      m.staves[s]._len = t;
      beamGroups(evs);
      for (const e of evs) noteShape(e);
    }
  }

  function beamGroups(evs) {
    let group = [];
    const flush = () => {
      if (group.length >= 2) {
        const all = group.flatMap((e) => e._g.heads.map((h) => h.pos));
        const dir = Math.max(...all) + Math.min(...all) >= 0 ? -1 : 1;
        const g = { events: group, dir };
        for (const e of group) { e._g.beam = g; e._g.dir = dir; }
      }
      group = [];
    };
    for (const e of evs) {
      const beamable = e.kind === 'note' && beamsOf(e.type) > 0;
      if (!beamable) { flush(); continue; }
      if (!e.beam || !group.length) flush();
      group.push(e);
    }
    flush();
  }

  function noteShape(e) {
    const g = e._g;
    if (e.kind !== 'note') {
      const rt = e.rest && e.rest.measure ? 'measure' : restType(e.type);
      g.restType = rt;
      const hw = { measure: 0.62, whole: 0.62, half: 0.62, quarter: 0.5, 1: 0.55, 2: 0.65, 3: 0.75 }[rt] || 0.6;
      g.left = hw; g.right = hw + (e.dots ? 0.5 + 0.45 * e.dots : 0);
      return;
    }
    const heads = g.heads;
    const hasStem = val(e.type) < 1;
    if (g.dir === undefined) {
      const hi = heads[heads.length - 1].pos; const lo = heads[0].pos;
      g.dir = hi + lo >= 0 ? -1 : 1;
    }
    g.stem = hasStem;
    g.hw = val(e.type) >= 1 ? HWW : HW;
    const off = 2 * g.hw - STEM_W;
    if (g.dir === 1 || !hasStem) {
      let prev = null;
      for (const h of heads) { if (prev && h.pos - prev.pos === 1 && prev.dx === 0) h.dx = off; prev = h; }
    } else {
      let prev = null;
      for (let i = heads.length - 1; i >= 0; i--) { const h = heads[i]; if (prev && prev.pos - h.pos === 1 && prev.dx === 0) h.dx = -off; prev = h; }
    }
    const minDx = Math.min(...heads.map((h) => h.dx));
    const maxDx = Math.max(...heads.map((h) => h.dx));
    // accidentals: columns from the head outwards, top to bottom
    const accs = heads.filter((h) => h.note.acc).sort((a, b) => b.pos - a.pos);
    const cols = [];
    for (const h of accs) {
      let c = 0;
      while (cols[c] && cols[c].some((o) => Math.abs(o.pos - h.pos) < 6)) c++;
      (cols[c] = cols[c] || []).push(h);
    }
    let x = minDx - g.hw - 0.22;
    g.accs = [];
    for (const col of cols) {
      const w = Math.max(...col.map((h) => ACC_W[h.note.acc] || 1));
      for (const h of col) g.accs.push({ pos: h.pos, type: h.note.acc, dx: x - w / 2 + (h.note.acc === 'flat' ? -0.05 : 0) });
      x -= w + 0.12;
    }
    g.left = -x;
    g.flags = !g.beam && hasStem ? beamsOf(e.type) : 0;
    g.right = maxDx + g.hw + (e.dots ? 0.45 + 0.45 * e.dots : 0) + (g.flags && g.dir === 1 ? 1.0 : 0);
    if (e.grace) {
      const n = e.grace.notes.length;
      g.graceW = n * 1.25 + 0.9 + (e.grace.notes.some((q) => q.acc) ? 0.7 : 0);
      g.left += g.graceW;
    }
    // unbeamed stems are final now; beamed ones are set per system
    if (hasStem && !g.beam) {
      const lvl = beamsOf(e.type);
      const extra = lvl >= 3 ? 1.25 : lvl === 2 ? 0.5 : 0;
      if (g.dir === 1) g.tip = Math.max(heads[heads.length - 1].pos / 2 + 3.5 + extra, 0);
      else g.tip = Math.min(heads[0].pos / 2 - 3.5 - extra, 0);
    }
  }
  function restType(t) {
    const v = val(t);
    if (v >= 1) return 'whole';
    if (v >= 0.5) return 'half';
    if (v >= 0.25) return 'quarter';
    return beamsOf(t); // 1, 2, 3
  }

  // ------------------------------------------------------------ horizontal: measure columns
  const LYR = 10.5; // lyric size (pt)
  const CHS = 11; // chord symbol size (pt)
  for (const m of ms) {
    const map = new Map();
    for (let s = 0; s < S; s++) {
      for (const e of m.staves[s].events) {
        const k = fkey(e._g.onset);
        if (!map.has(k)) map.set(k, { t: e._g.onset, entries: [] });
        map.get(k).entries.push(e);
      }
    }
    const cols = [...map.values()].sort((a, b) => cmp(a.t, b.t));
    const total = m.staves.reduce((a, st) => (cmp(st._len, a) > 0 ? st._len : a), ZERO);
    cols.forEach((c, i) => {
      c.left = Math.max(...c.entries.map((e) => e._g.left || 0.6));
      c.right = Math.max(...c.entries.map((e) => e._g.right || 0.6));
      const next = i + 1 < cols.length ? cols[i + 1].t : total;
      c.ideal = spaceFor(sub(next, c.t));
      c.lyr = []; // half width of each verse's syllable, sp
      c.chordW = 0;
      for (const e of c.entries) {
        if (e.lyrics) e.lyrics.forEach((l, v) => { if (l) c.lyr[v] = Math.max(c.lyr[v] || 0, approxWidth(l.text, LYR) / 2 / sp + (l.hyphen ? 0.6 : 0)); });
        if (e.chord) c.chordW = Math.max(c.chordW, approxWidth(e.chord, CHS) / sp + 0.9);
        if (e.annot) for (const a of e.annot) if (a.pos === 'above' || a.pos === 'below') c.chordW = Math.max(c.chordW, approxWidth(a.text, 10) / sp + 0.6);
        if (e.dyn) c.chordW = Math.max(c.chordW, approxWidth(e.dyn, 12.5, true) / sp + 0.4);
      }
      if (c.entries.some((e) => e.rest && e.rest.measure)) { c.ideal = Math.max(c.ideal, m.mmCount > 1 ? 10 : 7); c.isMeasureRest = true; }
    });
    // minimum gaps between neighbouring columns (collisions, lyrics, chords)
    cols.forEach((c, i) => {
      const nx = cols[i + 1];
      c.min = c.right + (nx ? nx.left : 0.4) + 0.5;
    });
    const fixPair = (i, j, need) => {
      if (j >= cols.length) return;
      let have = 0;
      for (let k = i; k < j; k++) have += cols[k].min; // gaps never shrink below min
      if (have < need) cols[j - 1].min += need - have;
    };
    cols.forEach((c, i) => {
      c.lyr.forEach((w, v) => {
        if (!w) return;
        const j = cols.findIndex((d, k) => k > i && d.lyr[v]);
        if (j > 0) fixPair(i, j, w + cols[j].lyr[v] + 0.9);
        else c.min = Math.max(c.min, w + 0.3 - 0); // last syllable in the bar must clear the bar line
      });
      if (c.chordW) {
        const j = cols.findIndex((d, k) => k > i && d.chordW);
        if (j > 0) fixPair(i, j, c.chordW);
        else c.min = Math.max(c.min, c.chordW - 0.5);
      }
    });
    m._cols = cols;
    m._total = total;
    // fixed space at the measure start
    let pre = 1.1;
    if (m.startRepeat) pre += 1.6;
    // a long first syllable must not run back over the bar line
    const lyr0 = Math.max(0, ...cols[0].lyr.filter(Boolean));
    pre = Math.max(pre, lyr0 + 0.3 - cols[0].left);
    m._prefixChange = 0;
    if (m._clefChange.some(Boolean)) m._prefixChange += 3.2;
    if (m._keyChange) m._prefixChange += Math.max(Math.abs(m._key.fifths), m._key.fifths === 0 ? Math.abs(m._prevKey.fifths) : 0) * 1.0 + 1.0;
    if (m._timeChange) m._prefixChange += timeWidth(m._time) + 0.8;
    m._pre = pre + m._prefixChange;
    m._barW = { single: 0.08, double: 0.7, final: 1.0, 'thick-thin': 0.9, 'repeat-end': 1.9 }[m.endBar] || 0.1;
  }
  function timeWidth(t) {
    if (!t || t.symbol === 'none' || t.symbol === 'none-given' || !t.num) return 0;
    if (t.symbol === 'common' || t.symbol === 'cut') return 2.0;
    return Math.max(String(t.text || t.num).length, String(t.den).length) * 1.6 + 0.5;
  }
  const mWidth = (m, f) => m._pre + m._cols[0].left + m._cols.reduce((a, c) => a + Math.max(c.min, c.ideal * f), 0) + m._barW;

  // header width of a system starting at measure i (sp)
  function headerW(i) {
    const m = ms[i];
    let w = 0.8 + 2.9 + 0.7; // clef
    w += Math.abs(m._key.fifths) * 1.0 + (m._key.fifths ? 0.8 : 0);
    if (i === 0 || m._timeChange) w += timeWidth(m._time) + 0.8;
    return w;
  }
  const indent = multi && score.staves.some((s) => s.name) ? Math.max(...score.staves.map((s) => approxWidth(s.name || '', 10))) / sp + 1.5 : 0;
  const avail = (right - left) / sp;
  const avail0 = avail - indent;
  // A measure's own key/time/clef change at a system start moves into the header.
  const mWidthAt = (m, f, first) => mWidth(m, f) - (first ? m._prefixChange : 0);

  // ------------------------------------------------------------ line breaking
  const systems = [];
  {
    // Source mode keeps the input's line breaks (ABC line ends, MusicXML
    // new-system), splitting a line into balanced parts only when it cannot
    // fit even compressed to 75% of its ideal spacing. Auto mode fills lines.
    const hasBreaks = o.breaks !== 'auto' && ms.slice(0, -1).some((m) => m.lineBreak);
    const room = () => (systems.length === 0 ? avail0 : avail);
    const lineW = (seg, f) => headerW(seg[0]) + seg.reduce((a, i, k) => a + mWidthAt(ms[i], f, k === 0), 0);
    if (hasBreaks) {
      let seg = [];
      const emit = () => {
        if (!seg.length) return;
        const r = room();
        if (lineW(seg, 0.75) <= r) { systems.push(seg); seg = []; return; }
        const k = Math.ceil(lineW(seg, 0.9) / r);
        const per = seg.length / k;
        for (let p = 0; p < k; p++) {
          const part = seg.slice(Math.round(p * per), Math.round((p + 1) * per));
          if (part.length) systems.push(part);
        }
        seg = [];
      };
      ms.forEach((m, i) => { seg.push(i); if (m.lineBreak) emit(); });
      emit();
    } else {
      let cur = [];
      for (let i = 0; i < ms.length; i++) {
        if (cur.length && lineW([...cur, i], 1) > room()) { systems.push(cur); cur = []; }
        cur.push(i);
      }
      if (cur.length) systems.push(cur);
    }
  }

  // ------------------------------------------------------------ justify and place horizontally
  const sysInfo = systems.map((idx, si) => {
    const x0 = left + (si === 0 ? indent * sp : 0);
    const room = si === 0 ? avail0 : avail;
    const hdr = headerW(idx[0]);
    const natural = (f) => hdr + idx.reduce((a, i, k) => a + mWidthAt(ms[i], f, k === 0), 0);
    let f = 1;
    let width = room;
    const last = si === systems.length - 1;
    if (last && natural(1) < room * 0.72 && systems.length > 1) { f = 1.15; width = natural(f); }
    else if (last && systems.length === 1 && natural(1) < room * 0.6) { f = 1.2; width = Math.min(room, natural(f)); }
    else {
      let lo = 0.3, hi = 12;
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (natural(mid) > room) hi = mid; else lo = mid; }
      f = lo;
      if (natural(f) > room + 0.01) warnings.push(`system ${si + 1} is too crowded to fit the page width`);
    }
    // place
    let x = x0 + hdr * sp;
    for (const [k, i] of idx.entries()) {
      const m = ms[i];
      m._sys = si;
      m._x0 = x;
      let cx = x + (m._pre - (k === 0 ? m._prefixChange : 0) + m._cols[0].left) * sp;
      m._changeX = x + (m.startRepeat ? 2.4 : 0.9) * sp;
      for (const c of m._cols) {
        c.x = cx;
        cx += Math.max(c.min, c.ideal * f) * sp;
      }
      m._x1 = cx + m._barW * sp - (m._barW > 0.1 ? 0 : 0);
      for (const c of m._cols) for (const e of c.entries) e._g.x = c.x;
      // a whole-measure rest sits in the middle of the measure
      for (const c of m._cols) if (c.isMeasureRest) for (const e of c.entries) if (e.rest && e.rest.measure) e._g.x = (m._x0 + m._x1) / 2 + (m.startRepeat ? sp : 0);
      x = m._x1;
    }
    return { idx, x0, x1: x, hdr, f };
  });

  // ------------------------------------------------------------ beams (need x)
  for (const m of ms) for (let s = 0; s < S; s++) {
    const seen = new Set();
    for (const e of m.staves[s].events) {
      const b = e._g.beam;
      if (!b || seen.has(b)) continue;
      seen.add(b);
      layoutBeam(b);
    }
  }
  function layoutBeam(b) {
    const E = b.events;
    const dir = b.dir;
    const xs = E.map((e) => stemX(e) / sp);
    const ref = E.map((e) => (dir === 1 ? e._g.heads[e._g.heads.length - 1].pos : e._g.heads[0].pos) / 2);
    const lv = E.map((e) => beamsOf(e.type));
    let rise = ref[ref.length - 1] - ref[0];
    rise = Math.max(-1, Math.min(1, rise));
    const interior = ref.slice(1, -1);
    if (interior.length && (dir === 1 ? interior.some((r) => r > Math.max(ref[0], ref[ref.length - 1])) : interior.some((r) => r < Math.min(ref[0], ref[ref.length - 1])))) rise = 0;
    const dx = xs[xs.length - 1] - xs[0];
    const slope = dx > 0 ? rise / dx * 0.6 : 0;
    let base;
    if (dir === 1) {
      base = Math.max(...E.map((e, i) => ref[i] + 3.25 + 0.75 * (lv[i] - 1) - slope * (xs[i] - xs[0])));
      base = Math.max(base, ...xs.map((x) => 0 - slope * (x - xs[0])));
    } else {
      base = Math.min(...E.map((e, i) => ref[i] - 3.25 - 0.75 * (lv[i] - 1) - slope * (xs[i] - xs[0])));
      base = Math.min(base, ...xs.map((x) => 0 - slope * (x - xs[0])));
    }
    E.forEach((e, i) => { e._g.tip = base + slope * (xs[i] - xs[0]); });
    b.slope = slope; b.base = base; b.x0 = xs[0]; b.levels = lv;
  }
  function stemX(e) {
    const g = e._g;
    return g.dir === 1 ? g.x + (g.hw - STEM_W / 2) * sp : g.x - (g.hw - STEM_W / 2) * sp;
  }

  // ------------------------------------------------------------ vertical extents per system and staff
  const sysV = systems.map((idx, si) => {
    const st = [];
    for (let s = 0; s < S; s++) {
      let top = 2.6, bot = -2.6;
      let chords = false, annAbove = false, dyn = false, verses = 0, decoTop = 2.6;
      for (const i of idx) for (const e of ms[i].staves[s].events) {
        const g = e._g;
        if (e.kind === 'note') {
          const hi = g.heads[g.heads.length - 1].pos / 2 + 0.6; const lo = g.heads[0].pos / 2 - 0.6;
          top = Math.max(top, hi, g.stem && g.dir === 1 ? g.tip + 0.3 : -99);
          bot = Math.min(bot, lo, g.stem && g.dir === -1 ? g.tip - 0.3 : 99);
        }
        if (e.decos && e.decos.some((d) => ABOVE_DECOS.has(d))) decoTop = Math.max(decoTop, top);
        if (e.tuplet) { if (g.dir === -1) bot = Math.min(bot, (g.tip ?? 0) - 2.2); else top = Math.max(top, (g.tip ?? 0) + 2.2); }
        if (e.chord) chords = true;
        if (e.annot && e.annot.some((a) => a.pos === 'above')) annAbove = true;
        if (e.dyn || e.hairpinStart || (e.annot && e.annot.some((a) => a.pos === 'below'))) dyn = true;
        if (e.lyrics) verses = Math.max(verses, e.lyrics.length);
      }
      // above-staff decorations sit over everything else in that event
      top = Math.max(top, decoTop) + (idx.some((i) => ms[i].staves[s].events.some((e) => e.decos && e.decos.some((d) => ABOVE_DECOS.has(d)))) ? 2.2 : 0);
      const v = { top, bot };
      if (chords) { v.chordY = top + 0.9; top = v.chordY + 2.2; }
      if (annAbove) { v.annotY = top + 0.6; top = v.annotY + 2.0; }
      if (s === 0) {
        if (idx.some((i) => ms[i].ending)) { v.voltaY = top + 2.0; top = v.voltaY + 0.5; }
        if (idx.some((i) => ms[i].part)) { v.partY = top + 0.8; top = v.partY + 2.4; }
        if (si === 0 && score.tempo) { v.tempoY = top + 1.4; top = v.tempoY + 2.4; }
        if (si > 0) top = Math.max(top, 4.6);
      }
      if (dyn) { v.dynY = bot - 2.4; bot = v.dynY - 0.9; }
      v.lyricY = [];
      for (let k = 0; k < verses; k++) { v.lyricY.push(bot - 2.2 - k * 2.5); }
      if (verses) bot = v.lyricY[verses - 1] - 0.9;
      v.top = top; v.bot = bot;
      st.push(v);
    }
    // staff centres relative to the system top (sp, downward positive)
    let y = st[0].top;
    st[0].c = y;
    for (let s = 1; s < S; s++) {
      y += Math.max(-st[s - 1].bot + st[s].top + 1.2, 9.5);
      st[s].c = y;
    }
    return { staves: st, height: y - st[S - 1].bot };
  });

  // ------------------------------------------------------------ pages
  const pages = [[]];
  const pageOf = [];
  const meta = score.meta;
  let y = PH - o.top;
  const titleLines = [];
  {
    let ty = y;
    if (meta.title) { ty -= 20; titleLines.push(`${num(PW / 2)} ${num(ty)} ${pstext(meta.title, 20)} /Times-Bold 20 sm-text-c`); ty -= 6; }
    for (const st of meta.subtitles) { ty -= 14; titleLines.push(`${num(PW / 2)} ${num(ty)} ${pstext(st, 13)} /Times-Roman 13 sm-text-c`); ty -= 2; }
    const right1 = meta.composer || meta.origin;
    const right2 = meta.composer && meta.origin ? meta.origin : '';
    if (right1 || meta.rhythm) {
      ty -= 16;
      if (right1) titleLines.push(`${num(right)} ${num(ty)} ${pstext(right1, 11)} /Times-Italic 11 sm-text-r`);
      if (meta.rhythm) titleLines.push(`${num(left)} ${num(ty)} ${pstext(meta.rhythm, 11)} /Times-Italic 11 sm-text-l`);
      if (right2) { ty -= 13; titleLines.push(`${num(right)} ${num(ty)} ${pstext(right2, 11)} /Times-Italic 11 sm-text-r`); }
    }
    y = ty - (titleLines.length ? 14 : 0);
  }
  pages[0].push(...titleLines);
  const bottomY = o.bottom + 14;
  const sysTop = [];
  sysV.forEach((v, si) => {
    const h = v.height * sp;
    if (y - h < bottomY && pages[pages.length - 1].length > (pages.length === 1 ? titleLines.length : 0)) {
      pages.push([]);
      y = PH - o.top;
    }
    sysTop[si] = y;
    pageOf[si] = pages.length - 1;
    y -= h + 3.2 * sp;
  });
  const staffY = (si, s) => sysTop[si] - sysV[si].staves[s].c * sp;

  // ------------------------------------------------------------ drawing
  const out = (si, line) => pages[pageOf[si]].push(line);
  const Y = (si, s, pos) => staffY(si, s) + pos * sp / 2;

  sysInfo.forEach((info, si) => {
    const { idx, x0, x1 } = info;
    const P = (l) => out(si, l);
    const topY = staffY(si, 0) + 2 * sp;
    const botY = staffY(si, S - 1) - 2 * sp;
    for (let s = 0; s < S; s++) P(`${nums(x0, staffY(si, s), x1 - x0)} sm-staff`);
    if (multi) {
      P(`${nums(x0, topY, botY)} sm-bar-thin`);
      if (score.group === 'brace') P(`${nums(x0 - 0.5 * sp, topY, botY)} sm-brace`);
      else P(`${nums(x0 - 0.3 * sp, topY + 0.1 * sp, botY - 0.1 * sp)} sm-bracket`);
    }
    if (si === 0 && indent) score.staves.forEach((st, s) => { if (st.name) P(`${nums(x0 - 1.2 * sp, staffY(si, s) - 3)} ${pstext(st.name, 10)} /Times-Roman 10 sm-text-r`); });
    // header: clef, key, time
    const m0 = ms[idx[0]];
    for (let s = 0; s < S; s++) {
      let x = x0 + 0.8 * sp;
      clefAt(P, x, si, s, m0._clef[s]);
      x += 3.6 * sp;
      x = keyAt(P, x, si, s, m0._key.fifths, m0._clef[s], 0);
      if (idx[0] === 0 || m0._timeChange) timeAt(P, x + (timeWidth(m0._time) / 2) * sp, si, s, m0._time);
    }
    // measure numbers at the start of every system after the first
    if (si > 0 || m0.pickup === false) {
      const n = m0.number;
      if (si > 0 && n > 0) P(`${nums(x0 + (multi ? 0.6 : 0.2) * sp, staffY(si, 0) + 3.6 * sp)} (${n}) /Times-Italic 8.5 sm-text-l`);
    }
    for (const [k, i] of idx.entries()) drawMeasure(P, si, ms[i], k === 0, i);
    // a final system narrower than the page still ends with its bar line
  });

  function clefAt(P, x, si, s, clef, small) {
    const c = staffY(si, s);
    if (clef.sign === 'G') P(`${nums(x, c - sp)} ${clef.octave === -1 ? 'sm-clef-treble8' : 'sm-clef-treble'}`);
    else if (clef.sign === 'F') P(`${nums(x, c + sp)} sm-clef-bass`);
    else P(`${nums(x, c + (clef.line - 3) * sp)} sm-clef-alto`);
  }
  function keyAt(P, x, si, s, fifths, clef, cancel) {
    const off = keyOffset(clef);
    const c = staffY(si, s);
    if (cancel) {
      const n = Math.abs(cancel);
      const list = cancel > 0 ? KEY_SHARPS : KEY_FLATS;
      for (let k = 0; k < n; k++) { P(`${nums(x + 0.4 * sp, c + (list[k] + off) * sp / 2)} sm-acc-natural`); x += 0.9 * sp; }
      x += 0.5 * sp;
    }
    const n = Math.abs(fifths);
    const list = fifths > 0 ? KEY_SHARPS : KEY_FLATS;
    for (let k = 0; k < n; k++) {
      let p = list[k] + off;
      if (fifths > 0 && clef.sign === 'C' && clef.line === 4 && p > 4) p -= 7; // tenor clef sharps: F# on the 2nd line
      P(`${nums(x + 0.5 * sp, c + p * sp / 2)} ${fifths > 0 ? 'sm-acc-sharp' : 'sm-acc-flat'}`);
      x += 1.0 * sp;
    }
    return x + (n ? 0.8 * sp : 0);
  }
  function timeAt(P, x, si, s, t) {
    if (!t || !t.num || t.symbol === 'none' || t.symbol === 'none-given') return;
    const c = staffY(si, s);
    if (t.symbol === 'common') P(`${nums(x, c)} sm-ts-common`);
    else if (t.symbol === 'cut') P(`${nums(x, c)} sm-ts-cut`);
    else P(`${nums(x, c)} (${t.text || t.num}) (${t.den}) sm-timesig`);
  }

  function barAt(P, x, si, type, startRepeat) {
    const top = staffY(si, 0) + 2 * sp;
    const bot = staffY(si, S - 1) - 2 * sp;
    const dots = (dx) => { for (let s = 0; s < S; s++) P(`${nums(x + dx * sp, staffY(si, s))} sm-repeat-dots`); };
    const thin = (dx) => P(`${nums(x + dx * sp, top, bot)} sm-bar-thin`);
    const thick = (dx) => P(`${nums(x + dx * sp, top, bot)} sm-bar-thick`);
    if (type === 'repeat-end' && startRepeat) { dots(-1.95); thin(-1.3); thick(-0.6); thin(0.1); dots(0.75); return; }
    if (type === 'repeat-end') { dots(-1.95); thin(-1.3); thick(-0.25); return; }
    if (startRepeat) { thick(0.25); thin(0.9); dots(1.55); return; }
    if (type === 'double') { thin(-0.6); thin(0); return; }
    if (type === 'final') { thin(-0.85); thick(-0.25); return; }
    if (type === 'thick-thin') { thick(-0.75); thin(0); return; }
    thin(0);
  }

  function drawMeasure(P, si, m, firstInSystem, mi) {
    // start-of-measure: repeat sign (the previous measure's bar is drawn there too)
    const prev = ms[mi - 1];
    const prevEnd = firstInSystem || !prev ? null : prev.endBar;
    if (firstInSystem) {
      if (m.startRepeat) barAt(P, m._x0 - 0.15 * sp, si, 'single', true);
    } else barAt(P, m._x0, si, prevEnd, m.startRepeat);
    // a change of clef/key/time inside a system
    if (!firstInSystem && (m._keyChange || m._timeChange || m._clefChange.some(Boolean))) {
      for (let s = 0; s < S; s++) {
        let x = m._changeX;
        if (m._clefChange[s]) { clefAt(P, x, si, s, m._clefChange[s]); x += 3.2 * sp; }
        if (m._keyChange) x = keyAt(P, x, si, s, m._key.fifths, m._clef[s], m._key.fifths === 0 ? m._prevKey.fifths : 0);
        if (m._timeChange) timeAt(P, x + (timeWidth(m._time) / 2) * sp, si, s, m._time);
      }
    } else if (firstInSystem && m._keyChange && m._key.fifths === 0) {
      // key changes to C at a line start: nothing to show in the key signature
    }
    // last measure of the system draws its own end bar
    const sysIdx = systems[si];
    if (sysIdx[sysIdx.length - 1] === mi) barAt(P, m._x1, si, m.endBar === 'repeat-end' ? 'repeat-end' : m.endBar, false);
    if (m.part) P(`${nums(m._x0 + 0.3 * sp, staffY(si, 0) + sysV[si].staves[0].partY * sp)} ${pstext(m.part, 13)} /Times-Bold 13 sm-text-l`);
    // volta
    if (m.ending) {
      const sysMs = systems[si];
      let lastIdx = mi + m.ending.span - 1;
      if (lastIdx > sysMs[sysMs.length - 1]) lastIdx = sysMs[sysMs.length - 1];
      const end = ms[lastIdx];
      const vy = staffY(si, 0) + sysV[si].staves[0].voltaY * sp;
      const label = /^\d/.test(m.ending.label) ? m.ending.label.replace(/,/g, ', ') + '.' : m.ending.label;
      P(`${nums(m._x0 + 0.1 * sp, end._x1 - 0.7 * sp, vy)} ${pstext(label, 11)} ${m.ending.closed && lastIdx === mi + m.ending.span - 1 ? 'true' : 'false'} sm-volta`);
    }
    for (let s = 0; s < S; s++) {
      const evs = m.staves[s].events;
      const V = sysV[si].staves[s];
      for (const e of evs) drawEvent(P, si, s, e, V, m);
      // beams
      const seen = new Set();
      for (const e of evs) if (e._g.beam && !seen.has(e._g.beam)) { seen.add(e._g.beam); drawBeam(P, si, s, e._g.beam); }
      // tuplets
      for (const e of evs) if (e.tuplet && e.tuplet.first) drawTuplet(P, si, s, evs, e);
      if (m.mmCount > 1) {
        const c = staffY(si, s);
        P(`${nums(m._x0 + (m._pre + 0.5) * sp, m._x1 - 1.6 * sp, c)} (${m.mmCount}) sm-mmrest`);
      }
    }
  }

  function drawEvent(P, si, s, e, V, m) {
    const g = e._g;
    g.si = si;
    const c = staffY(si, s);
    const x = g.x;
    if (e.kind === 'rest') {
      if (e.rest && e.rest.invisible) return;
      if (m.mmCount > 1) return;
      const rt = g.restType;
      if (rt === 'measure' || rt === 'whole') P(`${nums(x, c)} sm-rest-whole`);
      else if (rt === 'half') P(`${nums(x, c)} sm-rest-half`);
      else if (rt === 'quarter') P(`${nums(x, c)} sm-rest-quarter`);
      else P(`${nums(x, c)} ${rt} sm-rest-flagged`);
      for (let d = 0; d < (e.dots || 0); d++) P(`${nums(x + (0.95 + 0.45 * d) * sp, c + 0.5 * sp)} sm-dot`);
      drawDecos(P, si, s, e, V, c);
      return;
    }
    const heads = g.heads;
    // ledger lines
    const ledger = (pos, xl, xr) => P(`${nums(xl, xr, c + pos * sp / 2)} sm-ledger`);
    const hiPos = heads[heads.length - 1].pos, loPos = heads[0].pos;
    const minDx = Math.min(...heads.map((h) => h.dx)), maxDx = Math.max(...heads.map((h) => h.dx));
    const lx = x + (minDx - g.hw - 0.45) * sp, rx = x + (maxDx + g.hw + 0.45) * sp;
    for (let p = 6; p <= hiPos; p += 2) ledger(p, lx, rx);
    for (let p = -6; p >= loPos; p -= 2) ledger(p, lx, rx);
    // heads
    const proc = val(e.type) >= 2 ? 'sm-head-breve' : val(e.type) >= 1 ? 'sm-head-whole' : val(e.type) >= 0.5 ? 'sm-head-half' : 'sm-head-black';
    for (const h of heads) P(`${nums(x + h.dx * sp, c + h.pos * sp / 2)} ${proc}`);
    for (const a of g.accs) P(`${nums(x + a.dx * sp, c + a.pos * sp / 2)} ${ACC_PROC[a.type]}`);
    // dots
    if (e.dots) {
      const dx0 = maxDx + g.hw + 0.5;
      const used = new Set();
      for (const h of heads) {
        let p = h.pos % 2 === 0 ? h.pos + 1 : h.pos;
        if (used.has(p)) p -= 2;
        used.add(p);
        for (let d = 0; d < e.dots; d++) P(`${nums(x + (dx0 + 0.45 * d) * sp, c + p * sp / 2)} sm-dot`);
      }
    }
    // stem and flags
    if (g.stem) {
      const sx = stemX(e);
      const from = g.dir === 1 ? loPos / 2 + 0.18 : hiPos / 2 - 0.18;
      P(`${nums(sx, c + from * sp, c + g.tip * sp)} sm-stem`);
      if (g.flags) P(`${nums(sx - STEM_W / 2 * sp, c + g.tip * sp)} ${g.flags} ${g.dir === 1 ? 'true' : 'false'} sm-flags`);
    }
    if (e.grace) drawGrace(P, si, s, e, c);
    drawDecos(P, si, s, e, V, c);
  }

  function drawGrace(P, si, s, e, c) {
    const g = e._g;
    const gs = 0.62;
    const gsp = sp * gs;
    const notes = e.grace.notes;
    const clef = g.m._clef[s];
    const firstX = g.x - (g.graceW - 0.6 + (g.left - g.graceW)) * sp;
    const xs = notes.map((_, k) => firstX + k * 1.25 * sp);
    const ps = notes.map((n) => posOf(n, clef));
    P(`1 dict begin /sm-sp ${num(gsp)} def`);
    notes.forEach((n, k) => {
      const hy = c + ps[k] * sp / 2;
      for (let p = 6; p <= ps[k]; p += 2) P(`${nums(xs[k] - 1.0 * gsp, xs[k] + 1.0 * gsp, c + p * sp / 2)} sm-ledger`);
      for (let p = -6; p >= ps[k]; p -= 2) P(`${nums(xs[k] - 1.0 * gsp, xs[k] + 1.0 * gsp, c + p * sp / 2)} sm-ledger`);
      P(`${nums(xs[k], hy)} sm-head-black`);
      if (n.acc) P(`${nums(xs[k] - 1.4 * gsp, hy)} ${ACC_PROC[n.acc]}`);
    });
    const sxs = xs.map((x) => x + (HW - STEM_W / 2) * gsp);
    if (notes.length === 1) {
      const hy = c + ps[0] * sp / 2;
      const tip = Math.max(hy + 3.3 * gsp, c);
      P(`${nums(sxs[0], hy + 0.18 * gsp, tip)} sm-stem`);
      P(`${nums(sxs[0] - STEM_W / 2 * gsp, tip)} 1 true sm-flags`);
      if (e.grace.slash) P(`${nums(sxs[0] + 0.25 * gsp, tip - 1.6 * gsp)} sm-grace-slash`);
    } else {
      const tipY = Math.max(...ps.map((p) => c + p * sp / 2)) + 3.2 * gsp;
      const tip = Math.max(tipY, c);
      xs.forEach((_, k) => P(`${nums(sxs[k], c + ps[k] * sp / 2 + 0.18 * gsp, tip)} sm-stem`));
      P(`${nums(sxs[0] - 0.06 * gsp, tip, sxs[sxs.length - 1] + 0.06 * gsp, tip)} 1 sm-beam`);
      P(`${nums(sxs[0] - 0.06 * gsp, tip - 0.75 * gsp, sxs[sxs.length - 1] + 0.06 * gsp, tip - 0.75 * gsp)} 1 sm-beam`);
      if (e.grace.slash) P(`${nums(sxs[0] + 0.3 * gsp, tip - 1.4 * gsp)} sm-grace-slash`);
    }
    P('end');
  }

  function drawDecos(P, si, s, e, V, c) {
    const g = e._g;
    const x = g.x;
    const isNote = e.kind === 'note';
    const hiPos = isNote ? g.heads[g.heads.length - 1].pos : 2;
    const loPos = isNote ? g.heads[0].pos : -2;
    let headSide = isNote && g.stem && g.dir === 1 ? -1 : 1; // opposite the stem
    if (isNote && !g.stem) headSide = hiPos >= 0 ? 1 : -1;
    let hp = headSide === 1 ? hiPos + 2 : loPos - 2;
    for (const d of e.decos || []) {
      if (HEAD_DECOS[d]) {
        let p = hp;
        if (Math.abs(p) <= 4 && p % 2 === 0) p += headSide;
        P(`${nums(x, c + p * sp / 2)} ${HEAD_DECOS[d]}`);
        hp = p + headSide * 2;
      }
    }
    // above the staff: over the notes, stems and head-side marks
    let top = Math.max(2.9, hiPos / 2 + 1.4, isNote && g.stem && g.dir === 1 ? g.tip + 1.0 : -99, headSide === 1 ? hp / 2 + 0.6 : -99);
    for (const d of e.decos || []) {
      if (!ABOVE_DECOS.has(d)) continue;
      if (d === 'fermata') { P(`${nums(x, c + (top - 0.1) * sp)} true sm-art-fermata`); top += 2.2; }
      else if (d === 'breath') P(`${nums(x + 1.2 * sp, c + 2.3 * sp)} sm-art-breath`);
      else { P(`${nums(x, c + (top + 0.6) * sp)} sm-art-${d}`); top += 2.0; }
    }
    if ((e.decos || []).includes('invertedfermata')) P(`${nums(x, c - Math.max(2.9, -loPos / 2 + 1.4) * sp)} false sm-art-fermata`);
    if (e.chord && V.chordY !== undefined) {
      const ch = parseChord(e.chord);
      const cx = x - (isNote ? g.hw : 0.5) * sp;
      if (ch) P(`${nums(cx, c + V.chordY * sp)} (${ch.root}) ${ch.acc} ${pstext(ch.kind, CHS)} (${ch.bass}) ${ch.bacc} sm-chordsym`);
      else P(`${nums(cx, c + V.chordY * sp)} ${pstext(e.chord, CHS)} /Times-Roman ${CHS} sm-text-l`);
    }
    for (const a of e.annot || []) {
      const font = a.italic ? '/Times-Italic' : '/Times-Roman';
      if (a.pos === 'above' && V.annotY !== undefined) P(`${nums(x - 0.6 * sp, c + V.annotY * sp)} ${pstext(a.text, 10)} ${font} 10 sm-text-l`);
      else if (a.pos === 'below' && V.dynY !== undefined) P(`${nums(x - 0.6 * sp, c + V.dynY * sp)} ${pstext(a.text, 10)} ${font} 10 sm-text-l`);
      else if (a.pos === 'left') P(`${nums(x - (g.left + 0.3) * sp, c - 0.5 * sp)} ${pstext(a.text, 9)} /Times-Roman 9 sm-text-r`);
      else if (a.pos === 'right') P(`${nums(x + (g.right + 0.3) * sp, c - 0.5 * sp)} ${pstext(a.text, 9)} /Times-Roman 9 sm-text-l`);
    }
    if (e.dyn && V.dynY !== undefined) P(`${nums(x - 0.9 * sp, c + V.dynY * sp)} (${e.dyn}) sm-dynamic`);
    if (e.lyrics) e.lyrics.forEach((l, v) => { if (l && l.text) P(`${nums(x, c + V.lyricY[v] * sp)} ${pstext(l.text, LYR)} sm-lyric`); });
  }

  function drawBeam(P, si, s, b) {
    const c = staffY(si, s);
    const E = b.events;
    const xs = E.map(stemX);
    const ty = E.map((e) => e._g.tip);
    const yAt = (xx) => b.base + b.slope * (xx / sp - b.x0);
    const maxL = Math.max(...b.levels);
    const ext = STEM_W / 2 * sp;
    for (let k = 1; k <= maxL; k++) {
      const shift = (k - 1) * 0.75 * b.dir;
      let i = 0;
      while (i < E.length) {
        if (b.levels[i] < k) { i++; continue; }
        let j = i;
        while (j + 1 < E.length && b.levels[j + 1] >= k) j++;
        let xa = xs[i] - ext, xb = xs[j] + ext;
        if (i === j) {
          // partial beam: right from the first note, else left
          const leftHook = i === E.length - 1 || (i > 0 && E[i - 1].dots);
          if (leftHook) xa = xs[i] - 1.15 * sp; else xb = xs[i] + 1.15 * sp;
        }
        P(`${nums(xa, c + (yAt(xa) - shift) * sp, xb, c + (yAt(xb) - shift) * sp)} ${b.dir} sm-beam`);
        i = j + 1;
      }
    }
    void ty;
  }

  function drawTuplet(P, si, s, evs, first) {
    const id = first.tuplet.id;
    const group = evs.filter((e) => e.tuplet && e.tuplet.id === id);
    if (!group.length) return;
    const c = staffY(si, s);
    const notes = group.filter((e) => e.kind === 'note');
    const ref = notes.length ? notes : group;
    const dirs = ref.map((e) => e._g.dir || 1);
    const up = dirs.reduce((a, d) => a + d, 0) >= 0;
    const beamed = notes.length === group.length && notes.every((e) => e._g.beam && e._g.beam === notes[0]._g.beam);
    const x1 = group[0]._g.x - 0.6 * sp;
    const x2 = group[group.length - 1]._g.x + 0.6 * sp;
    let yy;
    if (up) yy = Math.max(2.6, ...ref.map((e) => (e._g.tip ?? 0) + 1.3), ...ref.map((e) => (e._g.heads ? e._g.heads[e._g.heads.length - 1].pos / 2 + 1.5 : 0)));
    else yy = Math.min(-2.6, ...ref.map((e) => (e._g.tip ?? 0) - 1.3), ...ref.map((e) => (e._g.heads ? e._g.heads[0].pos / 2 - 1.5 : 0)));
    const label = String(first.tuplet.p);
    if (beamed) {
      const sx1 = stemX(notes[0]), sx2 = stemX(notes[notes.length - 1]);
      const b = notes[0]._g.beam;
      const mid = (sx1 + sx2) / 2;
      const by = b.base + b.slope * (mid / sp - b.x0);
      const ny = up ? by + 1.35 : by - 1.35;
      P(`${nums(sx1, sx2, c + ny * sp)} (${label}) false ${up ? 'true' : 'false'} sm-tuplet`);
    } else {
      P(`${nums(x1, x2, c + yy * sp)} (${label}) true ${up ? 'true' : 'false'} sm-tuplet`);
    }
  }

  // ------------------------------------------------------------ ties, slurs, hairpins, lyric lines
  for (let s = 0; s < S; s++) {
    const seq = ms.flatMap((m) => m.staves[s].events);
    const slurStack = [];
    let hairpin = null;
    seq.forEach((e, k) => {
      if (e.kind === 'note') {
        for (const h of e._g.heads) {
          if (!h.note.tie) continue;
          let next = null;
          for (let j = k + 1; j < seq.length; j++) { if (seq[j].kind === 'note') { next = seq[j]; break; } if (!(seq[j].rest && seq[j].rest.invisible)) break; }
          const nh = next && next._g.heads.find((q) => q.pos === h.pos);
          if (!nh) continue;
          drawTie(s, e, h, next, nh);
        }
      }
      for (let n = 0; n < (e.slurStart || 0); n++) slurStack.push(e);
      for (let n = 0; n < (e.slurEnd || 0); n++) { const a = slurStack.pop(); if (a && a !== e) drawSlur(s, a, e, seq); }
      if (e.hairpinStart) hairpin = { e, type: e.hairpinStart };
      if (e.hairpinEnd && hairpin) { drawHairpin(s, hairpin, e); hairpin = null; }
    });
    lyricLines(s, seq);
  }

  function drawTie(s, e, h, next, nh) {
    const g = e._g, ng = next._g;
    const chordSide = g.heads.length > 1 ? (g.heads.indexOf(h) >= g.heads.length / 2 ? 1 : -1) : null;
    const side = chordSide ?? (g.stem ? -g.dir : (h.pos >= 0 ? 1 : -1));
    const dy = side * 0.55;
    const piece = (si, xa, xb, pos) => {
      const c = staffY(si, s);
      const len = (xb - xa) / sp;
      const hgt = side * Math.min(1.5, 0.45 + 0.08 * len) * sp;
      out(si, `${nums(xa, c + (pos / 2 + dy) * sp, xb, c + (pos / 2 + dy) * sp, hgt)} sm-tie`);
    };
    const xa = g.x + (h.dx + g.hw * 0.75) * sp;
    if (g.si === ng.si) piece(g.si, xa, ng.x + (nh.dx - ng.hw * 0.75) * sp, h.pos);
    else {
      piece(g.si, xa, sysInfo[g.si].x1 - 0.4 * sp, h.pos);
      piece(ng.si, ng.x - (ng.left + 2.2) * sp, ng.x + (nh.dx - ng.hw * 0.75) * sp, nh.pos);
    }
  }

  function drawSlur(s, a, b, seq) {
    const ga = a._g, gb = b._g;
    const ups = [a, b].filter((e) => e.kind === 'note' && e._g.stem).map((e) => e._g.dir);
    const above = !(ups.length && ups.every((d) => d === 1));
    const endY = (e) => {
      const g = e._g;
      if (e.kind !== 'note') return above ? 2.5 : -2.5;
      if (above) return g.stem && g.dir === 1 ? Math.max(g.tip + 0.6, g.heads[g.heads.length - 1].pos / 2 + 1.0) : g.heads[g.heads.length - 1].pos / 2 + 1.0;
      return g.stem && g.dir === -1 ? Math.min(g.tip - 0.6, g.heads[0].pos / 2 - 1.0) : g.heads[0].pos / 2 - 1.0;
    };
    const ia = seq.indexOf(a), ib = seq.indexOf(b);
    const mids = seq.slice(ia + 1, ib).filter((e) => e.kind === 'note');
    const piece = (si, xa, ya, xb, yb, inner) => {
      const c = staffY(si, s);
      let need = 0;
      for (const e of inner) {
        if (e._g.si !== si) continue;
        const t = (e._g.x - xa) / Math.max(1, xb - xa);
        const line = ya + (yb - ya) * t;
        const ext = endY(e);
        need = Math.max(need, above ? ext - line : line - ext);
      }
      const len = (xb - xa) / sp;
      const h = Math.max(Math.min(0.5 + 0.1 * len, 2.2), need + 0.6);
      out(si, `${nums(xa, c + ya * sp, xb, c + yb * sp, (above ? 1 : -1) * Math.min(h, 4) * sp)} sm-tie`);
    };
    const xa = ga.x, xb = gb.x;
    if (ga.si === gb.si) piece(ga.si, xa, endY(a), xb, endY(b), mids);
    else {
      piece(ga.si, xa, endY(a), sysInfo[ga.si].x1 - 0.5 * sp, endY(a), mids);
      piece(gb.si, gb.x - (gb.left + 3) * sp, endY(b), xb, endY(b), mids);
    }
  }

  function drawHairpin(s, hp, b) {
    const ga = hp.e._g, gb = b._g;
    const V = (si) => sysV[si].staves[s];
    const y = (si) => staffY(si, s) + (V(si).dynY + 0.35) * sp;
    const x1 = ga.x + (hp.e.dyn ? 2.2 : 0) * sp;
    const x2 = b.dyn ? gb.x - 1.4 * sp : gb.x + 0.6 * sp;
    if (ga.si === gb.si) out(ga.si, `${nums(x1, x2, y(ga.si))} ${hp.type === 'cresc'} sm-hairpin`);
    else {
      out(ga.si, `${nums(x1, sysInfo[ga.si].x1 - sp, y(ga.si))} ${hp.type === 'cresc'} sm-hairpin`);
      out(gb.si, `${nums(gb.x - 3 * sp, x2, y(gb.si))} ${hp.type === 'cresc'} sm-hairpin`);
    }
  }

  function lyricLines(s, seq) {
    const verses = Math.max(0, ...seq.map((e) => (e.lyrics ? e.lyrics.length : 0)));
    for (let v = 0; v < verses; v++) {
      const sylls = seq.filter((e) => e.lyrics && e.lyrics[v] && e.lyrics[v].text);
      sylls.forEach((e, k) => {
        const l = e.lyrics[v];
        const g = e._g;
        const V = sysV[g.si].staves[s];
        const yy = staffY(g.si, s) + V.lyricY[v] * sp;
        const next = sylls[k + 1];
        const halfW = approxWidth(l.text, LYR) / 2;
        if (l.hyphen && next) {
          if (next._g.si === g.si) {
            const gap0 = g.x + halfW, gap1 = next._g.x - approxWidth(next.lyrics[v].text, LYR) / 2;
            if (gap1 - gap0 > 5) out(g.si, `${nums(gap0, gap1, yy)} sm-lyric-hyphen`);
          } else out(g.si, `${nums(g.x + halfW, g.x + halfW + 14, yy)} sm-lyric-hyphen`);
        }
        if (l.extend) {
          // to the last note before the next syllable, in this system
          const i0 = seq.indexOf(e);
          const i1 = next ? seq.indexOf(next) : seq.length;
          let last = e;
          for (let j = i0 + 1; j < i1; j++) if (seq[j].kind === 'note' && seq[j]._g.si === g.si) last = seq[j];
          const xa = g.x + halfW + 1.5;
          const xb = last._g.x + (last._g.hw || HW) * sp;
          if (xb - xa > 3) out(g.si, `${nums(xa, xb, yy)} sm-lyric-extend`);
        }
      });
    }
  }

  // ------------------------------------------------------------ words after the tune, footer
  if (meta.words && meta.words.length) {
    let pg = pages.length - 1;
    let wy = y + 3.2 * sp - 10;
    const lineH = 14;
    if (wy - lineH * meta.words.length < bottomY) {
      // two columns if long, else a new page
      if (meta.words.length * lineH > PH / 2) warnings.push('W: words run past the page end');
      pages.push([]); pg++; wy = PH - o.top;
    }
    for (const w of meta.words) {
      wy -= lineH;
      if (w.trim()) pages[pg].push(`${nums(left + 40, wy)} ${pstext(w, 11)} /Times-Roman 11 sm-text-l`);
    }
  }
  const credit = o.footer;
  pages.forEach((pg, k) => {
    if (pages.length > 1) pg.push(`${nums(PW / 2, o.bottom - 18)} (${k + 1}) /Times-Roman 9 sm-text-c`);
    if (credit && k === pages.length - 1) pg.push(`gsave 0.35 setgray ${nums(PW / 2, o.bottom - 30)} ${pstext(credit, 7.5)} /Helvetica 7.5 sm-text-c grestore`);
  });

  const tempo = score.tempo;
  if (tempo && systems.length) {
    const V = sysV[0].staves[0];
    const tv = tempo.beat ? tempoGlyph(tempo.beat) : null;
    const t = `${nums(sysInfo[0].x0, staffY(0, 0) + V.tempoY * sp)} ${pstext(tempo.text || '', 11)} ${tv ? tv.v : 0} ${tv ? tv.dots : 0} ${tempo.bpm && tv ? `( = ${tempo.bpm})` : '()'} sm-tempo`;
    pages[0].push(t);
  }

  for (const m of ms) for (const st of m.staves) for (const e of st.events) delete e._g;
  return { pages, warnings, size: [PW, PH] };
}

function tempoGlyph(beat) {
  for (const [v, d] of [[1, 0], [2, 0], [4, 0], [8, 0], [16, 0], [2, 1], [4, 1], [8, 1]]) {
    const value = d ? (1 / v) * 1.5 : 1 / v;
    if (Math.abs(value - val(beat)) < 1e-9) return { v, dots: d };
  }
  return null;
}

/** "Am7", "F#m", "Bb/D", "C/G" -> parts for sm-chordsym; null if not a chord name. */
export function parseChord(s) {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(s.trim());
  if (!m) return null;
  const acc = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);
  return { root: m[1], acc: acc(m[2]), kind: m[3], bass: m[4] || '', bacc: acc(m[5]) };
}
