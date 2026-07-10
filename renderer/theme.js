/**
 * Theme toggle — light/dark with system detection and localStorage persistence.
 */
import { els } from './state.js';

export function initTheme() {
  const saved = localStorage.getItem('rungano-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'light' ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.btnTheme.textContent = theme === 'light' ? '☀' : '🌙';
  localStorage.setItem('rungano-theme', theme);
}
