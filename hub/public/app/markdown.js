// Markdown for the brain, written for it. Two steps, kept apart on purpose:
//
//   parseMarkdown(text) reads a note into a plain tree. No DOM, so a test can
//   read it in node.
//   renderDocument(doc, opts) turns that tree into DOM through h(), where a
//   string can only ever become a text node. No note can run script, because
//   there is no path from note text to markup.
//
// renderMarkdown(text, opts) does both. opts can hold:
//   resolveLink(href)  a string, { href, broken }, or null for plain text
//   resolveImage(src)  a string, { src }, { secure: url }, or null for a link
//   wikilink(name)     { href, label, broken }, or null for plain text
//   sourceLink(ref)    the href for a claim's mission or record, or null
//
// Time is linear in the size of the note, whatever is in it. Nesting is capped,
// every scan that could restart stops at something that can't repeat forever,
// and the patterns below never backtrack over more than one line's run.

import { h } from './dom.js';

const MAX_BLOCK_DEPTH = 16;
const MAX_INLINE_DEPTH = 24;
const MAX_PARENS = 32;
const MAX_URL = 4096;
const MAX_LABEL = 999;
const MAX_WIKILINK = 512;
const MAX_COLUMNS = 64;
const MAX_PADDED_CELLS = 20000;

// A claim's long-form fields, as in docs/brain-format.md and hub/lib/claims.js.
const CLAIM_FIELDS = new Set(['source', 'belief', 'volatility', 'verified', 'pinned', 'contradicts', 'supersedes', 'believed-until', 'evidence', 'by', 'mission', 'at', 'confidence', 'tags']);
const REF_RE = /^(j-[a-z0-9]{8}|t-\d+|\[\[[^\]]+\]\])$/;

const normalize = (text) => {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.includes('\r')) s = s.replace(/\r\n?/g, '\n');
  if (s.includes('\0')) s = s.replace(/\0/g, '\uFFFD');
  return s;
};

// ---- frontmatter ----

// The same reading as hub/lib/claims.js: "key: value" lines between two "---"
// lines at the top, values as strings. A note with no closing line has none.
export function splitFrontmatter(input) {
  const text = normalize(input);
  const none = { frontmatter: {}, body: text, raw: '', bodyLine: 1 };
  if (!text.startsWith('---\n')) return none;
  let end = -1;
  let closeEnd = -1;
  for (let at = 3; at !== -1 && at < text.length;) {
    const next = text.indexOf('\n', at + 1);
    const line = text.slice(at + 1, next === -1 ? text.length : next);
    if (line === '---') { end = at; closeEnd = next === -1 ? text.length : next + 1; break; }
    at = next;
  }
  if (end === -1) return none;
  const raw = text.slice(4, end);
  const frontmatter = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (m) frontmatter[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { frontmatter, body: text.slice(closeEnd), raw, bodyLine: raw.split('\n').length + 3 };
}

// ---- links ----

// Only http(s), mailto, relative paths and anchors. What a browser ignores
// inside a URL (tabs, newlines, control characters at the ends) is taken out
// first, so "java\tscript:" is seen as what it would really be.
export function safeHref(raw) {
  const value = String(raw ?? '');
  if (value.length > MAX_URL) return null;
  const s = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  if (!s) return null;
  if ((s[0] === '/' || s[0] === '\\') && (s[1] === '/' || s[1] === '\\')) return null;
  let cut = s.length;
  for (const c of '/?#') {
    const at = s.indexOf(c);
    if (at !== -1 && at < cut) cut = at;
  }
  const colon = s.indexOf(':');
  if (colon === -1 || colon >= cut) return s;
  const scheme = s.slice(0, colon).toLowerCase();
  if (scheme === 'mailto') return s;
  if ((scheme === 'http' || scheme === 'https') && s.startsWith('//', colon + 1)) return s;
  return null;
}

// ---- block structure ----

function indentOf(line) {
  let n = 0;
  while (line.charCodeAt(n) === 32) n++;
  return n;
}
const isBlank = (line) => line.trim() === '';

function splitLines(body) {
  return body.split('\n').map((line) => {
    if (line[0] !== '\t' && !(line[0] === ' ' && line.includes('\t'))) return line;
    let i = 0;
    let col = 0;
    for (; i < line.length; i++) {
      if (line[i] === ' ') col++;
      else if (line[i] === '\t') col += 4 - (col % 4);
      else break;
    }
    return ' '.repeat(col) + line.slice(i);
  });
}

function isHr(t) {
  const c = t[0];
  if (c !== '-' && c !== '*' && c !== '_') return false;
  let count = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === c) count++;
    else if (t[i] !== ' ') return false;
  }
  return count >= 3;
}

function headingOf(t) {
  if (t[0] !== '#') return null;
  let n = 0;
  while (t[n] === '#') n++;
  if (n > 6 || (n < t.length && t[n] !== ' ')) return null;
  let text = t.slice(n).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end === 0) text = '';
  else if (end < text.length && text[end - 1] === ' ') text = text.slice(0, end).trimEnd();
  return { level: n, text };
}

function fenceOf(t) {
  const c = t[0];
  if (c !== '`' && c !== '~') return null;
  let n = 0;
  while (t[n] === c) n++;
  if (n < 3) return null;
  const info = t.slice(n).trim();
  if (c === '`' && info.includes('`')) return null;
  return { char: c, size: n, info };
}

function isFenceClose(line, fence) {
  const ind = indentOf(line);
  if (ind >= 4 || line[ind] !== fence.char) return false;
  let n = ind;
  while (line[n] === fence.char) n++;
  return n - ind >= fence.size && isBlank(line.slice(n));
}

function markerOf(line, ind) {
  const c = line[ind];
  let end;
  let ordered = false;
  let start = 1;
  let kind = c;
  if (c === '-' || c === '+' || c === '*') {
    end = ind + 1;
  } else if (c >= '0' && c <= '9') {
    let n = ind;
    while (n - ind < 9 && line[n] >= '0' && line[n] <= '9') n++;
    if (line[n] !== '.' && line[n] !== ')') return null;
    ordered = true;
    start = Number(line.slice(ind, n));
    kind = line[n];
    end = n + 1;
  } else {
    return null;
  }
  if (end < line.length && line[end] !== ' ') return null;
  let spaces = 0;
  while (line[end + spaces] === ' ') spaces++;
  const empty = end + spaces >= line.length;
  const pad = empty || spaces >= 5 ? 1 : spaces;
  return { ordered, start, kind, offset: end + pad, empty };
}

// Can this line cut a paragraph short?
function startsBlock(line) {
  const ind = indentOf(line);
  if (ind >= 4 || ind >= line.length) return false;
  const t = ind ? line.slice(ind) : line;
  if (t[0] === '>' || headingOf(t) || fenceOf(t) || isHr(t)) return true;
  const m = markerOf(line, ind);
  return !!m && !m.empty && (!m.ordered || m.start === 1);
}

function splitRow(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s.length && s[s.length - 1] === '|' && s[s.length - 2] !== '\\') s = s.slice(0, -1);
  const cells = [];
  let cell = '';
  let wikilinks = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cell += '|'; i++; continue; }
    if (wikilinks && c === '[' && s[i + 1] === '[') {
      // A pipe inside [[name|label]] doesn't end a cell.
      const close = s.indexOf(']]', i);
      if (close === -1) wikilinks = false;
      else { cell += s.slice(i, close + 2); i = close + 1; continue; }
    }
    if (c === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function delimiterRow(line) {
  const t = line.trim();
  if (!t || (t[0] !== '|' && t[0] !== '-' && t[0] !== ':')) return null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c !== '|' && c !== '-' && c !== ':' && c !== ' ') return null;
  }
  const cells = splitRow(t);
  if (cells.length > MAX_COLUMNS) return null;
  const align = [];
  for (const cell of cells) {
    let a = 0;
    let b = cell.length;
    const left = cell[a] === ':';
    if (left) a++;
    const right = b > a && cell[b - 1] === ':';
    if (right) b--;
    if (a >= b) return null;
    for (let i = a; i < b; i++) if (cell[i] !== '-') return null;
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return align;
}

function referenceOf(t, refs) {
  let close = 1;
  while (close < t.length && close <= MAX_LABEL && t[close] !== ']' && t[close] !== '[') {
    close += t[close] === '\\' ? 2 : 1;
  }
  if (t[close] !== ']' || close < 2 || t[close + 1] !== ':' || t[1] === '^') return false;
  const rest = t.slice(close + 2).trim();
  if (!rest) return false;
  let url;
  let tail;
  if (rest[0] === '<') {
    const end = rest.indexOf('>');
    if (end === -1) return false;
    url = rest.slice(1, end);
    tail = rest.slice(end + 1).trim();
  } else {
    const end = rest.indexOf(' ');
    url = end === -1 ? rest : rest.slice(0, end);
    tail = end === -1 ? '' : rest.slice(end + 1).trim();
  }
  let title = '';
  if (tail) {
    const q = tail[0];
    const closing = q === '(' ? ')' : q;
    if ((q !== '"' && q !== "'" && q !== '(') || tail.length < 2 || tail[tail.length - 1] !== closing) return false;
    title = tail.slice(1, -1);
  }
  const key = t.slice(1, close).trim().toLowerCase();
  if (!refs.has(key)) refs.set(key, { href: safeHref(url), title });
  return true;
}

// lines belong to one container. Each level hands its children a new, shorter
// set of lines, and levels stop at MAX_BLOCK_DEPTH, so a note is read at most
// that many times over, however it nests.
function parseBlocks(lines, ctx, depth) {
  const blocks = [];
  const canNest = depth < MAX_BLOCK_DEPTH;
  let para = null;
  let gap = false;
  let sawBlank = false;

  const push = (node) => {
    if (blocks.length && sawBlank) gap = true;
    sawBlank = false;
    blocks.push(node);
  };
  const flush = () => {
    if (!para) return;
    para[para.length - 1] = para[para.length - 1].trimEnd();
    push({ type: 'paragraph', raw: para.join('\n') });
    para = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      flush();
      sawBlank = true;
      i++;
      continue;
    }
    const ind = indentOf(line);

    if (ind >= 4) {
      if (para) { para.push(line.trimStart()); i++; continue; }
      const code = [];
      while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) >= 4)) code.push(lines[i++].slice(4));
      while (code.length && isBlank(code[code.length - 1])) code.pop();
      push({ type: 'code', lang: '', text: code.join('\n') });
      continue;
    }

    const t = ind ? line.slice(ind) : line;

    const fence = fenceOf(t);
    if (fence) {
      flush();
      i++;
      const code = [];
      while (i < lines.length && !isFenceClose(lines[i], fence)) {
        const l = lines[i++];
        code.push(l.slice(Math.min(ind, indentOf(l))));
      }
      i++;
      const lang = fence.info.split(' ', 1)[0].slice(0, 40);
      push({ type: 'code', lang: /^[\w+#.-]*$/.test(lang) ? lang : '', text: code.join('\n') });
      continue;
    }

    const head = headingOf(t);
    if (head) {
      flush();
      push({ type: 'heading', level: head.level, raw: head.text });
      i++;
      continue;
    }

    if (para && (t[0] === '=' || t[0] === '-')) {
      const body = t.trimEnd();
      let same = true;
      for (let k = 0; k < body.length; k++) if (body[k] !== t[0]) { same = false; break; }
      if (same) {
        const raw = para.join('\n').trimEnd();
        para = null;
        push({ type: 'heading', level: t[0] === '=' ? 1 : 2, raw });
        i++;
        continue;
      }
    }

    if (isHr(t)) {
      flush();
      push({ type: 'hr' });
      i++;
      continue;
    }

    if (t[0] === '>' && canNest) {
      flush();
      const inner = [];
      while (i < lines.length) {
        const l = lines[i];
        const k = indentOf(l);
        if (k < 4 && l[k] === '>') {
          inner.push(l[k + 1] === ' ' ? l.slice(k + 2) : l.slice(k + 1));
          i++;
        } else if (!isBlank(l) && inner.length && !isBlank(inner[inner.length - 1]) && !startsBlock(l)) {
          inner.push(l);
          i++;
        } else {
          break;
        }
      }
      push({ type: 'blockquote', children: parseBlocks(inner, ctx, depth + 1).blocks });
      continue;
    }

    const marker = canNest ? markerOf(line, ind) : null;
    if (marker && (!para || (!marker.empty && (!marker.ordered || marker.start === 1)))) {
      flush();
      const list = { type: 'list', ordered: marker.ordered, start: marker.start, tight: true, items: [], indent: ind, kind: marker.kind };
      while (i < lines.length) {
        const l = lines[i];
        const k = indentOf(l);
        const m = k < 4 ? markerOf(l, k) : null;
        if (!m || m.ordered !== marker.ordered || m.kind !== marker.kind || isHr(l.slice(k))) break;
        const itemLines = [l.slice(m.offset)];
        i++;
        while (i < lines.length) {
          const n = lines[i];
          if (isBlank(n)) { itemLines.push(''); i++; continue; }
          if (indentOf(n) >= m.offset) { itemLines.push(n.slice(m.offset)); i++; continue; }
          const nk = indentOf(n);
          const nm = nk < 4 ? markerOf(n, nk) : null;
          const sibling = nm && nm.ordered === marker.ordered && nm.kind === marker.kind;
          if (!sibling && !isBlank(itemLines[itemLines.length - 1]) && !startsBlock(n)) { itemLines.push(n.trimStart()); i++; continue; }
          break;
        }
        let trailing = 0;
        while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) { itemLines.pop(); trailing++; }
        const parsed = parseBlocks(itemLines, ctx, depth + 1);
        if (parsed.gap) list.tight = false;
        if (trailing && i < lines.length) {
          const n = lines[i];
          const nk = indentOf(n);
          const nm = nk < 4 ? markerOf(n, nk) : null;
          if (nm && nm.ordered === marker.ordered && nm.kind === marker.kind) list.tight = false;
        }
        list.items.push({ children: parsed.blocks, task: null, claim: null });
      }
      push(list);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length) {
      const align = delimiterRow(lines[i + 1]);
      if (align) {
        const head = splitRow(line);
        if (head.length === align.length) {
          flush();
          i += 2;
          const rows = [];
          while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) rows.push(splitRow(lines[i++]));
          const pad = rows.length * align.length <= MAX_PADDED_CELLS;
          for (const row of rows) {
            if (row.length > align.length) row.length = align.length;
            while (pad && row.length < align.length) row.push('');
          }
          push({ type: 'table', align, head: head.map((raw) => ({ raw })), rows: rows.map((row) => row.map((raw) => ({ raw }))) });
          continue;
        }
      }
    }

    if (!para && t[0] === '[' && referenceOf(t, ctx.refs)) {
      i++;
      continue;
    }

    if (para) para.push(t);
    else para = [t];
    i++;
  }
  flush();
  return { blocks, gap };
}

// ---- inline ----

const SPECIAL = new Uint8Array(128);
for (const c of '\\`*_~[]!<\nhw#') SPECIAL[c.charCodeAt(0)] = 1;

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (ch) => /\s/.test(ch);
const isPunct = (ch) => /[\p{P}\p{S}]/u.test(ch);

function charBefore(s, i) {
  if (i <= 0) return '\n';
  const low = s.charCodeAt(i - 1);
  if (low >= 0xDC00 && low <= 0xDFFF && i >= 2) return s.slice(i - 2, i);
  return s[i - 1];
}
function charAfter(s, i) {
  if (i >= s.length) return '\n';
  const high = s.charCodeAt(i);
  if (high >= 0xD800 && high <= 0xDBFF && i + 1 < s.length) return s.slice(i, i + 2);
  return s[i];
}

function tickRuns(src) {
  const runs = new Map();
  for (let i = src.indexOf('`'); i !== -1;) {
    let j = i;
    while (src[j] === '`') j++;
    let run = runs.get(j - i);
    if (!run) { run = { at: [], next: 0 }; runs.set(j - i, run); }
    run.at.push(i);
    i = src.indexOf('`', j);
  }
  return runs;
}
function closingTick(runs, size, after) {
  const run = runs.get(size);
  if (!run) return -1;
  while (run.next < run.at.length && run.at[run.next] < after) run.next++;
  return run.next < run.at.length ? run.at[run.next] : -1;
}

function unescape(s) {
  if (!s.includes('\\')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && ASCII_PUNCT.test(s[i + 1])) { out += s[i + 1]; i++; } else out += s[i];
  }
  return out;
}

function inlineText(nodes) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text' || n.t === 'code') out += n.v;
    else if (n.t === 'softbreak' || n.t === 'hardbreak') out += ' ';
    else if (n.t === 'image') out += n.alt;
    else if (n.t === 'wikilink') out += n.label || n.target;
    else if (n.t === 'tag') out += `#${n.name}`;
    else if (n.children) out += inlineText(n.children);
  }
  return out;
}

function parseInline(src, ctx, opts = {}) {
  const len = src.length;
  let head = null;
  let tail = null;
  let delims = null; // newest delimiter run
  let brackets = null; // newest open bracket
  let runs = null;
  let overflow = null; // the last span that was already too deep
  const missing = {}; // quote character -> no closing one at or after this index

  const append = (n) => {
    n.prev = tail;
    n.next = null;
    if (tail) tail.next = n;
    else head = n;
    tail = n;
    return n;
  };
  const text = (v) => append({ t: 'text', v });
  const unlink = (n) => {
    if (n.prev) n.prev.next = n.next;
    else head = n.next;
    if (n.next) n.next.prev = n.prev;
    else tail = n.prev;
  };
  const dropDelim = (d) => {
    if (d.prev) d.prev.next = d.next;
    if (d.next) d.next.prev = d.prev;
    else delims = d.prev;
  };

  // Moves the nodes between two ends (exclusive) into an array. Each node is
  // moved once in its life, so this stays linear however often it runs.
  function collect(from, to) {
    const out = [];
    let depth = 0;
    let n = from ? from.next : head;
    while (n && n !== to) {
      const next = n.next;
      depth = Math.max(depth, n.depth || 0);
      n.prev = null;
      n.next = null;
      out.push(n);
      n = next;
    }
    return { list: tidy(out), depth };
  }

  function tidy(nodes) {
    const out = [];
    for (const n of nodes) {
      delete n.prev;
      delete n.next;
      const last = out[out.length - 1];
      if (n.t === 'text' && last && last.t === 'text') last.v += n.v;
      else if (n.t !== 'text' || n.v !== '') out.push(n);
    }
    return out;
  }

  function childDepth(from, to) {
    let depth = 0;
    for (let n = from.next; n && n !== to; n = n.next) depth = Math.max(depth, n.depth || 0);
    return depth;
  }

  function processEmphasis(bottom) {
    const floor = { '*': [bottom, bottom, bottom, bottom, bottom, bottom], _: [bottom, bottom, bottom, bottom, bottom, bottom], '~': [bottom] };
    if (!delims) return;
    let closer;
    if (bottom === null) {
      closer = delims;
      while (closer.prev) closer = closer.prev;
    } else {
      closer = bottom.next;
    }
    while (closer) {
      if (!closer.close) { closer = closer.next; continue; }
      const slot = closer.char === '~' ? 0 : (closer.open ? 3 : 0) + (closer.orig % 3);
      let opener = closer.prev;
      let found = false;
      while (opener && opener !== bottom && opener !== floor[closer.char][slot]) {
        const odd = closer.char !== '~' && (closer.open || opener.close) && closer.orig % 3 !== 0 && (opener.orig + closer.orig) % 3 === 0;
        if (opener.char === closer.char && opener.open && !odd) { found = true; break; }
        opener = opener.prev;
      }
      if (!found) {
        floor[closer.char][slot] = closer.prev;
        const next = closer.next;
        if (!closer.open) dropDelim(closer);
        closer = next;
        continue;
      }

      const deep = overflow && opener.pos <= overflow.start && closer.pos >= overflow.end;
      if (deep || childDepth(opener.node, closer.node) >= MAX_INLINE_DEPTH) {
        // Deeper than anyone writes. The markers stay in the text as written.
        overflow = { start: opener.pos, end: closer.pos };
        opener.next = closer;
        closer.prev = opener;
        const next = closer.next;
        dropDelim(closer);
        dropDelim(opener);
        closer = next;
        continue;
      }

      const use = closer.char === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
      opener.count -= use;
      closer.count -= use;
      opener.node.v = opener.node.v.slice(0, opener.count);
      closer.node.v = closer.node.v.slice(0, closer.count);
      opener.next = closer;
      closer.prev = opener;

      const { list, depth } = collect(opener.node, closer.node);
      const wrap = { t: closer.char === '~' ? 'del' : use === 2 ? 'strong' : 'em', children: list, depth: depth + 1 };
      opener.node.next = wrap;
      wrap.prev = opener.node;
      wrap.next = closer.node;
      closer.node.prev = wrap;

      if (opener.count === 0) {
        unlink(opener.node);
        dropDelim(opener);
      }
      if (closer.count === 0) {
        unlink(closer.node);
        const next = closer.next;
        dropDelim(closer);
        closer = next;
      }
    }
    // Whatever is left above the bottom can't match any more.
    if (bottom === null) delims = null;
    else { bottom.next = null; delims = bottom; }
  }

  function destination(from) {
    let i = from + 1;
    while (i < len && (src[i] === ' ' || src[i] === '\n')) i++;
    let href = '';
    if (src[i] === '<') {
      let k = i + 1;
      while (k < len && k - i <= MAX_URL && src[k] !== '>' && src[k] !== '<' && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      if (src[k] !== '>') return null;
      href = src.slice(i + 1, k);
      i = k + 1;
    } else {
      let parens = 0;
      let k = i;
      while (k < len) {
        const c = src.charCodeAt(k);
        if (c <= 32 || c === 127) break;
        if (c === 92 && k + 1 < len) { k += 2; continue; }
        if (c === 40) { if (++parens > MAX_PARENS) return null; } else if (c === 41) { if (parens === 0) break; parens--; }
        k++;
      }
      if (parens !== 0 || k - i > MAX_URL) return null;
      href = src.slice(i, k);
      i = k;
    }
    while (i < len && (src[i] === ' ' || src[i] === '\n')) i++;
    let title = '';
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      if (missing[q] !== undefined && i + 1 >= missing[q]) return null;
      let k = i + 1;
      for (;;) {
        k = src.indexOf(q, k);
        if (k === -1) { missing[q] = i + 1; return null; }
        if (src[k - 1] !== '\\') break;
        k++;
      }
      title = unescape(src.slice(i + 1, k));
      i = k + 1;
      while (i < len && (src[i] === ' ' || src[i] === '\n')) i++;
    }
    if (src[i] !== ')') return null;
    return { href: unescape(href), title, end: i + 1 };
  }

  function referenceAfter(at, open) {
    if (ctx.refs.size === 0) return null;
    let label = '';
    let end = at;
    if (src[at] === '[') {
      let k = at + 1;
      while (k < len && k - at <= MAX_LABEL && src[k] !== ']' && src[k] !== '[' && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      if (src[k] !== ']') return null;
      label = src.slice(at + 1, k);
      end = k + 1;
    }
    if (!label && at - open > MAX_LABEL) return null;
    const ref = ctx.refs.get((label || src.slice(open + 1, at - 1)).trim().toLowerCase());
    return ref ? { href: ref.href, title: ref.title, end, rejected: ref.href === null } : null;
  }

  // Returns where to carry on and whether a node was made. When none was, the
  // source up to there is still in the running text: a refused link stays
  // text, the whole of it.
  function closeBracket(i) {
    const literal = { end: i + 1, made: false };
    const opener = brackets;
    if (!opener) return literal;
    brackets = opener.prev;
    if (!opener.active) return literal;
    const found = src[i + 1] === '(' ? destination(i + 1) : null;
    const target = found || referenceAfter(i + 1, opener.pos);
    if (!target) return literal;
    if (opener.level >= MAX_INLINE_DEPTH) return { end: target.end, made: false };
    const href = target.rejected ? null : safeHref(target.href);
    if (!href) return { end: target.end, made: false };

    processEmphasis(opener.delims);
    const { list, depth } = collect(opener.node, null);
    opener.node.next = null;
    tail = opener.node;
    unlink(opener.node);
    let node;
    if (opener.image) {
      node = { t: 'image', src: href, alt: inlineText(list), title: target.title, depth: depth + 1 };
      ctx.links.push({ kind: 'image', href });
    } else {
      node = { t: 'link', href, title: target.title, children: list, depth: depth + 1 };
      ctx.links.push({ kind: 'link', href });
      for (let b = brackets; b; b = b.prev) if (!b.image) b.active = false;
    }
    append(node);
    return { end: target.end, made: true };
  }

  // A plain URL in running text. Returns { end, href, url } or null, and
  // changes nothing.
  function bareUrl(i) {
    const before = i > 0 ? src.charCodeAt(i - 1) : 32;
    if ((before >= 48 && before <= 57) || (before >= 65 && before <= 90) || (before >= 97 && before <= 122)) return null;
    const www = src[i] === 'w';
    if (www ? !src.startsWith('www.', i) : !src.startsWith('http://', i) && !src.startsWith('https://', i)) return null;
    let k = i;
    let open = 0;
    let shut = 0;
    while (k < len && k - i < MAX_URL) {
      const c = src.charCodeAt(k);
      if (c <= 32 || c === 127 || c === 60) break;
      if (c === 40) open++;
      else if (c === 41) shut++;
      k++;
    }
    let end = k;
    for (; end > i; end--) {
      const c = src[end - 1];
      if ('?!.,:;*_~\'"'.includes(c)) continue;
      if (c === ')' && shut > open) { shut--; continue; }
      break;
    }
    const url = src.slice(i, end);
    if (url.length < (www ? 5 : 9)) return null;
    const href = safeHref(www ? `https://${url}` : url);
    return href ? { end, href, url } : null;
  }

  function angleLink(i) {
    let k = i + 1;
    while (k < len && k - i <= MAX_URL) {
      const c = src.charCodeAt(k);
      if (c <= 32 || c === 60 || c === 62) break;
      k++;
    }
    if (src[k] !== '>') return -1;
    const inner = src.slice(i + 1, k);
    const email = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(inner);
    const absolute = /^(https?:\/\/|mailto:)/i.test(inner);
    if (!email && !absolute) return -1;
    const href = safeHref(email ? `mailto:${inner}` : inner);
    if (!href) return -1;
    if (brackets) { text(inner); return k + 1; }
    append({ t: 'link', href, title: '', children: [{ t: 'text', v: inner }], depth: 1 });
    ctx.links.push({ kind: 'link', href });
    return k + 1;
  }

  function wikilinkAt(i) {
    let k = i + 2;
    while (k < len && k - i <= MAX_WIKILINK && src[k] !== ']' && src[k] !== '[' && src[k] !== '\n') k++;
    if (src[k] !== ']' || src[k + 1] !== ']' || k === i + 2) return -1;
    const inner = src.slice(i + 2, k);
    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const label = bar === -1 ? '' : inner.slice(bar + 1).trim();
    if (!target) return -1;
    append({ t: 'wikilink', target, label });
    ctx.links.push({ kind: 'wikilink', target });
    return k + 2;
  }

  let i = 0;
  let start = 0;
  const flushText = (end) => { if (end > start) text(src.slice(start, end)); };

  while (i < len) {
    const code = src.charCodeAt(i);
    if (code >= 128 || !SPECIAL[code]) { i++; continue; }
    const c = src[i];

    if (c === '\n') {
      let e = i;
      while (e > start && src[e - 1] === ' ') e--;
      flushText(e);
      append({ t: i - e >= 2 ? 'hardbreak' : 'softbreak' });
      i++;
      while (i < len && src[i] === ' ') i++;
      start = i;
    } else if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        flushText(i);
        append({ t: 'hardbreak' });
        i += 2;
        while (i < len && src[i] === ' ') i++;
        start = i;
      } else if (next !== undefined && ASCII_PUNCT.test(next)) {
        flushText(i);
        text(next);
        i += 2;
        start = i;
      } else {
        i++;
      }
    } else if (c === '`') {
      let e = i;
      while (src[e] === '`') e++;
      const size = e - i;
      if (!runs) runs = tickRuns(src);
      const close = closingTick(runs, size, e);
      if (close === -1) {
        i = e;
      } else {
        flushText(i);
        let v = src.slice(e, close).replace(/\n/g, ' ');
        if (v.length > 1 && v[0] === ' ' && v[v.length - 1] === ' ' && v.trim() !== '') v = v.slice(1, -1);
        append({ t: 'code', v });
        i = close + size;
        start = i;
      }
    } else if (c === '*' || c === '_' || c === '~') {
      let e = i;
      while (src[e] === c) e++;
      const count = e - i;
      if (c === '~' && count !== 2) { i = e; continue; }
      const before = charBefore(src, i);
      const after = charAfter(src, e);
      const wsBefore = isWs(before);
      const wsAfter = isWs(after);
      const punctBefore = isPunct(before);
      const punctAfter = isPunct(after);
      const left = !wsAfter && (!punctAfter || wsBefore || punctBefore);
      const right = !wsBefore && (!punctBefore || wsAfter || punctAfter);
      const open = c === '_' ? left && (!right || punctBefore) : left;
      const close = c === '_' ? right && (!left || punctAfter) : right;
      flushText(i);
      const node = text(src.slice(i, e));
      if (open || close) {
        const d = { char: c, count, orig: count, open, close, node, pos: i, prev: delims, next: null };
        if (delims) delims.next = d;
        delims = d;
      }
      i = e;
      start = i;
    } else if (c === '[') {
      flushText(i);
      start = i;
      if (src[i + 1] === '[') {
        const end = wikilinkAt(i);
        if (end !== -1) { i = end; start = i; continue; }
      }
      const node = text('[');
      brackets = { node, image: false, active: true, pos: i, prev: brackets, delims, level: brackets ? brackets.level + 1 : 0 };
      i++;
      start = i;
    } else if (c === '!' && src[i + 1] === '[') {
      flushText(i);
      const node = text('![');
      brackets = { node, image: true, active: true, pos: i + 1, prev: brackets, delims, level: brackets ? brackets.level + 1 : 0 };
      i += 2;
      start = i;
    } else if (c === ']') {
      flushText(i);
      start = i;
      const { end, made } = closeBracket(i);
      i = end;
      if (made) start = i;
    } else if (c === '<') {
      flushText(i);
      start = i;
      const end = angleLink(i);
      if (end === -1) { i++; } else { i = end; start = i; }
    } else if (c === 'h' || c === 'w') {
      const url = brackets ? null : bareUrl(i);
      if (url) {
        flushText(i);
        append({ t: 'link', href: url.href, title: '', children: [{ t: 'text', v: url.url }], depth: 1 });
        ctx.links.push({ kind: 'link', href: url.href });
        i = url.end;
        start = i;
      } else {
        i++;
      }
    } else if (c === '#' && opts.tags) {
      const prev = i === 0 ? ' ' : src[i - 1];
      let e = i + 1;
      while (e < len && /[a-z0-9-]/.test(src[e])) e++;
      const name = src.slice(i + 1, e);
      if (isWs(prev) && name && name[0] !== '-' && (e === len || isWs(src[e]))) {
        flushText(i);
        append({ t: 'tag', name });
        ctx.tagSink.push(name);
        i = e;
        start = i;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  flushText(len);
  processEmphasis(null);

  const out = [];
  for (let n = head; n; n = n.next) out.push(n);
  return tidy(out);
}

// ---- claims ----

// The grammar from hub/lib/claims.js, read off the tree: a top-level "- [kind]"
// item, with a trailing ^id, an optional (source: ...) group, and either #tags
// in the text or the long form's field list right under it.
function sourceGroups(line) {
  const out = [];
  for (let at = 0; ;) {
    const open = line.indexOf('(source:', at);
    if (open === -1) return out;
    const close = line.indexOf(')', open);
    if (close === -1) return out;
    out.push({ start: open, end: close + 1, body: line.slice(open + 8, close).trimStart() });
    at = close + 1;
  }
}

const toRef = (r) => (r.startsWith('[[')
  ? { ref: r.slice(2, -2), type: 'wikilink' }
  : { ref: r, type: r.startsWith('j-') ? 'record' : 'mission' });
const splitRefs = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);

function takeId(text) {
  const c = text.lastIndexOf(' ^c-');
  const j = text.lastIndexOf(' ^j-');
  const at = Math.max(c, j);
  if (at === -1) return { id: null, rest: text };
  let end = at + 2;
  while (end < text.length && !isWs(text[end])) end++;
  return { id: text.slice(at + 2, end), rest: (text.slice(0, at) + text.slice(end)).trimEnd() };
}

function fieldsOf(list) {
  if (!list || list.type !== 'list' || list.ordered) return null;
  const fields = {};
  for (const item of list.items) {
    if (item.children.length !== 1 || item.children[0].type !== 'paragraph') return null;
    const raw = item.children[0].raw;
    const colon = raw.indexOf(':');
    if (colon < 1) return null;
    const key = raw.slice(0, colon);
    if (!CLAIM_FIELDS.has(key)) return null;
    fields[key] = raw.slice(colon + 1).trim();
  }
  return list.items.length ? fields : null;
}

function readClaim(item) {
  const first = item.children[0];
  if (!first || first.type !== 'paragraph' || first.raw[0] !== '[') return null;
  const flat = first.raw.includes('\n') ? first.raw.replace(/\n/g, ' ') : first.raw;
  const close = flat.indexOf(']');
  if (close < 2 || flat[close + 1] !== ' ') return null;
  const kind = flat.slice(1, close);
  if (!/^[A-Za-z0-9_-]+$/.test(kind)) return null;

  const { id, rest } = takeId(flat.slice(close + 2));
  const fields = fieldsOf(item.children[1]);
  const claim = { kind, id, form: fields ? 'long' : 'short', text: rest, sources: [], note: null, fields: fields || {}, tags: [] };
  if (fields) {
    if (fields.source) claim.sources = splitRefs(fields.source).filter((r) => REF_RE.test(r)).map(toRef);
    if (fields.tags) claim.tags = fields.tags.split(/\s+/).filter((t) => /^#[a-z0-9][a-z0-9-]*$/.test(t)).map((t) => t.slice(1));
    item.children.splice(1, 1);
  } else {
    for (const g of sourceGroups(rest)) {
      const refs = splitRefs(g.body);
      if (!refs.length || !refs.every((r) => REF_RE.test(r))) continue;
      claim.sources = refs.map(toRef);
      claim.text = rest.slice(0, g.start).trimEnd();
      claim.note = rest.slice(g.end).trim() || null;
      break;
    }
  }
  item.children.shift();
  return claim;
}

function readTask(item) {
  const first = item.children[0];
  if (!first || first.type !== 'paragraph') return;
  const r = first.raw;
  if (r[0] !== '[' || r[2] !== ']' || (r[1] !== ' ' && r[1] !== 'x' && r[1] !== 'X')) return;
  if (r.length > 3 && !isWs(r[3])) return;
  // The hub reads "- [x]" as a claim of kind x and may give it an id.
  const { id, rest } = takeId(r.slice(3).trimStart());
  item.task = { checked: r[1] !== ' ', id };
  first.raw = rest;
}

// ---- the second pass: inlines, ids, claims ----

// The anchor a heading gets. The brain page uses it for "#Some Heading" in a
// wikilink too.
export function slugify(text) {
  return String(text).slice(0, 80).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}

function slugger() {
  const used = new Set(['main', 'app']); // the shell's own ids
  const counts = new Map();
  return (text) => {
    const base = slugify(text);
    let n = counts.get(base) || 0;
    let slug = n ? `${base}-${n}` : base;
    while (used.has(slug)) { n++; slug = `${base}-${n}`; }
    counts.set(base, n + 1);
    used.add(slug);
    return slug;
  };
}

function finish(blocks, ctx, top) {
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      b.children = parseInline(b.raw, ctx);
    } else if (b.type === 'heading') {
      b.children = parseInline(b.raw, ctx);
      b.text = inlineText(b.children).trim();
      b.id = ctx.slug(b.text);
      if (top) ctx.headings.push({ level: b.level, text: b.text, id: b.id });
    } else if (b.type === 'blockquote') {
      finish(b.children, ctx, false);
    } else if (b.type === 'table') {
      for (const cell of b.head) cell.children = parseInline(cell.raw, ctx);
      for (const row of b.rows) for (const cell of row) cell.children = parseInline(cell.raw, ctx);
    } else if (b.type === 'list') {
      for (const item of b.items) {
        readTask(item);
        if (top && !item.task && b.kind === '-' && b.indent === 0) {
          const claim = readClaim(item);
          if (claim) {
            const tags = [];
            ctx.tagSink = tags;
            claim.children = parseInline(claim.text, ctx, { tags: claim.form === 'short' });
            if (claim.form === 'short') claim.tags = [...new Set(tags)];
            if (claim.note) claim.noteChildren = parseInline(claim.note, ctx);
            for (const s of claim.sources) if (s.type === 'wikilink') ctx.links.push({ kind: 'wikilink', target: s.ref });
            if (claim.id && ctx.claimIds.has(claim.id)) claim.dupe = true;
            if (claim.id) ctx.claimIds.add(claim.id);
            item.claim = claim;
            ctx.claims.push(claim);
          }
        }
        finish(item.children, ctx, false);
      }
    }
  }
}

// text to { frontmatter, raw, body, bodyLine, blocks, headings, claims, links }.
export function parseMarkdown(input) {
  const { frontmatter, body, raw, bodyLine } = splitFrontmatter(input);
  const ctx = { refs: new Map(), links: [], headings: [], claims: [], claimIds: new Set(), tagSink: [], slug: slugger() };
  const { blocks } = parseBlocks(splitLines(body), ctx, 0);
  finish(blocks, ctx, true);
  return { frontmatter, raw, body, bodyLine, blocks, headings: ctx.headings, claims: ctx.claims, links: ctx.links };
}

// A summary line as plain words: markers gone, nothing to render.
export function plainText(md) {
  const ctx = { refs: new Map(), links: [], tagSink: [] };
  return inlineText(parseInline(normalize(md), ctx)).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

// ---- DOM ----

function defaultImage(src) {
  if (/^https?:|^mailto:/i.test(src)) return null;
  const hub = globalThis.BureauHub;
  return hub && hub.imageUrl ? { secure: hub.imageUrl(src) } : null;
}

function defaultSource(ref) {
  if (ref.type === 'mission') return `/missions/${ref.ref}`;
  if (ref.type === 'record') return `/brain?claim=${ref.ref}`;
  return null;
}

function inlines(nodes, r) {
  return nodes.map((n) => inlineNode(n, r));
}

function inlineNode(n, r) {
  switch (n.t) {
    case 'text': return n.v;
    case 'softbreak': return '\n';
    case 'hardbreak': return h('br');
    case 'em': return h('em', null, inlines(n.children, r));
    case 'strong': return h('strong', null, inlines(n.children, r));
    case 'del': return h('del', null, inlines(n.children, r));
    case 'code': return h('code', null, n.v);
    case 'tag': return h('span', { class: 'md-tag' }, `#${n.name}`);
    case 'link': return linkNode(n, r);
    case 'image': return imageNode(n, r);
    case 'wikilink': return wikilinkNode(n, r);
    default: return null;
  }
}

function linkNode(n, r) {
  const made = r.resolveLink ? r.resolveLink(n.href) : n.href;
  const target = typeof made === 'string' ? { href: made } : made;
  const children = inlines(n.children, r);
  const href = target && target.href ? safeHref(target.href) : null;
  if (!href) return h('span', null, children);
  const external = /^(https?:|mailto:)/i.test(href);
  return h('a', {
    href,
    title: n.title || null,
    class: target.broken ? 'md-broken' : null,
    target: external ? '_blank' : null,
    rel: external ? 'noopener noreferrer' : null,
  }, children);
}

function imageNode(n, r) {
  const made = r.resolveImage ? r.resolveImage(n.src) : defaultImage(n.src);
  const target = typeof made === 'string' ? { src: made } : made;
  // om-pic: shown in Atkinson dither, and a click opens the original (OMAKO DS).
  if (target && target.secure) {
    return h('a', { class: 'om-pic md-pic', dataset: { secureHref: target.secure }, target: '_blank', rel: 'noopener' },
      h('img', { alt: n.alt, title: n.title || null, dataset: { secureSrc: target.secure } }));
  }
  const src = target && target.src ? safeHref(target.src) : null;
  if (src && !/^https?:/i.test(src)) {
    return h('a', { class: 'om-pic md-pic', href: src, target: '_blank', rel: 'noopener' },
      h('img', { alt: n.alt, title: n.title || null, src }));
  }
  // The CSP refuses images from elsewhere, and a note shouldn't phone out.
  const href = safeHref(n.src);
  if (!href || !/^https?:/i.test(href)) return n.alt || n.src;
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', title: 'An image hosted elsewhere' }, n.alt || href);
}

function wikilinkNode(n, r) {
  const made = r.wikilink ? r.wikilink(n.target) : null;
  const label = n.label || (made && made.label) || n.target;
  const href = made && made.href ? safeHref(made.href) : null;
  if (!href) return h('span', { class: 'md-broken', title: 'Not in this brain, or out of reach' }, label);
  return h('a', { href, class: made.broken ? 'md-wikilink md-broken' : 'md-wikilink' }, label);
}

function sourceNode(s, r) {
  if (s.type === 'wikilink') {
    return wikilinkNode({ target: s.ref, label: '' }, r);
  }
  const href = r.sourceLink ? r.sourceLink(s) : defaultSource(s);
  return href ? h('a', { href }, s.ref) : s.ref;
}

function withCommas(nodes) {
  const out = [];
  nodes.forEach((n, i) => {
    if (i) out.push(', ');
    out.push(n);
  });
  return out;
}

function claimNode(item, r) {
  const c = item.claim;
  const hidden = new Set(['source', 'tags']);
  const fieldRows = Object.entries(c.fields).filter(([k]) => !hidden.has(k));
  const showAsId = c.id && !c.dupe;
  return h('li', { class: 'md-claim', id: showAsId ? c.id : null, dataset: { kind: c.kind } },
    h('span', { class: 'md-kind' }, c.kind),
    h('div', { class: 'md-claim-body' },
      h('p', { class: 'md-claim-text' }, inlines(c.children, r)),
      c.form === 'long' && c.tags.length ? h('p', { class: 'md-claim-tags' }, c.tags.map((t) => h('span', { class: 'md-tag' }, `#${t}`))) : null,
      fieldRows.length ? h('dl', { class: 'md-fields' }, fieldRows.flatMap(([k, v]) => [
        h('dt', null, k),
        h('dd', null, String(v)),
      ])) : null,
      c.sources.length || c.note || c.id ? h('p', { class: 'md-claim-foot' },
        c.sources.length ? h('span', { class: 'md-source' }, 'source ', withCommas(c.sources.map((s) => sourceNode(s, r)))) : null,
        c.note ? h('span', { class: 'md-note' }, inlines(c.noteChildren, r)) : null,
        c.id ? h('a', { class: 'md-id', href: `#${c.id}`, title: 'Link to this claim' }, `^${c.id}`) : null) : null,
      item.children.length ? blocksOf(item.children, r, true) : null));
}

function listNode(b, r) {
  const items = b.items.map((item) => {
    if (item.claim) return claimNode(item, r);
    const body = blocksOf(item.children, r, b.tight);
    if (item.task) {
      return h('li', { class: 'md-task', id: item.task.id || null },
        h('input', { type: 'checkbox', disabled: true, checked: item.task.checked, 'aria-label': item.task.checked ? 'Done' : 'Not done' }),
        body);
    }
    return h('li', null, body);
  });
  const anyClaim = b.items.some((item) => item.claim);
  if (b.ordered) return h('ol', { start: b.start !== 1 ? b.start : null }, items);
  return h('ul', { class: anyClaim ? 'md-claims' : null }, items);
}

function tableNode(b, r) {
  const align = (i) => (b.align[i] ? { textAlign: b.align[i] } : null);
  // A column of prose keeps a readable width on a phone. The table scrolls
  // inside itself instead of folding its text one word per line.
  const longest = b.head.map((cell, i) => b.rows.reduce((n, row) => Math.max(n, row[i] ? row[i].raw.length : 0), cell.raw.length));
  const headStyle = (i) => ({ ...align(i), minWidth: `${Math.min(longest[i], 24)}ch` });
  return h('table', null,
    h('thead', null, h('tr', null, b.head.map((cell, i) => h('th', { style: headStyle(i), scope: 'col' }, inlines(cell.children, r))))),
    b.rows.length ? h('tbody', null, b.rows.map((row) => h('tr', null, row.map((cell, i) => h('td', { style: align(i) }, inlines(cell.children, r)))))) : null);
}

function blockNode(b, r, tight) {
  switch (b.type) {
    case 'paragraph':
      return tight ? inlines(b.children, r) : h('p', null, inlines(b.children, r));
    case 'heading':
      return h(`h${b.level}`, { id: b.id },
        inlines(b.children, r),
        h('a', { class: 'md-anchor', href: `#${b.id}`, 'aria-label': `Link to ${b.text}` }, '#'));
    case 'code':
      return h('div', { class: 'md-code' },
        b.lang ? h('span', { class: 'md-lang' }, b.lang) : null,
        h('pre', { tabindex: '0' }, h('code', null, b.text)));
    case 'hr':
      return h('hr');
    case 'blockquote':
      return h('blockquote', null, blocksOf(b.children, r, false));
    case 'list':
      return listNode(b, r);
    case 'table':
      return tableNode(b, r);
    default:
      return null;
  }
}

function blocksOf(blocks, r, tight) {
  return blocks.map((b) => blockNode(b, r, tight));
}

export function renderDocument(doc, opts = {}) {
  return h('div', { class: 'om-prose' }, blocksOf(doc.blocks, opts, false));
}

export function renderMarkdown(text, opts = {}) {
  return renderDocument(parseMarkdown(text), opts);
}
