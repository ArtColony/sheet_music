// MusicXML (score-partwise, uncompressed .musicxml/.xml) -> Score.
//
// Supported subset (docs/notation.md): parts and multi-staff parts, one
// voice per staff (the first voice found; others are dropped with a
// warning), keys, meters (incl. common/cut), clefs, notes, rests, chords,
// dots, ties, slurs, tuplets, beams (or automatic beaming when the file has
// none), accidentals, grace notes, fermata/staccato/accent/tenuto/trill/
// mordents, dynamics, wedges, words, metronome marks, harmony (chord
// symbols), lyrics with syllabic/extend, barlines, repeats, endings and
// new-system breaks. Compressed .mxl files must be unzipped first.
import { F, add, sub, cmp, mul, ZERO, val } from './frac.js';
import { newScore, newMeasure, finalizeScore } from './score.js';

// ------------------------------------------------------------ a small XML parser
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});
export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) { const t = src.slice(i, lt); if (t.trim()) stack[stack.length - 1].text += decode(t); }
    if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt) + 3; if (i < 3) break; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); stack[stack.length - 1].text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt) + 2; continue; }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset [ ... ]
      let j = lt + 2, depth = 0;
      for (; j < n; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') depth--; else if (src[j] === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt < 0) throw Error('malformed XML: unterminated tag');
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw Error(`malformed XML: </${name}> does not close <${top && top.name}>`);
      continue;
    }
    const self = body.endsWith('/');
    const m = /^([^\s/>]+)([\s\S]*?)\/?$/.exec(body);
    const el = { name: m[1], attrs: {}, children: [], text: '' };
    m[2].replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { el.attrs[k] = decode(a ?? b); return ''; });
    stack[stack.length - 1].children.push(el);
    if (!self) stack.push(el);
  }
  return root;
}
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => (el ? el.children.find((c) => c.name === name) : undefined);
const txt = (el, name) => { const k = name ? kid(el, name) : el; return k ? k.text.trim() : ''; };
const path = (el, ...names) => names.reduce((e, nm) => kid(e, nm), el);

const TYPES = { maxima: F(8), long: F(4), breve: F(2), whole: F(1), half: F(1, 2), quarter: F(1, 4), eighth: F(1, 8), '16th': F(1, 16), '32nd': F(1, 32), '64th': F(1, 64), '128th': F(1, 128) };
const ACCS = { sharp: 'sharp', flat: 'flat', natural: 'natural', 'double-sharp': 'dsharp', 'sharp-sharp': 'dsharp', 'flat-flat': 'dflat' };
const KINDS = { major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7', 'major-seventh': 'maj7', 'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': 'aug7', 'half-diminished': 'm7b5', 'major-minor': 'm(maj7)', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9', 'minor-ninth': 'm9', 'dominant-11th': '11', 'dominant-13th': '13', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4', power: '5', none: '' };
const ARTIC = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', 'strong-accent': 'marcato', staccatissimo: 'staccato' };
const ORN = { 'trill-mark': 'trill', mordent: 'lowermordent', 'inverted-mordent': 'uppermordent', turn: 'roll' };
const SHARPS = 'FCGDAEB';

/** Parse a MusicXML document. Returns { score, warnings }. */
export function parseMusicXML(src) {
  const warnings = [];
  const warnOnce = new Set();
  const warn = (w) => { if (!warnOnce.has(w)) { warnOnce.add(w); warnings.push(w); } };
  const doc = parseXML(src);
  let sp = kid(doc, 'score-partwise');
  if (!sp) {
    if (kid(doc, 'score-timewise')) throw Error('score-timewise MusicXML is not supported; export partwise');
    throw Error('not a MusicXML score (no <score-partwise>)');
  }
  const score = newScore();
  const meta = score.meta;
  meta.title = txt(path(sp, 'work', 'work-title')) || txt(sp, 'movement-title');
  if (meta.title && txt(sp, 'movement-title') && txt(sp, 'movement-title') !== meta.title) meta.subtitles.push(txt(sp, 'movement-title'));
  for (const c of kids(kid(sp, 'identification'), 'creator')) {
    const t = c.attrs.type;
    if (t === 'composer') meta.composer = c.text.trim();
    else if (t === 'lyricist' || t === 'poet') meta.origin = 'Words: ' + c.text.trim();
    else if (t === 'arranger') meta.transcriber = 'Arr. ' + c.text.trim();
  }
  meta.rights = kids(kid(sp, 'identification'), 'rights').map((r) => r.text.trim()).join('; ');
  const partNames = new Map(kids(kid(sp, 'part-list'), 'score-part').map((p) => [p.attrs.id, txt(p, 'part-name')]));

  const staffMeasures = []; // one list of measures per staff (all parts)
  const parts = kids(sp, 'part');
  let firstKey = null, firstTime = null;
  let tupId = 0;
  for (const part of parts) {
    const nStaves = Math.max(1, ...kids(part, 'measure').flatMap((m) => kids(m, 'attributes').map((a) => parseInt(txt(a, 'staves') || '1', 10))));
    const base = staffMeasures.length;
    for (let s = 0; s < nStaves; s++) {
      staffMeasures.push([]);
      score.staves.push({ id: `${part.attrs.id}-${s + 1}`, name: s === 0 && parts.length > 1 ? partNames.get(part.attrs.id) || '' : '', clef: { sign: 'G', line: 2, octave: 0 } });
    }
    if (nStaves === 2 && parts.length === 1) score.group = 'brace';
    let divisions = 1;
    let fifths = 0;
    let time = { num: 4, den: 4 };
    const voiceOf = new Array(nStaves).fill(null);
    let pendingBreak = false;
    let hasBeams = kids(part, 'measure').some((m) => kids(m, 'note').some((nt) => kid(nt, 'beam')));
    const ties = []; // open tuplets by staff
    kids(part, 'measure').forEach((mx, mi) => {
      const ms = Array.from({ length: nStaves }, () => newMeasure());
      if (pendingBreak && mi > 0) for (let s = 0; s < nStaves; s++) { const prev = staffMeasures[base + s][mi - 1]; if (prev) prev.lineBreak = true; }
      pendingBreak = false;
      let cursor = ZERO;
      const lastOnset = new Array(nStaves).fill(null);
      const pend = Array.from({ length: nStaves }, () => ({ chord: null, dyn: null, words: [], decos: [], hairpinStart: null, hairpinEnd: false }));
      const ends = new Array(nStaves).fill(ZERO); // time each staff's chosen voice has reached
      const accState = Array.from({ length: nStaves }, () => new Map());
      const keyAlter = (step) => {
        const k = SHARPS.indexOf(step);
        if (fifths > 0 && k < fifths) return 1;
        if (fifths < 0 && 6 - k < -fifths) return -1;
        return 0;
      };
      const staffOf = (el) => Math.min(nStaves, Math.max(1, parseInt(txt(el, 'staff') || '1', 10))) - 1;
      for (const el of mx.children) {
        if (el.name === 'attributes') {
          const d = txt(el, 'divisions'); if (d) divisions = parseInt(d, 10);
          const k = kid(el, 'key');
          if (k && txt(k, 'fifths') !== '') {
            fifths = parseInt(txt(k, 'fifths'), 10);
            if (mi === 0 && !firstKey) firstKey = { fifths }; else ms.forEach((m) => { m.key = { fifths }; });
          }
          const t = kid(el, 'time');
          if (t) {
            const sym = t.attrs.symbol;
            const beats = txt(t, 'beats');
            time = { num: beats.split('+').reduce((a, b) => a + parseInt(b, 10), 0), den: parseInt(txt(t, 'beat-type'), 10), text: beats.includes('+') ? beats : undefined };
            if (sym === 'common') time.symbol = 'common'; else if (sym === 'cut') time.symbol = 'cut';
            if (kid(t, 'senza-misura')) time = { num: 0, den: 0, symbol: 'none' };
            if (mi === 0 && !firstTime) firstTime = time; else ms.forEach((m) => { m.time = time; });
          }
          for (const c of kids(el, 'clef')) {
            const s = Math.min(nStaves, parseInt(c.attrs.number || '1', 10)) - 1;
            const clef = { sign: txt(c, 'sign') || 'G', line: parseInt(txt(c, 'line') || (txt(c, 'sign') === 'F' ? '4' : txt(c, 'sign') === 'C' ? '3' : '2'), 10), octave: parseInt(txt(c, 'clef-octave-change') || '0', 10) };
            if (clef.sign === 'percussion' || clef.sign === 'TAB') { warn(`${clef.sign} clefs are drawn as treble`); clef.sign = 'G'; clef.line = 2; }
            if (mi === 0 && cmp(cursor, ZERO) === 0) score.staves[base + s].clef = clef; else ms[s].clef = clef;
          }
        } else if (el.name === 'backup') cursor = sub(cursor, F(parseInt(txt(el, 'duration'), 10), divisions * 4));
        else if (el.name === 'forward') cursor = add(cursor, F(parseInt(txt(el, 'duration'), 10), divisions * 4));
        else if (el.name === 'print') { if (el.attrs['new-system'] === 'yes' || el.attrs['new-page'] === 'yes') { if (mi > 0) for (let s = 0; s < nStaves; s++) { const prev = staffMeasures[base + s][mi - 1]; if (prev) prev.lineBreak = true; } } }
        else if (el.name === 'barline') {
          const loc = el.attrs.location || 'right';
          const style = txt(el, 'bar-style');
          const rep = kid(el, 'repeat');
          const end = kid(el, 'ending');
          for (const m of ms) {
            if (loc === 'left') {
              if (rep && rep.attrs.direction === 'forward') m.startRepeat = true;
              if (end && end.attrs.type === 'start') m.ending = { label: (end.text.trim() || end.attrs.number || '').replace(/\.$/, '') };
            } else {
              if (rep && rep.attrs.direction === 'backward') m.endBar = 'repeat-end';
              else if (style === 'light-heavy') m.endBar = 'final';
              else if (style === 'light-light') m.endBar = 'double';
              else if (style === 'heavy-light') m.endBar = 'thick-thin';
            }
          }
        } else if (el.name === 'harmony') {
          const s = staffOf(el);
          const root = kid(el, 'root');
          if (!root) continue;
          const alt = (a) => (a === '1' ? '#' : a === '-1' ? 'b' : '');
          const kd = kid(el, 'kind');
          let name = txt(root, 'root-step') + alt(txt(root, 'root-alter'));
          name += kd && kd.attrs.text !== undefined ? kd.attrs.text : (KINDS[txt(kd)] ?? '');
          const bass = kid(el, 'bass');
          if (bass) name += '/' + txt(bass, 'bass-step') + alt(txt(bass, 'bass-alter'));
          pend[s].chord = name;
        } else if (el.name === 'direction') {
          const s = staffOf(el);
          const above = el.attrs.placement !== 'below';
          for (const dt of kids(el, 'direction-type')) {
            for (const c of dt.children) {
              if (c.name === 'words' && c.text.trim()) pend[s].words.push({ text: c.text.trim(), pos: above ? 'above' : 'below', italic: c.attrs['font-style'] === 'italic' });
              else if (c.name === 'dynamics') { const d = c.children[0]; if (d) pend[s].dyn = d.name === 'other-dynamics' ? d.text.trim() : d.name; }
              else if (c.name === 'wedge') { if (c.attrs.type === 'stop') pend[s].hairpinEnd = true; else pend[s].hairpinStart = c.attrs.type === 'crescendo' ? 'cresc' : 'dim'; }
              else if (c.name === 'metronome' && !score.tempo) {
                const bu = TYPES[txt(c, 'beat-unit')];
                const dots = kids(c, 'beat-unit-dot').length;
                const pm = parseInt(txt(c, 'per-minute'), 10);
                if (bu && pm) score.tempo = { text: '', beat: dots ? mul(bu, F(3, 2)) : bu, bpm: pm };
              } else if (c.name === 'segno') pend[s].decos.push('segno');
              else if (c.name === 'coda') pend[s].decos.push('coda');
            }
          }
          const snd = kid(el, 'sound');
          if (snd && snd.attrs.tempo && !score.tempo) score.tempo = { text: '', beat: F(1, 4), bpm: Math.round(parseFloat(snd.attrs.tempo)) };
          // words given with the metronome mark in one direction are its text ("Allegro")
          const hasMetro = kids(el, 'direction-type').some((dt) => kid(dt, 'metronome'));
          const wordsHere = kids(el, 'direction-type').flatMap((dt) => kids(dt, 'words')).filter((w) => w.text.trim());
          if (hasMetro && wordsHere.length && score.tempo && !score.tempo.text) {
            score.tempo.text = wordsHere.map((w) => w.text.trim()).join(' ');
            pend[s].words = pend[s].words.filter((w) => !wordsHere.some((x) => x.text.trim() === w.text));
          }
        } else if (el.name === 'note') {
          const s = staffOf(el);
          const isChord = !!kid(el, 'chord');
          const isGrace = !!kid(el, 'grace');
          const dur = isGrace ? ZERO : F(parseInt(txt(el, 'duration') || '0', 10), divisions * 4);
          const voice = txt(el, 'voice') || '1';
          if (voiceOf[s] === null) voiceOf[s] = voice;
          const onset = isChord ? (lastOnset[s] ?? cursor) : cursor;
          if (!isChord) cursor = add(cursor, dur);
          if (voice !== voiceOf[s]) { warn(`staff ${base + s + 1}: only one voice per staff is engraved; voice ${voice} was skipped`); continue; }
          const evs = ms[s].events;
          const pitch = kid(el, 'pitch');
          const note = pitch ? { step: txt(pitch, 'step'), oct: parseInt(txt(pitch, 'octave'), 10), alter: parseFloat(txt(pitch, 'alter') || '0'), acc: null, tie: false } : null;
          if (!pitch && kid(el, 'unpitched')) warn('unpitched notes are drawn on the middle line');
          if (note) {
            const a = txt(el, 'accidental');
            const key = note.step + note.oct;
            const expect = accState[s].has(key) ? accState[s].get(key) : keyAlter(note.step);
            if (a) note.acc = ACCS[a] || null;
            else if (note.alter !== expect) note.acc = note.alter === 1 ? 'sharp' : note.alter === -1 ? 'flat' : note.alter === 0 ? 'natural' : note.alter === 2 ? 'dsharp' : note.alter === -2 ? 'dflat' : null;
            accState[s].set(key, note.alter);
          }
          const notations = kids(el, 'notations');
          const has = (name) => notations.some((nt) => kid(nt, name));
          if (note && (kids(el, 'tie').some((t) => t.attrs.type === 'start') || notations.some((nt) => kids(nt, 'tied').some((t) => t.attrs.type === 'start')))) note.tie = true;
          if (isGrace) {
            // attach to the next main note on this staff
            if (note) { const g = pend[s].grace || (pend[s].grace = { notes: [], slash: kid(el, 'grace').attrs.slash === 'yes' }); g.notes.push(note); }
            continue;
          }
          if (isChord) {
            const prev = evs[evs.length - 1];
            if (prev && prev.kind === 'note' && note) prev.notes.push(note);
            continue;
          }
          // a gap in this voice (after backup/forward) becomes an invisible rest
          if (cmp(onset, ends[s]) > 0) evs.push(spacer(sub(onset, ends[s])));
          ends[s] = add(onset, dur);
          lastOnset[s] = onset;
          const typeName = txt(el, 'type');
          const restEl = kid(el, 'rest');
          const ev = { kind: note ? 'note' : 'rest', notes: note ? [note] : [], dur, beam: false };
          if (restEl && (restEl.attrs.measure === 'yes' || !typeName)) { ev.type = F(1); ev.dots = 0; ev.rest = { measure: true, count: 1 }; }
          else {
            ev.type = TYPES[typeName] || guessType(dur, el);
            ev.dots = kids(el, 'dot').length;
            if (restEl) ev.rest = {};
          }
          if (!note && !restEl) { ev.kind = 'rest'; ev.rest = {}; }
          if (kid(el, 'unpitched')) { ev.kind = 'note'; ev.notes = [{ step: 'B', oct: 4, acc: null, tie: false }]; }
          // beams
          const b1 = kids(el, 'beam').find((b) => (b.attrs.number || '1') === '1');
          if (b1) ev.beam = b1.text.trim() === 'continue' || b1.text.trim() === 'end';
          // tuplets
          const tm = kid(el, 'time-modification');
          if (tm) {
            const p = parseInt(txt(tm, 'actual-notes'), 10), q = parseInt(txt(tm, 'normal-notes'), 10);
            const startT = notations.some((nt) => kids(nt, 'tuplet').some((t) => t.attrs.type === 'start'));
            const prev = evs.filter((e) => !e.spacer).slice(-1)[0];
            if (startT || !prev || !prev.tuplet || prev.tuplet.closed || prev.tuplet.p !== p) tupId++;
            ev.tuplet = { id: tupId, p, q };
            if (notations.some((nt) => kids(nt, 'tuplet').some((t) => t.attrs.type === 'stop'))) ev.tuplet.closed = true;
          }
          // notations
          for (const nt of notations) {
            for (const sl of kids(nt, 'slur')) { if (sl.attrs.type === 'start') ev.slurStart = (ev.slurStart || 0) + 1; else if (sl.attrs.type === 'stop') ev.slurEnd = (ev.slurEnd || 0) + 1; }
            if (kid(nt, 'fermata')) (ev.decos = ev.decos || []).push(kid(nt, 'fermata').attrs.type === 'inverted' ? 'invertedfermata' : 'fermata');
            for (const a of kids(nt, 'articulations').flatMap((x) => x.children)) if (ARTIC[a.name]) (ev.decos = ev.decos || []).push(ARTIC[a.name]);
            for (const a of kids(nt, 'ornaments').flatMap((x) => x.children)) if (ORN[a.name]) (ev.decos = ev.decos || []).push(ORN[a.name]);
            for (const a of kids(nt, 'technical').flatMap((x) => x.children)) if (a.name === 'up-bow' || a.name === 'down-bow') (ev.decos = ev.decos || []).push(a.name.replace('-', ''));
            const dyn = kid(nt, 'dynamics');
            if (dyn && dyn.children[0]) ev.dyn = dyn.children[0].name;
          }
          // lyrics
          for (const ly of kids(el, 'lyric')) {
            const k = Math.max(1, parseInt(ly.attrs.number || '1', 10) || 1) - 1;
            const t = kids(ly, 'text').map((x) => x.text).join('');
            const syl = txt(ly, 'syllabic');
            (ev.lyrics = ev.lyrics || [])[k] = { text: t, hyphen: syl === 'begin' || syl === 'middle', extend: !!kid(ly, 'extend') };
          }
          // pending directions and harmony go to this note
          const p = pend[s];
          if (p.chord) { ev.chord = p.chord; p.chord = null; }
          if (p.dyn && !ev.dyn) { ev.dyn = p.dyn; p.dyn = null; }
          if (p.words.length) { ev.annot = p.words; p.words = []; }
          if (p.decos.length) { ev.decos = [...(ev.decos || []), ...p.decos]; p.decos = []; }
          if (p.hairpinStart) { ev.hairpinStart = p.hairpinStart; p.hairpinStart = null; }
          if (p.hairpinEnd) { const prevNote = evs[evs.length - 1]; if (prevNote) prevNote.hairpinEnd = true; else ev.hairpinEnd = true; p.hairpinEnd = false; }
          if (p.grace) { ev.grace = p.grace; p.grace = null; }
          evs.push(ev);
        }
      }
      for (let s = 0; s < nStaves; s++) {
        const p = pend[s];
        const evs = ms[s].events;
        if (p.hairpinEnd && evs.length) evs[evs.length - 1].hairpinEnd = true;
        if (!hasBeams) autoBeam(evs, time);
        staffMeasures[base + s].push(ms[s]);
      }
      void ties;
    });
  }
  if (firstKey) score.initial.key = firstKey;
  if (firstTime) score.initial.time = firstTime;
  if (score.staves.length > 1 && !score.group) score.group = 'bracket';
  score.voiceMeasures = staffMeasures;
  for (const sm of staffMeasures) {
    const last = sm[sm.length - 1];
    if (last && (!last.endBar || last.endBar === 'single') && sm === staffMeasures[0]) last.endBar = last.endBar || 'final';
    for (const m of sm) m.endBar = m.endBar || 'single';
  }
  return { score: finalizeScore(score, warn), warnings };
}

function spacer(d) { return { kind: 'rest', notes: [], dur: d, type: F(1, 4), dots: 0, rest: { invisible: true }, spacer: true, beam: false }; }

function guessType(dur) {
  for (const [, t] of Object.entries(TYPES)) if (cmp(t, dur) === 0) return t;
  return F(1, 4);
}

// Beam eighths and shorter within each beat (a dotted quarter in compound
// meters, a quarter otherwise; a half in 2/2), breaking at rests.
function autoBeam(evs, time) {
  const compound = time.den === 8 && time.num % 3 === 0 && time.num > 3;
  const beat = compound ? F(3, 8) : time.den === 2 ? F(1, 2) : F(1, 4);
  let t = ZERO;
  let prev = null;
  for (const e of evs) {
    const beatIdx = Math.floor(val(t) / val(beat) + 1e-9);
    const short = e.kind === 'note' && val(e.type) <= 1 / 8 && !e.spacer;
    e.beam = short && prev && prev.short && prev.beatIdx === beatIdx;
    prev = { short, beatIdx };
    t = add(t, e.dur);
  }
}
