// Bureau design system — the living style guide (t-139, goal: t-134)
//
// "The styleguide is a Page, not a wiki" (STUDY-lead-t134.md): this module
// imports the SAME components.js the rest of the app imports and calls its
// real builder functions to render every atom specimen below — it does not
// hand-copy markup. Token swatches read getComputedStyle() on the live
// cascade at render time, not a hardcoded copy of tokens.css's values, so
// editing a token and reloading this page moves the swatch with it.
//
// Owns: hub/public/v2/styleguide.html (its shell) and this file. Scaffolds
// the /v2/styleguide route with its two most mature sections per this
// mission's own scope — Tokens and Atoms. Molecules/Organisms/Templates are
// tranche-2, seeded by t-136's completeness audit; this file does not
// guess-fill them (see the disabled nav items in styleguide.html).

import { icon, ICON_NAMES, STATUS_HUES, statusGlyph, chip, idBadge, avatar, input, iconButton, button } from './components.js';

/** Tiny DOM builder for this page's OWN structural chrome (section
 * wrappers, headings, grid containers) — never used to build an atom
 * itself; every atom specimen below comes from components.js's own
 * functions. Deliberately separate/differently-named from components.js's
 * private `el()` helper so the two are never confused at a glance. */
function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Resolves once every <link rel=stylesheet> in <head> has either loaded or
 * errored, so tokens.css's real values (and its CSSOM rule list) are
 * available before the Tokens section reads them — module scripts can
 * otherwise execute before a same-document <link> has actually fetched. */
function stylesheetsReady() {
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  return Promise.all(links.map(link => new Promise(resolve => {
    if (link.sheet) return resolve();
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  })));
}

/**
 * Every `--v2-*` custom property declared on tokens.css's bare `:root`
 * rule, read from the live CSSOM (the parsed stylesheet the browser
 * actually loaded) rather than fetched/regex-scanned as text — a text scan
 * would risk matching token names mentioned inside tokens.css's own prose
 * comments (it cites several by name while explaining its values), the
 * CSSOM only ever contains real declarations, never comments.
 */
function tokensStylesheet() {
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.href && sheet.href.includes('/v2/tokens.css')) return sheet;
    } catch (e) { /* cross-origin sheet: never true here, same-origin only */ }
  }
  return null;
}

function getTokenNames() {
  const sheet = tokensStylesheet();
  if (!sheet) return [];
  const names = new Set();
  for (const rule of sheet.cssRules) {
    if (rule.selectorText !== ':root') continue; // the bare :root rule only — the light/base definition every token has (per tokens.css's own SWITCHER MECHANISM note, every token is defined there first)
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      if (prop.startsWith('--v2-')) names.add(prop);
    }
  }
  return Array.from(names).sort();
}

function computedValue(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Groups a token name into one of the categories tokens.css itself is
 * organized into (its own section comments: color / spacing / radius /
 * elevation shadow / icon+avatar sizing / stacking / type scale / typeface
 * / motion). Unmatched names fall into "Other" rather than being dropped,
 * so a category tokens.css adds later still surfaces here without an edit. */
const TOKEN_CATEGORY_ORDER = ['Color', 'Type', 'Space', 'Radius', 'Shadow', 'Icon size', 'Avatar size', 'Layout', 'Motion', 'Z-index', 'Other'];
function tokenCategory(name) {
  const n = name.slice('--v2-'.length);
  if (n.startsWith('color-')) return 'Color';
  if (n.startsWith('font') || n.startsWith('weight-') || n.startsWith('line-height') || n === 'tabular-nums') return 'Type';
  if (n.startsWith('space-')) return 'Space';
  if (n.startsWith('radius-')) return 'Radius';
  if (n.startsWith('shadow-')) return 'Shadow';
  if (n.startsWith('icon-size-')) return 'Icon size';
  if (n.startsWith('avatar-size-')) return 'Avatar size';
  if (n.startsWith('row-height')) return 'Layout';
  if (n.startsWith('motion-')) return 'Motion';
  if (n.startsWith('z-')) return 'Z-index';
  return 'Other';
}

/** Builds the live swatch for one token — the visual form depends on what
 * kind of value the token holds, per the mission's own examples (color
 * chip / rendered text sample for fonts / sized box for space+radius),
 * extended with the same logic to the rest of tokens.css's categories. */
function tokenSwatch(name) {
  const box = h('div', 'sg-token-card__swatch');
  if (name.includes('-color-')) {
    const swatch = h('div', 'sg-swatch__color');
    swatch.style.background = `var(${name})`;
    box.appendChild(swatch);
  } else if (name.includes('-font-size-')) {
    const sample = h('span', 'sg-swatch__text', 'Ag 123');
    sample.style.fontSize = `var(${name})`;
    box.appendChild(sample);
  } else if (name === '--v2-font-sans' || name === '--v2-font-serif' || name === '--v2-font-mono') {
    const sample = h('span', 'sg-swatch__text', 'The quick brown fox');
    sample.style.fontFamily = `var(${name})`;
    sample.style.fontSize = 'var(--v2-font-size-lg)';
    box.appendChild(sample);
  } else if (name.includes('-weight-')) {
    const sample = h('span', 'sg-swatch__text', 'Ag');
    sample.style.fontWeight = `var(${name})`;
    sample.style.fontSize = 'var(--v2-font-size-xl)';
    box.appendChild(sample);
  } else if (name.includes('-line-height-')) {
    const sample = h('p', 'sg-swatch__text', 'Two lines show how tightly rows of body copy sit under this token.');
    sample.style.lineHeight = `var(${name})`;
    sample.style.margin = '0';
    box.appendChild(sample);
  } else if (name === '--v2-tabular-nums') {
    const sample = h('span', 'sg-swatch__text', '0123456789');
    sample.style.fontVariantNumeric = `var(${name})`;
    box.appendChild(sample);
  } else if (name.includes('-space-')) {
    const bar = h('div', 'sg-swatch__bar');
    bar.style.width = `var(${name})`;
    box.appendChild(bar);
  } else if (name.includes('-radius-')) {
    const sq = h('div', 'sg-swatch__box');
    sq.style.borderRadius = `var(${name})`;
    box.appendChild(sq);
  } else if (name.includes('-shadow-')) {
    const sh = h('div', 'sg-swatch__shadow');
    sh.style.boxShadow = `var(${name})`;
    box.appendChild(sh);
  } else if (name.includes('-icon-size-')) {
    const wrap = h('span', 'sg-swatch__icon');
    wrap.innerHTML = icon('circle');
    const svgEl = wrap.firstElementChild;
    if (svgEl) { svgEl.style.width = `var(${name})`; svgEl.style.height = `var(${name})`; }
    box.appendChild(wrap);
  } else if (name.includes('-avatar-size-')) {
    box.appendChild(avatar('AB', { size: name.endsWith('-md') ? 'md' : 'sm' }));
  } else if (name.startsWith('--v2-row-height')) {
    const bar = h('div', 'sg-swatch__row');
    bar.style.height = `var(${name})`;
    box.appendChild(bar);
  } else {
    // z-index / motion / anything future and uncategorized: no meaningful
    // visual form, show the resolved value itself as the specimen.
    box.appendChild(h('span', 'sg-swatch__text', computedValue(name) || '(empty)'));
  }
  return box;
}

function tokenCard(name) {
  const card = h('div', 'v2-card sg-token-card');
  card.appendChild(idBadge(name));
  card.appendChild(tokenSwatch(name));
  const value = h('code', 'sg-token-card__value', computedValue(name) || '(empty)');
  value.dataset.tokenValueFor = name; // re-read on theme toggle, see refreshTokenValues()
  card.appendChild(value);
  return card;
}

function renderTokens() {
  const root = document.getElementById('sg-tokens-body');
  root.textContent = '';
  const names = getTokenNames();
  if (!names.length) {
    root.appendChild(h('p', 'sg-hint', 'tokens.css did not parse as a stylesheet — is it linked and reachable?'));
    return;
  }
  const groups = new Map();
  for (const name of names) {
    const cat = tokenCategory(name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(name);
  }
  for (const cat of TOKEN_CATEGORY_ORDER) {
    const groupNames = groups.get(cat);
    if (!groupNames || !groupNames.length) continue;
    const section = h('div', 'sg-group');
    section.appendChild(h('h3', 'sg-group__title', `${cat} (${groupNames.length})`));
    const grid = h('div', 'sg-grid');
    groupNames.forEach(name => grid.appendChild(tokenCard(name)));
    section.appendChild(grid);
    root.appendChild(section);
  }
}

/** Re-reads every token's resolved value after a theme switch. The swatches
 * themselves need no JS help here — they hold live `var(--v2-...)`
 * references and the browser repaints them the instant [data-theme]
 * changes — only the printed text readout (a JS-resolved string, not a
 * live CSS reference) needs an explicit refresh. */
function refreshTokenValues() {
  document.querySelectorAll('[data-token-value-for]').forEach(node => {
    node.textContent = computedValue(node.dataset.tokenValueFor) || '(empty)';
  });
}

// ---------------------------------------------------------------------
// Atoms — every specimen below is a direct call into components.js.
// ---------------------------------------------------------------------

function group(title, ...children) {
  const wrap = h('div', 'sg-group');
  wrap.appendChild(h('h3', 'sg-group__title', title));
  children.forEach(c => wrap.appendChild(c));
  return wrap;
}

function buttonsGroup() {
  const grid = h('div', 'sg-row-grid');
  ['primary', 'secondary', 'ghost'].forEach(variant => {
    const col = h('div', 'sg-specimen-col');
    col.appendChild(h('div', 'sg-specimen-col__label', variant));
    const row = h('div', 'sg-specimen-row');
    row.appendChild(button('Label', { variant, iconName: 'check' }));
    row.appendChild(button('Label', { variant, state: 'disabled' }));
    row.appendChild(button('Label', { variant, state: 'loading' }));
    col.appendChild(row);
    grid.appendChild(col);
  });
  return group('Buttons — default · disabled · loading (hover / Tab the first one for real :hover / :focus-visible)', grid);
}

function iconButtonsGroup() {
  const row = h('div', 'sg-specimen-row');
  const plain = iconButton('paperclip', { title: 'Attach' });
  row.appendChild(plain);
  const primary = iconButton('send', { title: 'Send' });
  primary.classList.add('v2-icon-btn--primary'); // the real usage pattern components.js's own panelFooter() applies to its trailing icon
  row.appendChild(primary);
  row.appendChild(iconButton('x', { title: 'Close', disabled: true }));
  return group('Icon-only buttons — plain · primary · disabled', row);
}

function chipsGroup() {
  const row = h('div', 'sg-specimen-row');
  row.appendChild(chip('Design'));
  row.appendChild(chip('Backend'));
  Object.keys(STATUS_HUES).forEach(key => row.appendChild(chip(STATUS_HUES[key].label, key)));
  return group('Chips & labels — plain tag pill, then every status hue', row);
}

function statusGlyphsGroup() {
  const row = h('div', 'sg-specimen-row');
  Object.keys(STATUS_HUES).forEach(key => {
    const col = h('div', 'sg-specimen-col');
    col.appendChild(statusGlyph(key));
    col.appendChild(h('div', 'sg-specimen-col__label', STATUS_HUES[key].label));
    row.appendChild(col);
  });
  return group('Status glyphs', row);
}

function inputsGroup() {
  const row = h('div', 'sg-specimen-row sg-specimen-row--stack');
  [
    input({ placeholder: 'Single-line input…' }),
    input({ placeholder: 'Multi-line input…', area: true }),
    input({ placeholder: 'Disabled input', disabled: true }),
  ].forEach(elm => {
    const col = h('div', 'sg-specimen-col sg-specimen-col--wide');
    col.appendChild(elm);
    row.appendChild(col);
  });
  return group('Inputs — single-line · multi-line · disabled (click or Tab into one for the real focus ring)', row);
}

function avatarsGroup() {
  const row = h('div', 'sg-specimen-row');
  row.appendChild(avatar('MM', { size: 'sm' }));
  row.appendChild(avatar('MM', { size: 'md' }));
  row.appendChild(avatar(null, { isAgent: true, size: 'sm' }));
  row.appendChild(avatar(null, { isAgent: true, size: 'md' }));
  return group('Avatars & agent tags — human (sm/md), then the agent-tag treatment (sm/md)', row);
}

function iconsGroup() {
  const grid = h('div', 'sg-icon-grid');
  ICON_NAMES.forEach(name => {
    const cell = h('div', 'sg-icon-cell');
    const glyph = h('span', 'sg-swatch__icon');
    glyph.innerHTML = icon(name, 'v2-icon--md');
    cell.appendChild(glyph);
    cell.appendChild(h('code', 'sg-icon-cell__name', name));
    grid.appendChild(cell);
  });
  return group(`Icon set (${ICON_NAMES.length} vendored Lucide glyphs)`, grid);
}

function renderAtoms() {
  const root = document.getElementById('sg-atoms-body');
  root.textContent = '';
  [buttonsGroup(), iconButtonsGroup(), chipsGroup(), statusGlyphsGroup(), inputsGroup(), avatarsGroup(), iconsGroup()]
    .forEach(g => root.appendChild(g));
}

// ---------------------------------------------------------------------
// Theme mode-switch — reuses tokens.css's existing [data-theme] mechanism
// and v2.html's own 'bureau_v2_theme' localStorage key verbatim, so a
// choice made on either page holds on the other.
// ---------------------------------------------------------------------
function initModeSwitch() {
  const KEY = 'bureau_v2_theme';
  const buttons = Array.from(document.querySelectorAll('.sg-modeswitch__btn'));
  const glyphs = { light: 'sun', dark: 'moon', system: 'monitor' };
  buttons.forEach(b => { b.innerHTML = icon(glyphs[b.dataset.mode]); }); // filled via components.js, not hand-written SVG

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    buttons.forEach(b => b.classList.toggle('v2-on', b.dataset.mode === (mode || 'system')));
    refreshTokenValues();
  }
  apply(localStorage.getItem(KEY));
  buttons.forEach(b => b.addEventListener('click', () => {
    const mode = b.dataset.mode;
    if (mode === 'system') { localStorage.removeItem(KEY); apply(null); }
    else { localStorage.setItem(KEY, mode); apply(mode); }
  }));
}

async function boot() {
  await stylesheetsReady();
  initModeSwitch();
  renderTokens();
  renderAtoms();
}

boot();
