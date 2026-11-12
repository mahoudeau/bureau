// System, paper or ink, kept in localStorage. index.html reads the same key
// before first paint.

const KEY = 'bureau_theme';
const ATTR = { paper: 'light', ink: 'dark' };

export const THEMES = ['system', 'paper', 'ink'];

export function getTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* no storage: follow the system */ }
  return ATTR[saved] ? saved : 'system';
}

export function setTheme(name) {
  const theme = ATTR[name] ? name : 'system';
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch { /* it still applies to this page */ }
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', ATTR[theme]);
  return theme;
}
