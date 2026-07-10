/**
 * Model settings modal — temperature, top-K, top-P, max tokens, default voice.
 */
import { state, els } from './state.js';
import { toast } from './toast.js';

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
