/**
 * HTTP fetch wrapper — all server communication goes through here.
 */
import { state } from './state.js';

export async function api(path, opts = {}) {
  const res = await fetch(`${state.flaskUrl}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}
