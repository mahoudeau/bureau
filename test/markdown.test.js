// The dashboard's markdown: every feature, what must never run, hostile input
// on a clock, and real brain files. Zero dependencies: node test/markdown.test.js
//
// hub/public/app/markdown.js is an ES module and this is plain node, so the two
// files it needs are copied to a temporary folder marked as ESM. The parsing is
// pure and read straight from the tree. A small stub of the DOM checks what the
// renderer actually builds.
//
// MD_TEST_BRAIN=<dir> also runs every .md file under a brain copy.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'hub', 'public', 'app');
let pass = 0, fail = 0;
const check = (label, cond, why) => {
  if (cond) { pass++; console.log('  ok: ' + label); }
  else { fail++; console.log('  FAIL: ' + label + (why === undefined ? '' : '\n    ' + String(typeof why === 'string' ? why : JSON.stringify(why)))); }
};

// ---- a very small DOM ----
class StubNode {}
class Text extends StubNode { constructor(v) { super(); this.text = String(v); } }
class Element extends StubNode {
  constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.kids = []; this.dataset = {}; this.props = {}; this.style = { setProperty() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type) { this.listens = (this.listens || []).concat(type); }
  append(...nodes) { this.kids.push(...nodes); }
  replaceChildren(...nodes) { this.kids = nodes; }
  set checked(v) { this.props.checked = v; }
  get checked() { return this.props.checked; }
  set disabled(v) { this.props.disabled = v; }
  get disabled() { return this.props.disabled; }
  set innerHTML(v) { throw new Error('innerHTML assigned: ' + v); }
  get textContent() { return this.kids.map((k) => (k instanceof Text ? k.text : k.textContent)).join(''); }
}
globalThis.Node = StubNode;
globalThis.document = {
  createElement: (t) => new Element(t),
  createElementNS: (_, t) => new Element(t),
  createTextNode: (v) => new Text(v),
  createDocumentFragment: () => new Element('#fragment'),
};
const walk = (el, fn) => { fn(el); if (el.kids) el.kids.forEach((k) => walk(k, fn)); };
const find = (el, pred) => { const out = []; walk(el, (n) => { if (pred(n)) out.push(n); }); return out; };
const byTag = (el, tag) => find(el, (n) => n.tag === tag);

const TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'em', 'strong', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'img', 'span', 'input', 'dl', 'dt', 'dd']);
const ATTRS = new Set(['class', 'href', 'id', 'title', 'alt', 'src', 'target', 'rel', 'type', 'start', 'scope', 'tabindex', 'loading', 'aria-label']);

// Everything the renderer built, held to the short list.
function assertSafe(label, root) {
  const problems = [];
  walk(root, (n) => {
    if (!(n instanceof Element)) return;
    if (!TAGS.has(n.tag)) problems.push('tag ' + n.tag);
    for (const k of Object.keys(n.attrs)) {
      if (!ATTRS.has(k)) problems.push('attribute ' + k);
      if (/^on/i.test(k)) problems.push('handler ' + k);
    }
    if (n.listens) problems.push('listener ' + n.listens);
    const scheme = n.attrs.href === undefined ? null : /^[^/?#]*:/.exec(n.attrs.href);
    if (scheme && !/^(https?:|mailto:)$/i.test(scheme[0])) problems.push('href ' + n.attrs.href);
    if (n.attrs.src !== undefined) problems.push('src ' + n.attrs.src);
  });
  check(label, problems.length === 0, problems.slice(0, 5));
}

async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-test-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(APP, 'markdown.js'), path.join(dir, 'markdown.js'));
  fs.copyFileSync(path.join(APP, 'dom.js'), path.join(dir, 'dom.js'));
  // A file URL: a bare D:\ path is not something import() takes on Windows.
  const mod = await import(require('url').pathToFileURL(path.join(dir, 'markdown.js')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

(async () => {
  const md = await load();
  const { parseMarkdown, renderMarkdown, renderDocument, safeHref, plainText, splitFrontmatter } = md;
  const parse = (s) => parseMarkdown(s).blocks;
  const inline = (s) => parse(s)[0].children;
  const types = (nodes) => nodes.map((n) => n.t).join(',');
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  console.log('1. blocks');
  {
    const b = parse('# One\n\n## Two ##\n\n###### Six\n\n####### not a heading');
    check('atx headings by level', b[0].level === 1 && b[1].level === 2 && b[1].text === 'Two' && b[2].level === 6);
    check('seven hashes is a paragraph', b[3].type === 'paragraph');
    check('setext headings', parse('Title\n===')[0].level === 1 && parse('Sub\n---')[0].level === 2);
    check('headings get stable ids', parse('# Hello, World!')[0].id === 'hello-world');
    const dup = parseMarkdown('# A\n\n# A\n\n# A-1\n\n## É ça\n\n# !!!\n\n# Main');
    check('duplicate slugs differ', eq(dup.headings.map((x) => x.id), ['a', 'a-1', 'a-1-1', 'é-ça', 'section', 'main-1']), dup.headings.map((x) => x.id));
    check('paragraphs split on blanks', parse('one\ntwo\n\nthree').length === 2);
    check('thematic breaks', parse('---')[0].type === 'hr' && parse('* * *')[0].type === 'hr' && parse('___')[0].type === 'hr');

    const fence = parse('```js title\nconst a = 1;\n\n<b>x</b>\n```\nafter');
    check('fenced code keeps text exactly', fence[0].type === 'code' && fence[0].lang === 'js' && fence[0].text === 'const a = 1;\n\n<b>x</b>');
    check('text resumes after a fence', fence[1].type === 'paragraph');
    check('tilde fences and long closers', parse('~~~\na\n~~~~')[0].text === 'a');
    check('an unclosed fence runs to the end', parse('```\na\nb')[0].text === 'a\nb');
    check('a fence inside a quote', parse('> ```\n> a\n> ```')[0].children[0].text === 'a');
    check('indented code', parse('    a\n      b')[0].text === 'a\n  b');
    check('an indented line continues a paragraph', parse('a\n    b').length === 1);

    const ul = parse('- a\n- b\n  - c\n    - d\n- e')[0];
    check('unordered, nested three deep', ul.type === 'list' && ul.items.length === 3 && ul.items[1].children[1].items[0].children[1].items[0].children[0].raw === 'd', ul);
    const ol = parse('3. a\n4. b')[0];
    check('ordered with a start', ol.ordered && ol.start === 3 && ol.items.length === 2);
    const mixed = parse('1. a\n   - b\n2. c')[0];
    check('a list inside an ordered list', mixed.ordered && mixed.items[0].children[1].type === 'list');
    check('tight list', parse('- a\n- b')[0].tight === true);
    check('loose list', parse('- a\n\n- b')[0].tight === false);
    check('two blocks in one item', parse('- a\n\n  b')[0].items[0].children.length === 2);
    check('a hard-wrapped item stays one item', parse('- a\n  b\nc')[0].items.length === 1);
    check('a different marker starts a new list', parse('- a\n* b').length === 2);
    check('an ordered list only cuts a paragraph from 1', parse('a\n2. b').length === 1 && parse('a\n1. b').length === 2);
    const task = parse('- [ ] todo\n- [x] done\n- [X] also')[0];
    check('task lists', task.items[0].task.checked === false && task.items[1].task.checked === true && task.items[2].task.checked === true && task.items[0].children[0].children[0].v === 'todo');

    const q = parse('> a\nlazy\n>\n> > b')[0];
    check('blockquote, lazy line, nested', q.type === 'blockquote' && q.children[0].raw === 'a\nlazy' && q.children[1].type === 'blockquote');
    const t = parse('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| 4 |\n| 5 | 6 | 7 | 8 |\n\nafter');
    check('table with alignment', t[0].type === 'table' && eq(t[0].align, ['left', 'center', 'right']));
    check('short rows pad, long rows cut', t[0].rows[1].length === 3 && t[0].rows[2].length === 3);
    check('the table ends at a blank line', t[1].type === 'paragraph');
    const pipes = parse('a | b\n--|--\n`x\\|y` | [[n|l]]')[0];
    check('escaped pipes and wikilink pipes stay in the cell', pipes.rows[0].length === 2 && pipes.rows[0][0].children[0].v === 'x|y' && pipes.rows[0][1].children[0].label === 'l', pipes.rows[0]);
    check('a mismatched delimiter is no table', parse('a | b\n---')[0].type !== 'table');
  }

  console.log('2. inline');
  {
    check('bold, italic', types(inline('**a** *b* __c__ _d_').filter((n) => n.t !== 'text')) === 'strong,em,strong,em');
    const nest = inline('***a***')[0];
    check('bold italic nests', (nest.t === 'em' && nest.children[0].t === 'strong') || (nest.t === 'strong' && nest.children[0].t === 'em'), nest);
    check('intraword underscore is left alone', types(inline('snake_case_name')) === 'text');
    check('intraword star emphasizes', types(inline('a*b*c')) === 'text,em,text');
    check('strikethrough', inline('~~gone~~')[0].t === 'del');
    check('one tilde is a tilde', types(inline('~a~')) === 'text');
    check('inline code', inline('`a`')[0].v === 'a');
    check('double ticks hold a tick', inline('`` a`b ``')[0].v === 'a`b');
    check('no markup inside code', inline('`**a** <b>`')[0].v === '**a** <b>');
    check('an unmatched tick is text', types(inline('`a')) === 'text');
    check('hard break, two spaces', types(inline('a  \nb')) === 'text,hardbreak,text');
    check('hard break, backslash', types(inline('a\\\nb')) === 'text,hardbreak,text');
    check('soft break', types(inline('a\nb')) === 'text,softbreak,text');
    check('escapes', inline('\\*a\\* \\[b\\] \\\\ \\`')[0].v === '*a* [b] \\ `');
    check('a backslash before a letter stays', inline('a\\b')[0].v === 'a\\b');

    const link = inline('[a *b*](https://x.y/z "T")')[0];
    check('link with title and emphasis', link.t === 'link' && link.href === 'https://x.y/z' && link.title === 'T' && link.children[1].t === 'em', link);
    check('parens in a url', inline('[a](https://x.y/a_(b))')[0].href === 'https://x.y/a_(b)');
    check('angle-bracket destination', inline('[a](<x y.md>)')[0].href === 'x y.md');
    check('relative and anchor links', inline('[a](../x.md#s)')[0].href === '../x.md#s' && inline('[a](#s)')[0].href === '#s');
    check('mailto', inline('[a](mailto:a@b.c)')[0].href === 'mailto:a@b.c');
    check('autolink', inline('<https://x.y>')[0].href === 'https://x.y');
    check('email autolink', inline('<a@b.co>')[0].href === 'mailto:a@b.co');
    const bare = inline('see https://x.y/a_b, then (http://z.w) and www.q.r.');
    check('bare urls', bare[1].href === 'https://x.y/a_b' && bare[3].href === 'http://z.w' && bare[5].href === 'https://www.q.r', bare);
    check('no link inside a link', types(inline('[https://a.b](c)')) === 'link' && inline('[https://a.b](c)')[0].children[0].t === 'text');
    const refd = parse('[a][r] and [r]\n\n[r]: https://x.y "T"');
    check('reference links', refd[0].children[0].t === 'link' && refd[0].children[0].title === 'T' && refd[0].children[2].href === 'https://x.y', refd);
    const img = inline('![al *t*](p.png "T")')[0];
    check('image', img.t === 'image' && img.src === 'p.png' && img.alt === 'al t' && img.title === 'T', img);
    check('a linked image', inline('[![a](b.png)](c)')[0].children[0].t === 'image');
    const wiki = inline('[[a]] and [[b/c#d|lab]]');
    check('wikilinks', wiki[0].target === 'a' && wiki[2].target === 'b/c#d' && wiki[2].label === 'lab', wiki);
    check('an empty wikilink is text', types(inline('[[]]')) === 'text');
    const doc = parseMarkdown('[a](x.md) [[y]] ![i](z.png)');
    check('links are listed', eq(doc.links, [{ kind: 'link', href: 'x.md' }, { kind: 'wikilink', target: 'y' }, { kind: 'image', href: 'z.png' }]), doc.links);
    check('plainText drops markup', plainText('**a** `b` [c](d)') === 'a b c');
  }

  console.log('3. frontmatter');
  {
    const d = parseMarkdown('---\ntitle: "T: x"\nversion: 3\nbelief: validated\n---\n\n# H\n');
    check('split out', d.frontmatter.title === 'T: x' && d.frontmatter.version === '3' && d.blocks[0].type === 'heading');
    check('not shown as body', !JSON.stringify(d.blocks).includes('validated'));
    check('no closing line, no frontmatter', eq(parseMarkdown('---\na: b\n').frontmatter, {}));
    check('a rule later on is not frontmatter', eq(parseMarkdown('a\n\n---\nb: c\n---\n').frontmatter, {}));
    check('BOM and CRLF', parseMarkdown('﻿---\r\na: b\r\n---\r\nx\r\n').frontmatter.a === 'b');
    check('bodyLine counts from the top', splitFrontmatter('---\na: b\n---\nx').bodyLine === 4);
  }

  console.log('4. claims');
  {
    const a = parseMarkdown('- [gotcha] lftp skips *this* #deploy #a-b (source: j-4f2a91c0, t-356, [[journal/2026-08-11]]) ^c-8k2m1q').claims[0];
    check('short form', a.kind === 'gotcha' && a.id === 'c-8k2m1q' && a.form === 'short' && eq(a.tags, ['deploy', 'a-b']), a);
    check('sources typed', eq(a.sources.map((s) => s.type), ['record', 'mission', 'wikilink']) && a.sources[2].ref === 'journal/2026-08-11');
    check('tags are nodes, source is gone from text', a.children.some((n) => n.t === 'tag') && !JSON.stringify(a.children).includes('source:'));
    const task = parseMarkdown('- [fact] text ^c-abc123 #tag (source: t-1)').claims[0];
    check('an id before the tag and source still reads', task.id === 'c-abc123' && eq(task.tags, ['tag']) && task.sources[0].ref === 't-1', task);
    const note = parseMarkdown('- [x-y] a (source: [[b]]) (kassad entry)').claims[0];
    check('source note kept', note.note === '(kassad entry)' && note.kind === 'x-y');
    const notRefs = parseMarkdown('- [fact] a (source: my memory)').claims[0];
    check('a group of non-refs stays text', notRefs.sources.length === 0 && notRefs.text.includes('(source: my memory)'));
    const long = parseMarkdown('- [fact] A site gets a new id #not-a-tag (source: t-9) ^c-2p9x4d\n  - source: t-356, j-71b0c2aa\n  - volatility: volatile\n  - verified: 2026-09-22\n  - tags: #a #b\n').claims[0];
    check('long form', long.form === 'long' && long.id === 'c-2p9x4d' && long.fields.volatility === 'volatile' && long.sources.length === 2 && eq(long.tags, ['a', 'b']), long);
    check('long form text is verbatim', long.text.includes('#not-a-tag') && long.text.includes('(source: t-9)'));
    check('tasks are not claims', parseMarkdown('- [x] done').claims.length === 0);
    const tagged = parse('- [x] done ^c-abc123')[0].items[0];
    check("the hub's id on a task is an anchor, not text", tagged.task.id === 'c-abc123' && tagged.children[0].children[0].v === 'done', tagged);
    check('nested items are not claims', parseMarkdown('- a\n  - [fact] b').claims.length === 0);
    check('code is not claims', parseMarkdown('```\n- [fact] b\n```').claims.length === 0);
    check('a wrapped v0.2 claim joins up', parseMarkdown('- [fact] a\n  b (source: t-1)').claims[0].sources[0].ref === 't-1');
  }

  console.log('5. links that must not become links');
  {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'blob:x', '//evil.example', '\\\\evil.example', '/\\evil.example', 'x:y']) {
      check('refused: ' + JSON.stringify(bad), safeHref(bad) === null);
    }
    for (const good of ['https://a.b', 'HTTP://a.b', 'mailto:a@b.c', 'x.md', '../x.md#a:b', '#a', '/brain/x.md', '?a=b:c']) {
      check('kept: ' + good, safeHref(good) === good);
    }
    check('a refused link stays text, all of it', eq(inline('[click](javascript:alert(1))').map((n) => n.v), ['[click](javascript:alert(1))']), inline('[click](javascript:alert(1))'));
    check('a refused image stays text', types(inline('![x](data:image/png;base64,AA)')) === 'text');
    check('a refused reference stays text', types(parse('[a][r]\n\n[r]: javascript:x')[0].children) === 'text');
    check('a refused autolink stays text', types(inline('<javascript:alert(1)>')) === 'text');
  }

  console.log('6. nothing in a note can run');
  {
    const attacks = {
      'script tag': '<script>alert(1)</script>',
      'script block': '<script>\nalert(1)\n</script>\n\ntext',
      'img onerror': '<img src=x onerror=alert(1)>',
      'svg onload': '<svg/onload=alert(1)>',
      'event attribute in a link title': '[a](b "x\\" onmouseover=\\"alert(1)")',
      'event attribute in image alt': '![x" onerror="alert(1)](a.png)',
      'html in code': '`<img src=x onerror=alert(1)>`\n\n```html\n<script>alert(1)</script>\n```',
      'iframe': '<iframe src="javascript:alert(1)"></iframe>',
      'markdown in html': '<a href="javascript:alert(1)">*x*</a>',
      'javascript link': '[x](javascript:alert(1))',
      'entity-encoded javascript': '[x](&#106;avascript:alert(1))',
      'percent-encoded javascript': '[x](javascript%3Aalert(1))',
      'zero-width in the scheme': '[x](java​script:alert(1))',
      'fullwidth scheme': '[x](ｊavascript:alert(1))',
      'right-to-left override': '[x](‮javascript:alert(1))',
      'homoglyph': '[x](јavascript:alert(1))',
      'wikilink': '[[javascript:alert(1)|x]]',
      'wikilink with html': '[[<img src=x onerror=alert(1)>]]',
      'heading id': '# "><img src=x onerror=alert(1)>',
      'table cell': '| <b onclick=x>a</b> |\n|---|\n| <script>x</script> |',
      'claim': '- [<img onerror=x>] <script>x</script> ^c-abcdef (source: t-1)\n- [fact] <b>x</b> #tag (source: [[<script>]])',
      'claim kind': '- [fact"><script>] x',
      'frontmatter': '---\ntitle: <script>alert(1)</script>\n---\nbody',
      'null byte': '<scr\0ipt>alert(1)</script>',
      'code fence language': '``` "><script>alert(1)</script>\nx\n```',
    };
    for (const [name, text] of Object.entries(attacks)) {
      const root = renderMarkdown(text, { wikilink: (t) => ({ href: safeHref(`/brain/${encodeURIComponent(t)}`) }) });
      assertSafe(name, root);
    }
    const script = renderMarkdown('<script>alert(1)</script>');
    check('a script tag shows as its own text', script.textContent === '<script>alert(1)</script>', script.textContent);
    check('code keeps html as text', renderMarkdown('`<b>x</b>`').textContent === '<b>x</b>');
    const src = fs.readFileSync(path.join(APP, 'markdown.js'), 'utf8');
    check('the renderer never touches innerHTML', !/\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src));
    const hostile = renderMarkdown('[a](javascript:x) [b](https://ok.example)', { resolveLink: () => 'javascript:evil' });
    check('a hook cannot smuggle a bad href', byTag(hostile, 'a').length === 0);
    const out = renderMarkdown('![a](p.png)', { resolveImage: () => ({ src: 'javascript:evil' }) });
    check('a hook cannot smuggle a bad image', byTag(out, 'img').length === 0);
  }

  console.log('7. rendering');
  {
    const root = renderMarkdown('# H\n\nA **b** [c](d.md) ![e](f.png) [[g]]\n\n- [ ] t\n\n| a |\n|--:|\n| 1 |\n\n```js\nx\n```\n\n> q\n\n---\n', {
      resolveLink: (href) => `/brain/${href}`,
      resolveImage: (src) => ({ secure: `/api/knowledge?file=${src}&raw=1` }),
      wikilink: (name) => ({ href: `/brain/${name}.md` }),
    });
    check('root is om-prose', root.attrs.class === 'om-prose');
    const h1 = byTag(root, 'h1')[0];
    check('heading id and anchor', h1.attrs.id === 'h' && byTag(h1, 'a')[0].attrs.href === '#h');
    check('resolveLink is used', byTag(root, 'a').some((a) => a.attrs.href === '/brain/d.md'));
    const img = byTag(root, 'img')[0];
    check('images go through the secure fetch', img.dataset.secureSrc === '/api/knowledge?file=f.png&raw=1' && img.attrs.src === undefined && img.attrs.alt === 'e');
    check('wikilink hook is used', byTag(root, 'a').some((a) => a.attrs.href === '/brain/g.md'));
    const box = byTag(root, 'input')[0];
    check('task box is checked state, disabled', box.attrs.type === 'checkbox' && box.props.checked === false && box.props.disabled === true);
    check('table alignment reaches the cell', byTag(root, 'th')[0].style.textAlign === 'right' && byTag(root, 'td')[0].style.textAlign === 'right');
    check('code, quote and rule', byTag(root, 'pre').length === 1 && byTag(root, 'blockquote').length === 1 && byTag(root, 'hr').length === 1);
    const external = renderMarkdown('[a](https://x.y)');
    check('external links open apart, with no referrer', byTag(external, 'a')[0].attrs.target === '_blank' && byTag(external, 'a')[0].attrs.rel === 'noopener noreferrer');
    const remote = renderMarkdown('![a](https://x.y/p.png)');
    check('a remote image becomes a link, never a fetch', byTag(remote, 'img').length === 0 && byTag(remote, 'a')[0].attrs.href === 'https://x.y/p.png');
    const dangling = renderMarkdown('[[nope]]', { wikilink: () => null });
    check('an unresolved wikilink is text', byTag(dangling, 'a').length === 0 && dangling.textContent === 'nope');
    const claim = renderMarkdown('- [fact] a #t (source: t-5, j-abcd1234, [[x]]) ^c-abc123', { wikilink: (n) => ({ href: `/brain/${n}.md` }) });
    const li = byTag(claim, 'li')[0];
    check('claim carries its anchor', li.attrs.id === 'c-abc123' && li.attrs.class === 'md-claim');
    check('claim label, id and sources', find(claim, (n) => n.attrs && n.attrs.class === 'md-kind')[0].textContent === 'fact' && byTag(claim, 'a').some((a) => a.attrs.href === '#c-abc123'));
    check('mission source links', byTag(claim, 'a').some((a) => a.attrs.href === '/missions/t-5'));
    check('record source links', byTag(claim, 'a').some((a) => a.attrs.href === '/brain?claim=j-abcd1234'));
    check('file source links', byTag(claim, 'a').some((a) => a.attrs.href === '/brain/x.md'));
    const d = parseMarkdown('# A');
    check('renderDocument takes a parsed note', renderDocument(d).attrs.class === 'om-prose');
  }

  console.log('8. hostile input, on a clock');
  {
    const MB = 1024 * 1024;
    const fill = (unit, size = MB) => unit.repeat(Math.ceil(size / unit.length));
    const LIMIT = 4000;
    const cases = {
      'one huge line of quotes': fill('> '),
      'quotes, one per line, deepening': Array.from({ length: 1400 }, (_, i) => '> '.repeat(i % 700) + 'x').join('\n').padEnd(MB, '\n'),
      'lists deepening by indent': Array.from({ length: 1400 }, (_, i) => ' '.repeat(i % 700) + '- x').join('\n'),
      'bullets on one line': fill('- a '),
      'stars': fill('*'),
      'alternating stars': fill('*a'),
      'stars with spaces': fill('* a '),
      'open emphasis then close': fill('*a ', MB / 2) + fill('a* ', MB / 2),
      'mixed delimiters': fill('*_~~'),
      'underscores in words': fill('a_b*c '),
      'open brackets': fill('['),
      'close brackets': fill(']'),
      'nested images': fill('![', MB / 2) + fill('](u)', MB / 2),
      'link openers, no close': fill('[a]('),
      'link openers, one far close': fill('[a](x') + ')',
      'parens in a destination': '[a](' + fill('('),
      'open title quotes': fill('[a](x "'),
      'alternating title quotes': fill('[a](x "y [a](x \''),
      'open wikilinks': fill('[[a'),
      'wikilink, one far close': fill('[[a') + ']]',
      'backticks of every length': Array.from({ length: 1400 }, (_, i) => '`'.repeat(i + 1) + ' ').join(''),
      'one tick run': fill('`'),
      'angle brackets': fill('<'),
      'angle with one far close': fill('<a') + '>',
      'escapes': fill('\\'),
      'bare url chains': fill('http://'),
      'url with trailing parens': fill('http://a' + ')'.repeat(4000) + ' '),
      'pipes': fill('|') + '\n' + fill('-|'),
      'huge table': '|' + 'a|'.repeat(60) + '\n|' + '-|'.repeat(60) + '\n' + fill('x\n', MB / 2),
      'too many columns': fill('a|', MB / 2) + '\n' + fill('-|', MB / 2) + '\n' + fill('x\n', 1024),
      'headings all the same': fill('# a\n'),
      'reference definitions': fill('[a]: b\n'),
      'reference uses': '[a]: b\n\n' + fill('[a]'),
      'unclosed source groups': '- [fact] ' + fill('(source: '),
      'carets in a claim': '- [fact] ' + fill(' ^c-a'),
      'tags in a claim': '- [fact] ' + fill('#a #b- '),
      'claim lines': fill('- [fact] a #b (source: t-1) ^c-abc123\n'),
      'blank lines': fill('\n'),
      'spaces': fill(' '),
      'tabs': fill('\t'),
      'frontmatter never closed': '---\n' + fill('a: b\n'),
      'fences never closed': fill('```\na\n'),
      'mixed everything': fill('> - *a [b](c "d `e` ~~f [[g <h ![i '),
    };
    for (const [name, text] of Object.entries(cases)) {
      const t0 = Date.now();
      let err = null;
      let root = null;
      try { root = renderMarkdown(text); } catch (e) { err = e; }
      const ms = Date.now() - t0;
      check(`${name} (${ms}ms)`, !err && root && ms < LIMIT, err ? err.stack : `${ms}ms`);
    }
    const depth = (el) => { let d = 0; let kids = [[el, 0]]; while (kids.length) { const [n, x] = kids.pop(); d = Math.max(d, x); if (n.kids) n.kids.forEach((k) => kids.push([k, x + 1])); } return d; };
    check('quote depth is capped', depth(renderMarkdown('> '.repeat(5000) + 'x')) < 40);
    check('list depth is capped', depth(renderMarkdown('- '.repeat(5000) + 'x')) < 60);
    check('emphasis depth is capped', depth(renderMarkdown('*a '.repeat(5000) + 'a* '.repeat(5000))) < 40);
    const a1 = Date.now(); renderMarkdown('[a]('.repeat(25000)); const small = Date.now() - a1;
    const a2 = Date.now(); renderMarkdown('[a]('.repeat(250000)); const big = Date.now() - a2;
    check(`ten times the input is about ten times the work (${small}ms, ${big}ms)`, big < Math.max(small, 5) * 40, `${small} then ${big}`);
  }

  console.log('9. real files');
  {
    const claims = require(path.join(ROOT, 'hub', 'lib', 'claims.js'));
    const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === '.git') return [];
      return e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)];
    });
    const roots = [path.join(ROOT, 'test', 'fixtures'), path.join(ROOT, 'docs')];
    if (process.env.MD_TEST_BRAIN) roots.push(process.env.MD_TEST_BRAIN);
    let files = 0, slowest = 0, differ = [], unsafe = [], claimsSeen = 0;
    for (const root of roots) {
      for (const file of walkFiles(root).filter((f) => f.endsWith('.md'))) {
        const text = fs.readFileSync(file, 'utf8');
        const t0 = Date.now();
        const doc = parseMarkdown(text);
        const node = renderDocument(doc);
        slowest = Math.max(slowest, Date.now() - t0);
        files++;
        claimsSeen += doc.claims.length;
        walk(node, (n) => {
          if (n instanceof Element && !TAGS.has(n.tag)) unsafe.push(`${file}: ${n.tag}`);
        });
        const hasFence = /^\s*(```|~~~)/m.test(text);
        if (!hasFence) {
          const ref = claims.parseFile(text).claims.filter((c) => c.kind !== 'x' && c.kind !== 'X'); // task lists, to a reader
          const mine = doc.claims.map((c) => `${c.kind}|${c.id}`).join('\n');
          const theirs = ref.map((c) => `${c.kind}|${c.id}`).join('\n');
          if (mine !== theirs) differ.push(`${path.relative(ROOT, file)} (mine ${doc.claims.length}, theirs ${ref.length})`);
        }
      }
    }
    check(`${files} files parse and render (slowest ${slowest}ms, ${claimsSeen} claims)`, files > 0 && slowest < 1500);
    check('no unexpected element in any of them', unsafe.length === 0, unsafe.slice(0, 5));
    check('claims agree with hub/lib/claims.js', differ.length === 0, differ.slice(0, 12));
  }

  console.log(`passed ${pass}, failed ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
