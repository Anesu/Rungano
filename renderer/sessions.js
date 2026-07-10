/**
 * Recent sessions — history cards, session playback, export, folder open.
 */
import { state, els } from './state.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { writeM3u } from './playlist.js';

export async function loadRecentSessions() {
  try {
    const { sessions } = await api('/api/history/sessions');
    if (!sessions.length) { els.sessionCards.innerHTML = ''; return; }
    els.sessionCards.innerHTML = '';
    for (const s of sessions.slice(0, 8)) {
      const card = document.createElement('div');
      card.className = 'session-card';

      const text = document.createElement('span');
      text.className = 'session-text';
      text.textContent = (s.first_text || 'Untitled').slice(0, 80);
      text.title = s.first_text;

      const meta = document.createElement('span');
      meta.className = 'session-meta';
      const d = new Date(s.created_at * 1000);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      meta.textContent = `${d.getDate()} ${months[d.getMonth()]} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} · ${s.sentence_count} sent. · ${Math.round(s.total_elapsed_sec)}s`;

      const actions = document.createElement('span');
      actions.className = 'session-actions';

      const btnPlay = document.createElement('button');
      btnPlay.textContent = '▶';
      btnPlay.title = 'Play session in VLC';
      btnPlay.addEventListener('click', (e) => { e.stopPropagation(); openSessionInVlc(s); });

      const btnExport = document.createElement('button');
      btnExport.textContent = '⬇';
      btnExport.title = 'Export WAV';
      btnExport.addEventListener('click', (e) => { e.stopPropagation(); exportSessionWav(s); });

      const btnOpen = document.createElement('button');
      btnOpen.textContent = '📁';
      btnOpen.title = 'Open folder';
      btnOpen.addEventListener('click', (e) => { e.stopPropagation(); openSessionFolder(s); });

      actions.appendChild(btnPlay);
      actions.appendChild(btnExport);
      actions.appendChild(btnOpen);
      card.appendChild(text);
      card.appendChild(meta);
      card.appendChild(actions);
      card.addEventListener('click', () => openSessionInVlc(s));
      els.sessionCards.appendChild(card);
    }
  } catch (e) { /* silent */ }
}

async function openSessionInVlc(s) {
  const files = s.files || [];
  if (!files.length) { await exportSessionWav(s); return; } // legacy entries
  const tracks = files.map((f, i) => ({
    file: `/audio/${f}`,
    title: i === 0 ? (s.first_text || `Sentence 1`) : `Sentence ${i + 1}`,
  }));
  const opened = await writeM3u(tracks, { open: true, filename: `rungano-session-${s.date}.m3u` });
  if (!opened) toast('Saved session playlist.');
}

async function exportSessionWav(s) {
  if (!s.ids.length) return;
  try {
    const res = await fetch(`${state.flaskUrl}/api/export/wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: s.ids }),
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rungano-${s.date}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast(`Exported ${s.sentence_count} sentences.`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, true);
  }
}

async function openSessionFolder(s) {
  try {
    const cfg = await window.higgs?.getConfig();
    if (cfg?.outputDir) window.higgs?.openFile(`${cfg.outputDir}\\${s.date}`);
  } catch {}
}

export async function clearAllHistory() {
  if (!confirm('Delete ALL synthesis history and generated audio files? This cannot be undone.')) return;
  try {
    const { entries } = await api('/api/history');
    for (const e of entries) {
      await api(`/api/history/${e.id}`, { method: 'DELETE' });
    }
    els.sessionCards.innerHTML = '';
    toast('History cleared.');
    loadRecentSessions();
  } catch (e) {
    toast('Failed to clear history.', true);
  }
}
