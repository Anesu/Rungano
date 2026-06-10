/**
 * Rungano — renderer logic (sentence-by-sentence architecture)
 *
 * The Higgs model performs best on short utterances. We split text into
 * sentences, synthesize each independently, and present them as a playlist.
 * No trimming, no crossfading, no concatenation — each sentence is a clean WAV.
 *
 * Control tokens (emotion, style, prosody, sfx) are fetched from the server
 * at startup. The renderer sends structured controls to the server, which
 * owns the canonical tag-construction path via build_input_text().
 */

const $ = (id) => document.getElementById(id);
const els = {
  textInput: $('text-input'), charCount: $('char-count'),
  voiceSelect: $('voice-select'), btnAddVoice: $('btn-add-voice'),
  btnSynth: $('btn-synth'), btnRestart: $('btn-restart'), btnOutput: $('btn-output'),
  spinnerSynth: $('spinner-synth'),
  audioPlayer: $('audio-player'), audioWrap: $('audio-wrap'), audioPlaceholder: $('audio-placeholder'), outputState: $('output-state'),
  sentenceList: $('sentence-list'), btnPlayAll: $('btn-play-all'),
  progressWrap: $('progress-wrap'), progressFill: $('progress-fill'), progressText: $('progress-text'),
  dotServer: $('dot-server'), textServer: $('text-server'),
  dotSglang: $('dot-sglang'), textSglang: $('text-sglang'),
  emotionChips: $('emotion-chips'), styleChips: $('style-chips'),
  prosodyChips: $('prosody-chips'), sfxChips: $('sfx-chips'),
  cloneModal: $('clone-modal'), cloneName: $('clone-name'), cloneAudio: $('clone-audio'),
  cloneTranscript: $('clone-transcript'), btnCloneCancel: $('btn-clone-cancel'), btnCloneSave: $('btn-clone-save'),
  toast: $('toast'),
  // New layout elements
  voiceCardDetail: $('voice-card-detail'), voiceKindBadge: $('voice-kind-badge'),
  voiceTranscript: $('voice-transcript'),
  settingsSummary: $('settings-summary'),
  recentSection: $('recent-section'), recentList: $('recent-list'),
  vramGaugeWrap: $('vram-gauge-wrap'), vramFill: $('vram-fill'), vramLabel: $('vram-label'),
  emotionCount: $('emotion-count'), styleCount: $('style-count'),
  prosodyCount: $('prosody-count'), sfxCount: $('sfx-count'),
};

// ── State ──────────────────────────────────────────────────────────────
const state = {
  voices: [], selectedVoice: "default",
  emotion: null, style: null, prosody: new Set(), sfx: new Map(),
  sglangReady: false,
  flaskUrl: 'http://127.0.0.1:7861',
  sentences: [],
  playbackIndex: -1,
  _abortController: null,
};

// ── API ────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${state.flaskUrl}${path}`, opts);
  if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || res.statusText); }
  return res.json();
}

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isError = false) {
  els.toast.textContent = msg; els.toast.hidden = false;
  els.toast.style.borderColor = isError ? 'var(--bad)' : 'var(--border)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}

// ── Chip UI (built from server catalogue) ──────────────────────────────
function buildChipRow(parent, items, mode = 'single', dataKey = 'token') {
  parent.innerHTML = '';
  const normalized = (typeof items[0] === 'string')
    ? items.map(s => ({ [dataKey]: s, label: s }))
    : items;
  for (const it of normalized) {
    const c = document.createElement('button');
    c.className = 'chip'; c.textContent = it.label || it[dataKey]; c.dataset.value = it[dataKey];
    if (it.suggested) c.title = `Onomatopoeia: ${it.suggested}`;
    c.addEventListener('click', () => handleChipClick(parent, c, it, mode));
    parent.appendChild(c);
  }
}

function handleChipClick(parent, chip, item, mode) {
  const category = parent.dataset.category, value = chip.dataset.value;
  if (mode === 'single') {
    [...parent.querySelectorAll('.chip')].forEach(c => c.classList.toggle('active', c === chip && !c.classList.contains('active')));
    const active = chip.classList.contains('active');
    if (category === 'emotion') state.emotion = active ? value : null;
    if (category === 'style') state.style = active ? value : null;
  } else if (mode === 'multi-prosody') {
    chip.classList.toggle('active');
    state.prosody.has(value) ? state.prosody.delete(value) : state.prosody.add(value);
  } else if (mode === 'multi-sfx') {
    chip.classList.toggle('active');
    if (state.sfx.has(value)) { state.sfx.delete(value); }
    else { const sug = item.suggested || value; const u = prompt(`Onomatopoeia for "${value}"?`, sug); state.sfx.set(value, u || sug); }
  }
  updateSettingsSummary();
  updateChipCounts();
}

async function initChips() {
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

function updateSettingsSummary() {
  const parts = [];
  if (state.emotion) parts.push(`emotion: ${state.emotion}`);
  if (state.style) parts.push(`style: ${state.style}`);
  if (state.prosody.size) parts.push(`prosody: ${[...state.prosody].join(', ')}`);
  if (state.sfx.size) parts.push(`sfx: ${[...state.sfx.keys()].join(', ')}`);
  els.settingsSummary.textContent = parts.length ? parts.join(' · ') : 'No effects selected';
}

function updateChipCounts() {
  els.emotionCount.textContent = state.emotion ? '(1)' : '';
  els.styleCount.textContent = state.style ? '(1)' : '';
  els.prosodyCount.textContent = state.prosody.size ? `(${state.prosody.size})` : '';
  els.sfxCount.textContent = state.sfx.size ? `(${state.sfx.size})` : '';
}

// ── Voices ────────────────────────────────────────────────────────────
async function loadVoices() {
  try {
    const { voices } = await api('/api/voices');
    state.voices = voices; els.voiceSelect.innerHTML = '';
    for (const v of voices) { const opt = document.createElement('option'); opt.value = v.id; opt.textContent = `${v.name}${v.kind === 'custom' ? '  •  custom' : ''}`; els.voiceSelect.appendChild(opt); }
    if (voices.length && !voices.find(v => v.id === state.selectedVoice)) state.selectedVoice = voices[0].id;
    els.voiceSelect.value = state.selectedVoice;
    updateVoiceCard();
  } catch (e) { els.voiceSelect.innerHTML = '<option>Server unavailable</option>'; }
}

function updateVoiceCard() {
  const voice = state.voices.find(v => v.id === state.selectedVoice);
  if (!voice) { els.voiceCardDetail.hidden = true; return; }
  els.voiceCardDetail.hidden = false;
  els.voiceKindBadge.textContent = voice.kind || 'preset';
  els.voiceKindBadge.style.background = voice.kind === 'custom'
    ? 'rgba(63,185,80,0.12)' : 'rgba(88,166,255,0.12)';
  els.voiceKindBadge.style.color = voice.kind === 'custom' ? 'var(--good)' : 'var(--accent)';
  els.voiceTranscript.textContent = (voice.transcript || 'No reference transcript').slice(0, 100);
}

// ── Sentence playlist ─────────────────────────────────────────────────
function renderSentenceList() {
  els.sentenceList.innerHTML = '';
  if (!state.sentences.length) { els.btnPlayAll.hidden = true; return; }
  for (const s of state.sentences) {
    const li = document.createElement('li');
    li.className = `sentence-item ${s.status}`;
    li.dataset.index = s.index;

    const idx = document.createElement('span'); idx.className = 's-idx'; idx.textContent = `${s.index + 1}`;
    const txt = document.createElement('span'); txt.className = 's-text';
    txt.textContent = s.text.length > 100 ? s.text.slice(0, 100) + '…' : s.text;
    txt.title = s.text;

    const meta = document.createElement('span'); meta.className = 's-meta';
    if (s.status === 'pending') { meta.textContent = 'waiting'; }
    else if (s.status === 'done') { meta.textContent = `${s.elapsed_sec}s · ${(s.bytes/1024).toFixed(0)}KB`; }
    else if (s.status === 'failed') { meta.textContent = 'failed'; meta.style.color = 'var(--bad)'; }

    if (s.status === 'done') {
      li.style.cursor = 'pointer';
      li.addEventListener('click', (e) => {
        // Don't trigger play if clicking the download button
        if (e.target.classList.contains('s-dl')) return;
        playSentence(s.index);
      });

      // Download button
      const dl = document.createElement('button');
      dl.className = 's-dl'; dl.title = 'Download WAV';
      dl.textContent = '⬇';
      dl.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSentence(s);
      });
      li.appendChild(dl);
    }

    li.appendChild(idx); li.appendChild(txt); li.appendChild(meta);
    els.sentenceList.appendChild(li);
  }
  els.btnPlayAll.hidden = !state.sentences.some(s => s.status === 'done');
  highlightCurrentSentence();
}

function downloadSentence(s) {
  const a = document.createElement('a');
  a.href = state.flaskUrl + s.file;
  a.download = `sentence-${s.index + 1}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function playSentence(index) {
  const s = state.sentences.find(x => x.index === index);
  if (!s || s.status !== 'done') return;
  state.playbackIndex = index;
  els.audioPlayer.src = state.flaskUrl + s.file + `?t=${Date.now()}`;
  els.audioPlayer.play().catch(() => {});
  highlightCurrentSentence();
}

function togglePlayPause() {
  if (els.audioPlayer.paused) {
    els.audioPlayer.play().catch(() => {});
  } else {
    els.audioPlayer.pause();
  }
}

function playPreviousSentence() {
  const prev = [...state.sentences].reverse().find(
    s => s.index < state.playbackIndex && s.status === 'done'
  );
  if (prev) playSentence(prev.index);
}

function playNextSentence() {
  const next = state.sentences.find(
    s => s.index > state.playbackIndex && s.status === 'done'
  );
  if (next) { playSentence(next.index); }
  else { state.playbackIndex = -1; highlightCurrentSentence(); }
}

function highlightCurrentSentence() {
  for (const li of els.sentenceList.children) {
    const idx = parseInt(li.dataset.index);
    li.classList.toggle('playing', idx === state.playbackIndex);
    // Show ▶ indicator on the currently playing sentence's index
    const idxSpan = li.querySelector('.s-idx');
    if (idxSpan) idxSpan.textContent = idx === state.playbackIndex ? '▶' : `${idx + 1}`;
  }
}

// ── Synthesise (streaming SSE) ─────────────────────────────────────────
// The /api/tts/batch/stream endpoint pushes each sentence as it completes.
// The renderer renders them progressively — no 90-second spinner.
// An AbortController lets the user cancel mid-batch.

function buildControlsPayload() {
  const ctrl = {};
  if (state.emotion) ctrl.emotion = state.emotion;
  if (state.style) ctrl.style = state.style;
  if (state.prosody.size) ctrl.prosody = [...state.prosody];
  if (state.sfx.size) ctrl.sfx = [...state.sfx.entries()];
  return Object.keys(ctrl).length ? ctrl : undefined;
}

async function synthesise() {
  const text = els.textInput.value.trim();
  if (!text) { toast('Type some text first.', true); return; }

  _enterSynthesisingState();
  state.sentences = [];
  state.playbackIndex = -1;
  renderSentenceList();

  const body = { text, voice_id: state.selectedVoice, volume: 1.8 };
  const controls = buildControlsPayload();
  if (controls) body.controls = controls;

  const controller = new AbortController();
  state._abortController = controller;

  try {
    const res = await fetch(`${state.flaskUrl}/api/tts/batch/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalSentences = 0;
    let doneCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === 'start') {
          totalSentences = event.total;
          state.sentences = Array.from({ length: totalSentences }, (_, i) => ({
            index: i, text: '', chars: 0, status: 'pending',
          }));
          els.outputState.textContent = `Sentence 0 of ${totalSentences}`;
          updateProgress(0, totalSentences);
        } else if (event.type === 'sentence') {
          state.sentences[event.index] = { ...event, status: 'done' };
          doneCount++;
          els.outputState.textContent = `Sentence ${doneCount} of ${totalSentences}`;
          updateProgress(doneCount, totalSentences);
          renderSentenceList();
          // Auto-play the first sentence as soon as it lands
          if (doneCount === 1) {
            els.audioPlayer.hidden = false;
            els.audioPlaceholder.hidden = true;
            playSentence(0);
          }
        } else if (event.type === 'error') {
          state.sentences[event.index] = {
            ...state.sentences[event.index], status: 'failed',
          };
          doneCount++;
          updateProgress(doneCount, totalSentences);
          renderSentenceList();
        } else if (event.type === 'done') {
          els.outputState.textContent = `${doneCount} sentences · ${event.elapsed_sec.toFixed(0)}s total`;
          toast(`Synthesised ${doneCount} sentences${event.failed ? ` (${event.failed} failed)` : ''}.`);
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      els.outputState.textContent = 'Cancelled.';
      toast('Synthesis cancelled.');
      // Mark remaining pending sentences as failed
      state.sentences.forEach(s => { if (s.status === 'pending') s.status = 'failed'; });
      renderSentenceList();
    } else {
      toast(`Synthesis failed: ${e.message}`, true);
      els.outputState.textContent = 'Error.';
      state.sentences.forEach(s => { if (s.status !== 'done') s.status = 'failed'; });
      renderSentenceList();
    }
  } finally {
    _leaveSynthesisingState();
    state._abortController = null;
  }
}

function _enterSynthesisingState() {
  els.btnSynth.textContent = 'Cancel';
  els.btnSynth.classList.add('btn-danger');
  els.spinnerSynth.hidden = false;
  els.progressWrap.hidden = false;
  // Hide audio player until first sentence lands
  els.audioPlayer.hidden = true;
  els.audioPlaceholder.hidden = false;
}

function _leaveSynthesisingState() {
  els.btnSynth.textContent = 'Synthesise All';
  els.btnSynth.classList.remove('btn-danger');
  els.spinnerSynth.hidden = true;
}

function cancelSynthesis() {
  if (state._abortController) {
    state._abortController.abort();
  }
}

function updateProgress(done, total) {
  const pct = total > 0 ? (done / total * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `${done} / ${total}`;
  if (done >= total) setTimeout(() => { els.progressWrap.hidden = true; }, 3000);
}

// ── Health (IPC-driven from Electron main process) ─────────────────────
// The main process polls Flask + SGLang every 10s and pushes results via
// the higgs:health IPC event. The renderer is a pure consumer — no duplicate
// HTTP polling, no hardcoded interval. In dev/browser mode (no window.higgs),
// the UI stays at "Connecting…" which is correct for a desktop-only app.

function updateHealthUI(flaskReady, sglangReady, flaskBody) {
  if (flaskReady) {
    els.dotServer.className = 'dot ok'; els.textServer.textContent = 'Flask: ready';
  } else {
    els.dotServer.className = 'dot bad'; els.textServer.textContent = 'Flask: down';
  }
  if (sglangReady) {
    els.dotSglang.className = 'dot ok';
    const models = flaskBody?.sglang_models || [];
    const gpu = flaskBody?.gpu || {};
    const modelName = models[0] ? models[0].split('/').pop() : 'ready';
    els.textSglang.textContent = modelName;
    // VRAM gauge
    if (gpu.vram_total_mb) {
      els.vramGaugeWrap.hidden = false;
      const freeGB = gpu.vram_free_mb / 1024;
      const pct = (gpu.vram_free_mb / gpu.vram_total_mb) * 100;
      els.vramFill.style.width = `${pct}%`;
      els.vramLabel.textContent = `${freeGB.toFixed(1)}GB`;
      if (freeGB > 2) els.vramFill.style.background = 'var(--vram-green)';
      else if (freeGB > 1) els.vramFill.style.background = 'var(--vram-yellow)';
      else els.vramFill.style.background = 'var(--vram-red)';
    }
    if (!state.sglangReady) {
      state.sglangReady = true;
      initChips();
    }
  } else {
    els.dotSglang.className = 'dot bad'; els.textSglang.textContent = 'Model: not ready';
    els.vramGaugeWrap.hidden = true;
    state.sglangReady = false;
  }
}

function startHealthListening() {
  if (!window.higgs?.onHealth) return;
  window.higgs.onHealth((payload) => {
    updateHealthUI(payload.flask, payload.sglang, payload.flaskBody);
  });
}

// ── Clone modal ───────────────────────────────────────────────────────
function openCloneModal() {
  els.cloneName.value = ''; els.cloneAudio.value = ''; els.cloneTranscript.value = '';
  els.cloneModal.hidden = false; els.cloneModal.style.display = 'flex';
}
function closeCloneModal() { els.cloneModal.hidden = true; els.cloneModal.style.display = 'none'; }
async function saveClone() {
  const name = els.cloneName.value.trim(); const file = els.cloneAudio.files[0]; const transcript = els.cloneTranscript.value.trim();
  if (!name || !file || !transcript) { toast('Name, audio file, and transcript are all required.', true); return; }
  const fd = new FormData(); fd.append('name', name); fd.append('transcript', transcript); fd.append('audio', file);
  try {
    const r = await fetch(`${state.flaskUrl}/api/voices/custom`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    toast(`Voice "${name}" added.`); closeCloneModal(); await loadVoices();
    const data = await r.json(); state.selectedVoice = data.id; els.voiceSelect.value = data.id;
  } catch (e) { toast(`Save failed: ${e.message}`, true); }
}

// ── Recent generations ─────────────────────────────────────────────────
async function loadRecentGenerations() {
  try {
    const { entries } = await api('/api/history');
    if (!entries.length) return;
    els.recentSection.hidden = false;
    els.recentList.innerHTML = '';
    const recent = entries.slice(0, 5);
    for (const e of recent) {
      const div = document.createElement('div');
      div.className = 'recent-item';
      const text = document.createElement('span'); text.className = 'r-text';
      text.textContent = (e.text || '').slice(0, 80);
      text.title = e.text;
      const meta = document.createElement('span'); meta.className = 'r-meta';
      const age = Math.round((Date.now() / 1000 - e.created_at) / 60);
      meta.textContent = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      const play = document.createElement('span'); play.className = 'r-play'; play.textContent = '▶';
      div.appendChild(text); div.appendChild(meta); div.appendChild(play);
      div.addEventListener('click', () => {
        const file = e.file.startsWith('/') ? e.file : `/audio/${e.file}`;
        els.audioPlayer.src = state.flaskUrl + file;
        els.audioPlayer.hidden = false;
        els.audioPlaceholder.hidden = true;
        els.audioPlayer.play().catch(() => {});
      });
      els.recentList.appendChild(div);
    }
  } catch (e) {
    // History endpoint may not be available yet — silent
  }
}

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  // Fetch server URL from Electron main process (IPC). Falls back to default
  // hardcoded URL if preload is absent (browser dev mode).
  try {
    const config = await window.higgs?.getConfig();
    if (config?.flaskUrl) state.flaskUrl = config.flaskUrl;
  } catch {}

  // Health updates come from main process via IPC — no duplicate HTTP polling.
  startHealthListening();

  // Try to load controls catalogue early; if server isn't up yet,
  // the IPC health handler will retry initChips() when SGLang transitions ready.
  initChips();
  loadVoices();
  loadRecentGenerations();

  els.textInput.addEventListener('input', () => { els.charCount.textContent = els.textInput.value.length; });
  els.voiceSelect.addEventListener('change', () => { state.selectedVoice = els.voiceSelect.value; updateVoiceCard(); });
  els.btnSynth.addEventListener('click', () => {
    if (state._abortController) { cancelSynthesis(); }
    else { synthesise(); }
  });
  els.btnAddVoice.addEventListener('click', openCloneModal);
  els.btnCloneCancel.addEventListener('click', closeCloneModal);
  els.btnCloneSave.addEventListener('click', saveClone);
  els.btnOutput.addEventListener('click', () => window.higgs?.openOutput ? window.higgs.openOutput() : '');
  els.btnRestart.addEventListener('click', async () => { toast('Restarting servers…'); try { await window.higgs?.restartServers(); } catch {} });
  els.btnPlayAll.addEventListener('click', () => {
    const first = state.sentences.find(s => s.status === 'done');
    if (first) { playSentence(first.index); }
  });

  // Auto-advance: when current audio ends, play next
  els.audioPlayer.addEventListener('ended', playNextSentence);
  els.audioPlayer.addEventListener('error', () => { playNextSentence(); });

  // Ctrl+Enter to synthesise
  els.textInput.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); synthesise(); } });

  // Global keyboard shortcuts for playback (only when textarea is not focused)
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === els.textInput) return;  // don't steal typing
    if (e.target.closest('#clone-modal') && !els.cloneModal.hidden) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (state.sentences.some(s => s.status === 'done')) togglePlayPause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      playNextSentence();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      playPreviousSentence();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (state._abortController) { cancelSynthesis(); }
      else { els.audioPlayer.pause(); state.playbackIndex = -1; highlightCurrentSentence(); }
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
