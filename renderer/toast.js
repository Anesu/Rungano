/**
 * Toast notification — transient status messages.
 */
import { els } from './state.js';

let toastTimer = null;

export function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  els.toast.style.borderColor = isError ? 'var(--bad)' : 'var(--border)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}
