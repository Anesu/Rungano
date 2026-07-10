/**
 * Rungano — renderer orchestrator.
 *
 * Imports feature modules and wires them together. Each module owns one
 * concern — this file is only glue: fetch config, start listeners, wire
 * DOM events, and run init.
 */
import { state, els } from './state.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { initChips } from './chips.js';
import { startHealthListening } from './health.js';
import { initTheme, toggleTheme } from './theme.js';
import { initDragDrop } from './dragdrop.js';
import { loadVoices, updateVoiceCard, openCloneModal, closeCloneModal, saveClone } from './voices.js';
import { writeM3u } from './playlist.js';
import { synthesise, cancelSynthesis } from './synthesis.js';
import { loadRecentSessions, clearAllHistory } from './sessions.js';
import { openSettingsModal, saveSettings, resetSettings, updateSettingLabels, loadSettings } from './settings.js';

// ── Info tooltip ──────────────────────────────────────────────────────
function toggleTooltip() {
  els.tooltipPanel.hidden = !els.tooltipPanel.hidden;
}
document.addEventListener('click', (e) => {
  if (!els.tooltipPanel.hidden && !e.target.closest('#tooltip-panel') && e.target !== els.btnInfo) {
    els.tooltipPanel.hidden = true;
  }
});

// ── Export WAV ─────────────────────────────────────────────────────────
async function exportAllWav() {
  const done = state.sentences.filter(s => s.status === 'done');
  if (!done.length) { toast('No sentences to export.', true); return; }
  try {
    const ids = done.map(s => s.id).filter(Boolean);
    if (!ids.length) throw new Error('No entry ids in playlist');
    const res = await fetch(`${state.flaskUrl}/api/export/wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rungano-${new Date().toISOString().slice(0,10)}.wav`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast(`Exported ${done.length} sentences as WAV.`);
  } catch (e) { toast(`Export failed: ${e.message}`, true); }
}

// ── Save .m3u ──────────────────────────────────────────────────────────
async function saveM3u(openAfter = false) {
  const done = state.sentences.filter(s => s.status === 'done');
  if (!done.length) { toast('No sentences to save.', true); return; }
  try {
    const tracks = done.map(s => ({
      file: s.file,
      title: s.text || `Sentence ${s.index + 1}`,
      seconds: s.elapsed_sec,
    }));
    const opened = await writeM3u(tracks, { open: openAfter });
    if (!opened) toast(`Saved .m3u with ${done.length} tracks.`);
  } catch (e) { toast(`Save failed: ${e.message}`, true); }
}
async function playAllInVlc() { await saveM3u(true); }

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  // Fetch server URL from Electron main process (IPC)
  try {
    const config = await window.higgs?.getConfig();
    if (config?.flaskUrl) state.flaskUrl = config.flaskUrl;
  } catch {}

  startHealthListening();
  initTheme();
  loadSettings();
  initChips();
  loadVoices();
  loadRecentSessions();

  // Event wiring
  els.textInput.addEventListener('input', () => {
    els.charCount.textContent = els.textInput.value.split(/\s+/).filter(Boolean).length;
  });
  els.voiceSelect.addEventListener('change', () => {
    state.selectedVoice = els.voiceSelect.value;
    updateVoiceCard();
  });
  els.btnSynth.addEventListener('click', () => {
    if (state._abortController) { cancelSynthesis(); }
    else { synthesise(); }
  });
  els.btnAddVoice.addEventListener('click', openCloneModal);
  els.btnCloneCancel.addEventListener('click', closeCloneModal);
  els.btnCloneSave.addEventListener('click', saveClone);
  els.btnOutput.addEventListener('click', () => window.higgs?.openOutput ? window.higgs.openOutput() : '');
  els.btnRestart.addEventListener('click', async () => {
    toast('Restarting servers…');
    try { await window.higgs?.restartServers(); } catch {}
  });
  els.btnPlayAll.addEventListener('click', playAllInVlc);
  els.btnSettings.addEventListener('click', openSettingsModal);
  els.btnSettingsClose.addEventListener('click', saveSettings);
  els.btnSettingsReset.addEventListener('click', resetSettings);
  els.settingTemperature.addEventListener('input', updateSettingLabels);
  els.settingTopK.addEventListener('input', updateSettingLabels);
  els.settingTopP.addEventListener('input', updateSettingLabels);
  els.settingTokens.addEventListener('input', updateSettingLabels);
  els.btnTheme.addEventListener('click', toggleTheme);
  els.btnClearHistory.addEventListener('click', clearAllHistory);
  els.btnInfo.addEventListener('click', (e) => { e.stopPropagation(); toggleTooltip(); });
  els.btnExportWav.addEventListener('click', exportAllWav);
  els.btnSaveM3u.addEventListener('click', () => saveM3u(false));
  initDragDrop();

  // Ctrl+Enter to synthesise
  els.textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); synthesise(); }
  });

  // Global Escape to cancel
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === els.textInput) return;
    if (e.target.closest('#clone-modal') && !els.cloneModal.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (state._abortController) { cancelSynthesis(); }
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
