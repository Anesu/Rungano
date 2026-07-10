/**
 * Model settings modal — temperature, top-K, top-P, max tokens, default voice.
 */
import { state, els } from './state.js';
import { toast } from './toast.js';

const SETTINGS_KEY = 'rungano-model-settings';

/** Restore persisted model parameters into state. Call once at startup. */
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof saved.temperature === 'number') state.temperature = saved.temperature;
    if (typeof saved.topK === 'number') state.topK = saved.topK;
    if (typeof saved.topP === 'number') state.topP = saved.topP;
    if (typeof saved.maxTokens === 'number') state.maxTokens = saved.maxTokens;
  } catch {}
}

export function openSettingsModal() {
  els.settingTemperature.value = state.temperature;
  els.settingTopK.value = state.topK;
  els.settingTopP.value = state.topP;
  els.settingTokens.value = state.maxTokens;
  els.settingDefaultVoice.innerHTML = '<option value="">Last used</option>';
  for (const v of state.voices) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    if (v.id === (localStorage.getItem('rungano-default-voice') || '')) opt.selected = true;
    els.settingDefaultVoice.appendChild(opt);
  }
  updateSettingLabels();
  els.settingsModal.hidden = false;
  els.settingsModal.style.display = 'flex';
}

export function closeSettingsModal() {
  els.settingsModal.hidden = true;
  els.settingsModal.style.display = 'none';
}

export function updateSettingLabels() {
  els.tempValue.textContent = parseFloat(els.settingTemperature.value).toFixed(2);
  els.topkValue.textContent = els.settingTopK.value;
  els.toppValue.textContent = parseFloat(els.settingTopP.value).toFixed(2);
  els.tokensValue.textContent = els.settingTokens.value;
}

export function saveSettings() {
  state.temperature = parseFloat(els.settingTemperature.value);
  state.topK = parseInt(els.settingTopK.value);
  state.topP = parseFloat(els.settingTopP.value);
  state.maxTokens = parseInt(els.settingTokens.value);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    temperature: state.temperature, topK: state.topK,
    topP: state.topP, maxTokens: state.maxTokens,
  }));
  const defaultVoice = els.settingDefaultVoice.value;
  if (defaultVoice) localStorage.setItem('rungano-default-voice', defaultVoice);
  else localStorage.removeItem('rungano-default-voice');
  closeSettingsModal();
  toast('Settings saved.');
}

export function resetSettings() {
  els.settingTemperature.value = 0.8;
  els.settingTopK.value = 50;
  els.settingTopP.value = 0.9;
  els.settingTokens.value = 2048;
  updateSettingLabels();
}
