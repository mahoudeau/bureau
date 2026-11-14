// System, paper or ink, kept in localStorage. Paper (light) is the default;
// system is a choice you make. index.html reads the same key before first
// paint.

const KEY = 'bureau_theme';
const ATTR = { paper: 'light', ink: 'dark' };

export const THEMES = ['system', 'paper', 'ink'];

export function getTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* no storage: the default */ }
  return THEMES.includes(saved) ? saved : 'paper';
}

export function setTheme(name) {
  const theme = THEMES.includes(name) ? name : 'paper';
  try {
    if (theme === 'paper') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch { /* it still applies to this page */ }
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', ATTR[theme]);
  return theme;
}
