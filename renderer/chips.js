/**
 * Control-token chip UI — built from the server's /api/controls catalogue.
 */
import { state, els, LABELS } from './state.js';
import { api } from './api.js';

export async function initChips() {
  try {
    const catalogue = await api('/api/controls');
    buildChipRow(els.emotionChips, catalogue.emotions, 'single');
    buildChipRow(els.styleChips, catalogue.styles, 'single');
    buildChipRow(els.prosodyChips, catalogue.prosody, 'multi-prosody');
    buildChipRow(els.sfxChips, catalogue.sfx, 'multi-sfx');
  } catch (e) {
    console.warn('Controls catalogue not available:', e.message);
  }
}

function buildChipRow(parent, items, mode = 'single', dataKey = 'token') {
  parent.innerHTML = '';
  const normalized = (typeof items[0] === 'string')
    ? items.map(s => ({ [dataKey]: s, label: LABELS[s] || s }))
    : items.map(it => ({ ...it, label: LABELS[it[dataKey]] || it.label || it[dataKey] }));
  for (const it of normalized) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = it.label || it[dataKey];
    c.dataset.value = it[dataKey];
    if (it.suggested) c.title = `Onomatopoeia: ${it.suggested}`;
    c.addEventListener('click', () => handleChipClick(parent, c, it, mode));
    parent.appendChild(c);
  }
}

function handleChipClick(parent, chip, item, mode) {
  const category = parent.dataset.category;
  const value = chip.dataset.value;
  if (mode === 'single') {
    [...parent.querySelectorAll('.chip')].forEach(c =>
      c.classList.toggle('active', c === chip && !c.classList.contains('active'))
    );
    const active = chip.classList.contains('active');
    if (category === 'emotion') state.emotion = active ? value : null;
    if (category === 'style') state.style = active ? value : null;
  } else if (mode === 'multi-prosody') {
    chip.classList.toggle('active');
    state.prosody.has(value) ? state.prosody.delete(value) : state.prosody.add(value);
  } else if (mode === 'multi-sfx') {
    chip.classList.toggle('active');
    if (state.sfx.has(value)) {
      state.sfx.delete(value);
    } else {
      const sug = item.suggested || value;
      const u = prompt(`Onomatopoeia for "${value}"?`, sug);
      state.sfx.set(value, u || sug);
    }
  }
  updateSettingsSummary();
  updateChipCounts();
}

export function updateSettingsSummary() {
  const parts = [];
  if (state.emotion) parts.push(`emotion: ${state.emotion}`);
  if (state.style) parts.push(`style: ${state.style}`);
  if (state.prosody.size) parts.push(`prosody: ${[...state.prosody].join(', ')}`);
  if (state.sfx.size) parts.push(`sfx: ${[...state.sfx.keys()].join(', ')}`);
  els.settingsSummary.textContent = parts.length ? parts.join(' · ') : 'No effects selected';
}

export function updateChipCounts() {
  els.emotionCount.textContent = state.emotion ? '(1)' : '';
  els.styleCount.textContent = state.style ? '(1)' : '';
  els.prosodyCount.textContent = state.prosody.size ? `(${state.prosody.size})` : '';
  els.sfxCount.textContent = state.sfx.size ? `(${state.sfx.size})` : '';
}
