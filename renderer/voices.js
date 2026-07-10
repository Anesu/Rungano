/**
 * Voice management — dropdown, clone modal, upload flow.
 */
import { state, els } from './state.js';
import { api } from './api.js';
import { toast } from './toast.js';

export async function loadVoices() {
  try {
    const { voices } = await api('/api/voices');
    state.voices = voices;
    els.voiceSelect.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      els.voiceSelect.appendChild(opt);
    }
    if (voices.length && !voices.find(v => v.id === state.selectedVoice)) {
      state.selectedVoice = voices[0].id;
    }
    const defaultVoice = localStorage.getItem('rungano-default-voice');
    if (defaultVoice && voices.find(v => v.id === defaultVoice)) {
      state.selectedVoice = defaultVoice;
    }
    els.voiceSelect.value = state.selectedVoice;
    updateVoiceCard();
  } catch (e) {
    els.voiceSelect.innerHTML = '<option>Server unavailable</option>';
  }
}

export function updateVoiceCard() {
  const voice = state.voices.find(v => v.id === state.selectedVoice);
  if (!voice) { els.inputLang.hidden = true; return; }
  const lang = voice.language || (voice.kind === 'custom' ? 'unknown' : 'any');
  if (lang === 'any') { els.inputLang.hidden = true; return; }
  els.inputLang.hidden = false;
  els.inputLang.textContent = lang.toUpperCase();
}

export function openCloneModal() {
  els.cloneName.value = '';
  els.cloneAudio.value = '';
  els.cloneTranscript.value = '';
  els.cloneModal.hidden = false;
  els.cloneModal.style.display = 'flex';
}

export function closeCloneModal() {
  els.cloneModal.hidden = true;
  els.cloneModal.style.display = 'none';
}

export async function saveClone() {
  const name = els.cloneName.value.trim();
  const file = els.cloneAudio.files[0];
  const transcript = els.cloneTranscript.value.trim();
  if (!name || !file || !transcript) {
    toast('Name, audio file, and transcript are all required.', true);
    return;
  }
  const fd = new FormData();
  fd.append('name', name);
  fd.append('language', els.cloneLanguage.value);
  fd.append('transcript', transcript);
  fd.append('audio', file);
  try {
    const r = await fetch(`${state.flaskUrl}/api/voices/custom`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    toast(`Voice "${name}" added.`);
    closeCloneModal();
    await loadVoices();
    const data = await r.json();
    state.selectedVoice = data.id;
    els.voiceSelect.value = data.id;
  } catch (e) {
    toast(`Save failed: ${e.message}`, true);
  }
}
