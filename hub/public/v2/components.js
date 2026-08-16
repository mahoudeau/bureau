// Dashboard v2 — component atoms: icons + shared builders (t-66, goal: t-53)
//
// Owns: hub/public/v2/components.css (styling/states) and this file (the icon
// library + small DOM builders every other Wave-1 module composes with).
// Reads color/spacing/type ONLY from t-63's tokens.css custom properties via
// the v2- prefixed classes below, per t-62's class-hook contract — nothing
// here hardcodes a color, size, or font.
//
// Icon source of record: v2/icons/lucide-icons.json (+ v2/icons/LICENSE,
// ISC) — the 24 shapes already used and mechanically approved in t-58's
// applied style sample, plus 5 added for this mission's own needs (peek-
// panel minimize/maximize, a loading spinner, an error glyph, chevron-up
// as chevron-down's pair). Embedded as a literal below (not fetched at
// runtime) so icon() is available synchronously the instant this module
// loads — sibling modules render icons inline in their own first paint,
// with zero async race and zero dependency on static-route timing beyond
// this file's own <script type=module> load, which every module already
// requires. Keep this literal and the JSON file in sync if either changes.

const ICONS = {
"check": "<svg\n  class=\"lucide lucide-check\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M20 6 9 17l-5-5\" />\n</svg>",
"chevron-down": "<svg\n  class=\"lucide lucide-chevron-down\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m6 9 6 6 6-6\" />\n</svg>",
"chevron-right": "<svg\n  class=\"lucide lucide-chevron-right\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m9 18 6-6-6-6\" />\n</svg>",
"chevron-up": "<svg\n  class=\"lucide lucide-chevron-up\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m18 15-6-6-6 6\" />\n</svg>",
"circle": "<svg\n  class=\"lucide lucide-circle\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n</svg>",
"circle-alert": "<svg\n  class=\"lucide lucide-circle-alert\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" />\n  <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />\n</svg>",
"circle-check": "<svg\n  class=\"lucide lucide-circle-check\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m9 12 2 2 4-4\" />\n</svg>",
"circle-dot": "<svg\n  class=\"lucide lucide-circle-dot\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <circle cx=\"12\" cy=\"12\" r=\"1\" />\n</svg>",
"circle-x": "<svg\n  class=\"lucide lucide-circle-x\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"m15 9-6 6\" />\n  <path d=\"m9 9 6 6\" />\n</svg>",
"clock": "<svg\n  class=\"lucide lucide-clock\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"10\" />\n  <path d=\"M12 6v6l4 2\" />\n</svg>",
"command": "<svg\n  class=\"lucide lucide-command\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3\" />\n</svg>",
"filter": "<svg\n  class=\"lucide lucide-filter\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z\" />\n</svg>",
"flag": "<svg\n  class=\"lucide lucide-flag\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528\" />\n</svg>",
"folder": "<svg\n  class=\"lucide lucide-folder\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />\n</svg>",
"git-branch": "<svg\n  class=\"lucide lucide-git-branch\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M15 6a9 9 0 0 0-9 9V3\" />\n  <circle cx=\"18\" cy=\"6\" r=\"3\" />\n  <circle cx=\"6\" cy=\"18\" r=\"3\" />\n</svg>",
"loader-2": "<svg\n  class=\"lucide lucide-loader-2\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M21 12a9 9 0 1 1-6.219-8.56\" />\n</svg>",
"maximize-2": "<svg\n  class=\"lucide lucide-maximize-2\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M15 3h6v6\" />\n  <path d=\"m21 3-7 7\" />\n  <path d=\"m3 21 7-7\" />\n  <path d=\"M9 21H3v-6\" />\n</svg>",
"message-square": "<svg\n  class=\"lucide lucide-message-square\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\" />\n</svg>",
"minimize-2": "<svg\n  class=\"lucide lucide-minimize-2\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m14 10 7-7\" />\n  <path d=\"M20 10h-6V4\" />\n  <path d=\"m3 21 7-7\" />\n  <path d=\"M4 14h6v6\" />\n</svg>",
"monitor": "<svg\n  class=\"lucide lucide-monitor\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" />\n  <line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" />\n  <line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />\n</svg>",
"moon": "<svg\n  class=\"lucide lucide-moon\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\" />\n</svg>",
"panel-right": "<svg\n  class=\"lucide lucide-panel-right\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M15 3v18\" />\n</svg>",
"paperclip": "<svg\n  class=\"lucide lucide-paperclip\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551\" />\n</svg>",
"plus": "<svg\n  class=\"lucide lucide-plus\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M5 12h14\" />\n  <path d=\"M12 5v14\" />\n</svg>",
"send": "<svg\n  class=\"lucide lucide-send\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" />\n  <path d=\"m21.854 2.147-10.94 10.939\" />\n</svg>",
"search": "<svg\n  class=\"lucide lucide-search\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"m21 21-4.34-4.34\" />\n  <circle cx=\"11\" cy=\"11\" r=\"8\" />\n</svg>",
"sun": "<svg\n  class=\"lucide lucide-sun\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <circle cx=\"12\" cy=\"12\" r=\"4\" />\n  <path d=\"M12 2v2\" />\n  <path d=\"M12 20v2\" />\n  <path d=\"m4.93 4.93 1.41 1.41\" />\n  <path d=\"m17.66 17.66 1.41 1.41\" />\n  <path d=\"M2 12h2\" />\n  <path d=\"M20 12h2\" />\n  <path d=\"m6.34 17.66-1.41 1.41\" />\n  <path d=\"m19.07 4.93-1.41 1.41\" />\n</svg>",
"tag": "<svg\n  class=\"lucide lucide-tag\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\" />\n  <circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />\n</svg>",
"user": "<svg\n  class=\"lucide lucide-user\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" />\n  <circle cx=\"12\" cy=\"7\" r=\"4\" />\n</svg>",
"x": "<svg\n  class=\"lucide lucide-x\"\n  xmlns=\"http://www.w3.org/2000/svg\"\n  viewBox=\"0 0 24 24\"\n  fill=\"none\"\n  stroke=\"currentColor\"\n  stroke-width=\"2\"\n  stroke-linecap=\"round\"\n  stroke-linejoin=\"round\"\n>\n  <path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />\n</svg>",
};

/** Every valid icon() name, for sibling modules that want to validate input. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS).sort());

/**
 * Inline SVG markup for a vendored Lucide icon, sized/colored entirely by
 * CSS (the returned root always carries class="v2-icon", per t-62's v2-
 * class-hook convention — style it with .v2-icon size modifiers below, or
 * `currentColor` inherits the caller's own text color for free).
 * Unknown name -> '' (rendered as nothing, never a broken/missing glyph);
 * callers that need a fallback should check ICON_NAMES.includes(name) first.
 */
export function icon(name, cls) {
  const svg = ICONS[name];
  if (!svg) return '';
  return svg.replace('<svg', `<svg class="v2-icon${cls ? ' ' + cls : ''}"`);
}

/**
 * The canonical status → {hue token, glyph} mapping (STUDY-lead.md, "the
 * register, named": "status is glyph + color, never color alone"). Every
 * Wave-1 module that renders a mission/task status (board rows, goal
 * progress, needs-me-now, batch verdicts) should read status appearance
 * from here instead of re-deciding its own color/icon pairing — this is
 * the single place that pairing lives, so it can't drift between modules.
 * Values are CSS custom-property NAMES (strings), not colors: read them
 * with `var(${STATUS_HUES[key].colorVar})` from CSS, or css.getPropertyValue
 * from JS if a computed value is ever needed.
 */
export const STATUS_HUES = Object.freeze({
  bug: Object.freeze({ colorVar: '--v2-color-status-bug', softVar: '--v2-color-status-bug-soft', glyph: 'circle-alert', label: 'Bug' }),
  'at-risk': Object.freeze({ colorVar: '--v2-color-status-at-risk', softVar: '--v2-color-status-at-risk-soft', glyph: 'flag', label: 'At risk' }),
  'on-track': Object.freeze({ colorVar: '--v2-color-status-on-track', softVar: '--v2-color-status-on-track-soft', glyph: 'circle-dot', label: 'On track' }),
  'in-progress': Object.freeze({ colorVar: '--v2-color-status-in-progress', softVar: '--v2-color-status-in-progress-soft', glyph: 'circle', label: 'In progress' }),
  done: Object.freeze({ colorVar: '--v2-color-status-done', softVar: '--v2-color-status-done-soft', glyph: 'circle-check', label: 'Done' }),
});

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children || [])) {
    if (c === undefined || c === null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * A small geometric status glyph, colored by hue, per STUDY's "glyph +
 * color, never color alone" rule. `status` is a STATUS_HUES key.
 */
export function statusGlyph(status, size) {
  const s = STATUS_HUES[status];
  const span = el('span', { class: `v2-status-glyph${size ? ' v2-status-glyph--' + size : ''}`, title: s ? s.label : status });
  span.style.color = `var(${s ? s.colorVar : '--v2-color-text-muted'})`;
  span.innerHTML = icon(s ? s.glyph : 'circle');
  return span;
}

/**
 * A status/label pill: leading glyph or dot, soft-tinted background, text.
 * Never color-only — always carries the glyph (or the text itself, for a
 * plain label chip with no status).
 */
export function chip(text, status) {
  const c = el('span', { class: 'v2-chip' + (status ? ` v2-chip--${status}` : '') });
  if (status && STATUS_HUES[status]) {
    // Status chips render as icon + colored text only (components.css's
    // .v2-chip--<status> rules strip the pill/fill/border down to nothing
    // but color) — only --v2-chip-fg is still read; no soft background
    // variable to set since status labels no longer have one.
    const s = STATUS_HUES[status];
    c.style.setProperty('--v2-chip-fg', `var(${s.colorVar})`);
    c.appendChild(statusGlyph(status, 'xs'));
  }
  c.appendChild(el('span', { class: 'v2-chip__label v2-tabular-nums' }, text));
  return c;
}

/** A tabular-nums id badge, e.g. "t-79". */
export function idBadge(id) {
  return el('span', { class: 'v2-id-badge v2-tabular-nums' }, id);
}

/**
 * A circular avatar. `content` is initials text for a human/unknown, OR
 * pass isAgent:true for the small square "Agent" tag treatment STUDY /
 * t-61's i3 specify (same row height/position, distinguished by a tag,
 * never a different row shape) instead of a circular avatar.
 */
export function avatar(content, { size = 'sm', isAgent = false } = {}) {
  if (isAgent) {
    return el('span', { class: `v2-agent-tag v2-agent-tag--${size}` }, [
      el('span', { class: 'v2-agent-tag__icon', html: icon('monitor') }),
      el('span', {}, 'Agent'),
    ]);
  }
  return el('span', { class: `v2-avatar v2-avatar--${size}` }, String(content || '').slice(0, 2).toUpperCase());
}

/** A single-line or multi-line text input (the peek-panel reply box, quick
 * filters, quick-add). Pass `area: true` for the multi-line variant. */
export function input({ placeholder, area = false, disabled = false } = {}) {
  const node = el(area ? 'textarea' : 'input', {
    class: `v2-input${area ? ' v2-input--area' : ''}`,
    placeholder,
    disabled: disabled || undefined,
  });
  return node;
}

/** An icon-only control button (panel header minimize/expand/close, panel
 * footer attach/send) - the `.v2-icon-btn` atom, wired with its glyph. */
export function iconButton(iconName, { title, onClick, disabled = false } = {}) {
  const b = el('button', { class: 'v2-icon-btn', type: 'button', title, disabled: disabled || undefined, html: icon(iconName) });
  if (onClick && !disabled) b.addEventListener('click', onClick);
  return b;
}

/**
 * The peek panel's footer bar: one input pinned at the bottom with icon
 * buttons alongside it (per SCR-20260816-cums.png: attach + send, here
 * generalized to any icon list so a sibling module can pick its own set).
 * `onSend`, if given, fires with the input's current value on the last
 * icon button's click (conventionally the send action).
 */
export function panelFooter({ placeholder = 'Reply…', icons = ['paperclip', 'send'], onSend } = {}) {
  const footer = el('div', { class: 'v2-panel__footer' });
  const box = input({ placeholder });
  footer.appendChild(box);
  icons.forEach((name, i) => {
    const isLast = i === icons.length - 1;
    const btn = iconButton(name, {
      title: isLast ? 'Send' : name,
      onClick: isLast && onSend ? () => onSend(box.value) : undefined,
    });
    // The last icon is conventionally the submit action - give it the same
    // filled-accent treatment as .v2-btn--primary so it reads as "the"
    // action, not a peer of the muted attach/etc. icons beside it.
    if (isLast) btn.classList.add('v2-icon-btn--primary');
    footer.appendChild(btn);
  });
  return footer;
}

/**
 * A button. `variant`: 'primary' | 'secondary' | 'ghost' (default secondary).
 * `state`: 'loading' | 'disabled' renders the matching visual state; a
 * loading button keeps its label but swaps in a spinning loader-2 glyph
 * and sets aria-busy, so layout doesn't jump between states.
 */
export function button(label, { variant = 'secondary', state, iconName, onClick } = {}) {
  const b = el('button', {
    class: `v2-btn v2-btn--${variant}${state ? ` v2-btn--${state}` : ''}`,
    type: 'button',
    disabled: state === 'disabled' || state === 'loading' || undefined,
    'aria-busy': state === 'loading' ? 'true' : undefined,
  });
  if (state === 'loading') b.appendChild(el('span', { html: icon('loader-2', 'v2-icon--spin') }));
  else if (iconName) b.appendChild(el('span', { html: icon(iconName) }));
  b.appendChild(el('span', { class: 'v2-btn__label' }, label));
  if (onClick && !(state === 'disabled' || state === 'loading')) b.addEventListener('click', onClick);
  return b;
}
