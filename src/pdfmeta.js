// The score's source, carried inside its PDF.
//
// pscat has no pdfmark, so this appends a standard PDF incremental update to
// the file pscat wrote: the source as an embedded file (an attachment every
// PDF reader lists, marked /AFRelationship /Source), and a document info
// dictionary with the title, composer and a subject line written as proper
// PDF text strings (UTF-16 when they are not plain ASCII). The pages pscat
// drew are not touched. Nothing here depends on the clock, so the same input
// still gives the same bytes.
//
// extractSource() reads the attachment back, so a PDF from this project can
// be opened in the editor or the CLI and edited again.

const enc = new TextEncoder();
const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; };
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** A PDF text string: (literal) for printable ASCII, else <FEFF...> UTF-16BE. */
export function pdfString(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[()\\]/g, (c) => '\\' + c) + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return '<' + hex + '>';
}

/** PDF name for a MIME type: text/vnd.abc -> /text#2Fvnd.abc */
const mimeName = (t) => '/' + t.replace(/[^A-Za-z0-9.+-]/g, (c) => '#' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

/**
 * Append the source and document info to a PDF written by pscat.
 * meta: { source (text), filename, mime, title, author, subject, keywords, creator }
 */
export function embedSource(pdf, meta) {
  const text = latin1(pdf);
  const sx = text.lastIndexOf('startxref');
  if (sx < 0) throw Error('embedSource: not a PDF (no startxref)');
  const prev = parseInt(/startxref\s+(\d+)/.exec(text.slice(sx))[1], 10);
  const trailer = text.slice(text.lastIndexOf('trailer', sx), sx);
  const size = parseInt(/\/Size\s+(\d+)/.exec(trailer)?.[1], 10);
  const root = parseInt(/\/Root\s+(\d+)\s+0\s+R/.exec(trailer)?.[1], 10);
  if (!size || !root) throw Error('embedSource: cannot read the PDF trailer');
  const cat = new RegExp(`(?:^|[\\r\\n])${root} 0 obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(text);
  if (!cat || /\/Names\b|\/AF\b/.test(cat[1])) throw Error('embedSource: unexpected catalog');

  const src = enc.encode(meta.source);
  const nFile = size, nSpec = size + 1, nInfo = size + 2;
  const name = pdfString(meta.filename || 'score.abc');
  const info = [
    meta.title && `/Title ${pdfString(meta.title)}`,
    meta.author && `/Author ${pdfString(meta.author)}`,
    meta.subject && `/Subject ${pdfString(meta.subject)}`,
    meta.keywords && `/Keywords ${pdfString(meta.keywords)}`,
    `/Creator ${pdfString(meta.creator || 'ArtColony sheet_music')}`,
    '/Producer (pscat)',
  ].filter(Boolean).join(' ');

  const parts = [];
  let offset = pdf.length;
  const offsets = {};
  const push = (bytes) => { parts.push(bytes); offset += bytes.length; };
  if (pdf[pdf.length - 1] !== 0x0a) push(ascii('\n'));
  offsets[root] = offset;
  push(ascii(`${root} 0 obj\n<<${cat[1].replace(/\s+$/, '')} /Names << /EmbeddedFiles << /Names [${name} ${nSpec} 0 R] >> >> /AF [${nSpec} 0 R] >>\nendobj\n`));
  offsets[nFile] = offset;
  push(ascii(`${nFile} 0 obj\n<< /Type /EmbeddedFile /Subtype ${mimeName(meta.mime || 'text/plain')} /Length ${src.length} /Params << /Size ${src.length} >> >>\nstream\n`));
  push(src);
  push(ascii('\nendstream\nendobj\n'));
  offsets[nSpec] = offset;
  push(ascii(`${nSpec} 0 obj\n<< /Type /Filespec /F ${name} /UF ${name} /EF << /F ${nFile} 0 R >> /Desc (Source of this score: open it in the sheet_music editor) /AFRelationship /Source >>\nendobj\n`));
  offsets[nInfo] = offset;
  push(ascii(`${nInfo} 0 obj\n<< ${info} >>\nendobj\n`));

  const entry = (n) => String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  const xref = offset;
  push(ascii(`xref\n0 1\n0000000000 65535 f \n${root} 1\n${entry(root)}${nFile} 3\n${entry(nFile)}${entry(nSpec)}${entry(nInfo)}` +
    `trailer\n<< /Size ${size + 3} /Root ${root} 0 R /Info ${nInfo} 0 R /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`));

  const out = new Uint8Array(offset);
  out.set(pdf, 0);
  let at = pdf.length;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** The source embedded by embedSource(): { filename, text }, or null. */
export function extractSource(pdf) {
  const text = latin1(pdf);
  const m = /\/Type \/EmbeddedFile\b[^]*?\/Length (\d+)[^]*?>>\s*stream\r?\n/.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const body = pdf.subarray(start, start + parseInt(m[1], 10));
  const f = /\/Type \/Filespec \/F \(((?:\\.|[^\\)])*)\)/.exec(text);
  const filename = f ? f[1].replace(/\\(.)/g, '$1') : 'score.abc';
  return { filename, text: new TextDecoder().decode(body) };
}

/** True if the bytes look like a PDF. */
export const isPDF = (bytes) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
