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
import { renderSentenceList, downloadSentence } from './playlist.js';
import { synthesise, cancelSynthesis, buildControlsPayload } from './synthesis.js';
import { loadRecentSessions, clearAllHistory } from './sessions.js';
import { openSettingsModal, closeSettingsModal, saveSettings, resetSettings, updateSettingLabels } from './settings.js';

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
    const ids = done.map(s => s.file.split('/').pop().replace('.wav', ''));
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
    let outputDir = '';
    try { const cfg = await window.higgs?.getConfig(); outputDir = cfg?.outputDir || ''; } catch {}
    const lines = ['#EXTM3U'];
    let m3uPath = '';
    for (const s of done) {
      const name = (s.text || `Sentence ${s.index + 1}`).slice(0, 60);
      lines.push(`#EXTINF:${Math.ceil(s.elapsed_sec || 2)},${name}`);
      const relPath = s.file.replace(/^\/audio\//, '');
      if (outputDir) {
        const abs = `${outputDir}\\${relPath}`.replace(/\//g, '\\');
        lines.push(abs);
        if (!m3uPath) m3uPath = `${outputDir}\\rungano-playlist.m3u`.replace(/\//g, '\\');
      } else {
        lines.push(`${state.flaskUrl}/audio/${relPath}`);
      }
    }
    const content = lines.join('\n');

    if (openAfter && m3uPath) {
      // Write to output dir so VLC can find the file, then open it
      await window.higgs?.writeFile(m3uPath, content);
      window.higgs?.openFile(m3uPath);
    } else {
      // Browser download fallback
      const blob = new Blob([content], { type: 'audio/x-mpegurl' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rungano-playlist.m3u';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast(`Saved .m3u with ${done.length} tracks.`);
    }
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
