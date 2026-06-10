/**
 * Higgs TTS — renderer logic
 *
 * No frameworks. Plain DOM + fetch. Mirrors the Koko renderer's discipline.
 *
 * State model:
 *   - `state.voices`         list of voice records (presets + custom)
 *   - `state.selectedVoice`  current voice id
 *   - `state.emotion`        single string | null
 *   - `state.style`          single string | null
 *   - `state.prosody`        array of strings
 *   - `state.sfx`            array of {token, onomatopoeia}
 *   - `state.params`         { temperature, top_k, max_new_tokens }
 */

const $ = (id) => document.getElementById(id);
const els = {
  textInput: $('text-input'),
  charCount: $('char-count'),
  voiceSelect: $('voice-select'),
  btnAddVoice: $('btn-add-voice'),
  btnSynth: $('btn-synth'),
  btnRestart: $('btn-restart'),
  btnOutput: $('btn-output'),
  spinnerSynth: $('spinner-synth'),
  audioPlayer: $('audio-player'),
  elapsedText: $('elapsed-text'),
  outputState: $('output-state'),
  historyList: $('history-list'),
  btnRefreshHistory: $('btn-refresh-history'),
  dotServer: $('dot-server'),
  textServer: $('text-server'),
  dotSglang: $('dot-sglang'),
  textSglang: $('text-sglang'),
  // chips
  emotionChips: $('emotion-chips'),
  styleChips: $('style-chips'),
  prosodyChips: $('prosody-chips'),
  sfxChips: $('sfx-chips'),
  // advanced params
  paramTemperature: $('param-temperature'),
  paramTopK: $('param-topk'),
  paramMaxTok: $('param-maxtok'),
  // modal
  cloneModal: $('clone-modal'),
  cloneName: $('clone-name'),
  cloneAudio: $('clone-audio'),
  cloneTranscript: $('clone-transcript'),
  btnCloneCancel: $('btn-clone-cancel'),
  btnCloneSave: $('btn-clone-save'),
  // toast
  toast: $('toast'),
};

// ── Control token catalogues (mirror server/higgs/core.py) ──────────
const EMOTIONS = ["elation","amusement","enthusiasm","determination","pride","contentment",
  "affection","relief","contemplation","confusion","surprise","awe","longing","arousal",
  "anger","fear","disgust","bitterness","sadness","shame","helplessness"];
const STYLES = ["singing","shouting","whispering"];
const PROSODY = ["speed_very_slow","speed_slow","speed_fast","speed_very_fast",
  "pitch_low","pitch_high","pause","long_pause","expressive_high","expressive_low"];
const SFX = [
  { token: "cough",     suggested: "Ahem" },
  { token: "laughter",  suggested: "Haha / Hehe" },
  { token: "crying",    suggested: "Boohoo / Sob" },
  { token: "screaming", suggested: "Ahh / Aaah" },
  { token: "burping",   suggested: "Burp" },
  { token: "humming",   suggested: "Hmm / Mmm" },
  { token: "sigh",      suggested: "Uh / Ahh" },
  { token: "sniff",     suggested: "Sff" },
  { token: "sneeze",    suggested: "Achoo" },
];

const state = {
  voices: [],
  selectedVoice: "default",
  emotion: null,
  style: null,
  prosody: new Set(),
  sfx: new Map(),  // token -> onomatopoeia
  params: { temperature: 0.8, top_k: 50, max_new_tokens: 4096 },
  sglangReady: false,
};

// ── API helpers ────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = `http://127.0.0.1:7861${path}`;
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Toast ──────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  els.toast.style.borderColor = isError ? 'var(--bad)' : 'var(--border)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
}

// ── Chips ─────────────────────────────────────────────────────────
function buildChipRow(parent, items, mode = 'single', dataKey = 'token') {
  parent.innerHTML = '';
  for (const it of (typeof items[0] === 'string' ? items.map(s => ({ [dataKey]: s, label: s })) : items)) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = it.label || it[dataKey];
    c.dataset.value = it[dataKey];
    if (it.suggested) c.title = `Suggested onomatopoeia: ${it.suggested}`;
    c.addEventListener('click', () => handleChipClick(parent, c, it, mode));
    parent.appendChild(c);
  }
}

function handleChipClick(parent, chip, item, mode) {
  const category = parent.dataset.category;
  const value = chip.dataset.value;
  if (mode === 'single') {
    // Deactivate siblings, toggle self
    [...parent.querySelectorAll('.chip')].forEach((c) => c.classList.toggle('active', c === chip && !c.classList.contains('active')));
    const isActive = chip.classList.contains('active');
    if (category === 'emotion') state.emotion = isActive ? value : null;
    if (category === 'style')   state.style   = isActive ? value : null;
  } else if (mode === 'multi-prosody') {
    chip.classList.toggle('active');
    if (state.prosody.has(value)) state.prosody.delete(value);
    else state.prosody.add(value);
  } else if (mode === 'multi-sfx') {
    chip.classList.toggle('active');
    if (state.sfx.has(value)) {
      state.sfx.delete(value);
    } else {
      // For SFX, prompt for onomatopoeia (or use suggested)
      const sug = item.suggested || value;
      const user = prompt(`Onomatopoeia for "${value}"? (suggested: ${sug})`, sug);
      state.sfx.set(value, user || sug);
    }
  }
}

function initChips() {
  buildChipRow(els.emotionChips, EMOTIONS, 'single', 'token');
  buildChipRow(els.styleChips,   STYLES,   'single', 'token');
  buildChipRow(els.prosodyChips, PROSODY,  'multi-prosody', 'token');
  buildChipRow(els.sfxChips,     SFX,      'multi-sfx', 'token');
}

// ── Build input text with control tokens ─────────────────────────
function buildInputText() {
  const raw = els.textInput.value;
  // If the user has already typed any control tags inline, respect them.
  // Otherwise, prepend the global selections.
  const hasInline = /<\|[a-z]+:[a-z_]+\|>/.test(raw);
  if (hasInline) return raw;

  const tags = [];
  if (state.emotion) tags.push(`<|emotion:${state.emotion}|>`);
  if (state.style)   tags.push(`<|style:${state.style}|>`);
  for (const p of state.prosody) tags.push(`<|prosody:${p}|>`);
  for (const [token, ono] of state.sfx) tags.push(`<|sfx:${token}|>${ono}`);
  return tags.join('') + raw;
}

// ── Voices ───────────────────────────────────────────────────────
async function loadVoices() {
  try {
    const { voices } = await api('/api/voices');
    state.voices = voices;
    els.voiceSelect.innerHTML = '';
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name}${v.kind === 'custom' ? '  •  custom' : ''}`;
      els.voiceSelect.appendChild(opt);
    }
    if (voices.length && !voices.find((v) => v.id === state.selectedVoice)) {
      state.selectedVoice = voices[0].id;
    }
    els.voiceSelect.value = state.selectedVoice;
  } catch (e) {
    console.warn('loadVoices failed:', e);
    els.voiceSelect.innerHTML = '<option>Server unavailable</option>';
  }
}

// ── Synthesise ───────────────────────────────────────────────────
async function synthesise() {
  const text = buildInputText().trim();
  if (!text) { toast('Type some text first.', true); return; }

  els.btnSynth.disabled = true;
  els.spinnerSynth.hidden = false;
  els.outputState.textContent = 'Synthesising…';
  els.elapsedText.textContent = '';

  const t0 = performance.now();
  try {
    // Auto-detect: use chunked endpoint for long text (>150 chars)
    const useChunked = text.length > 150;
    const endpoint = useChunked ? '/api/tts/long' : '/api/tts';
    const body = {
      text,
      voice_id: state.selectedVoice,
      temperature: state.params.temperature,
      top_k: state.params.top_k,
      max_new_tokens: state.params.max_new_tokens,
      volume: 1.8,
      chunk_size: 150,
    };
    const result = await api(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    const chunkInfo = result.chunks ? ` · ${result.chunks} chunks` : '';
    els.elapsedText.textContent = `${elapsed}s${chunkInfo} · ${(result.bytes / 1024).toFixed(1)} KB`;
    els.outputState.textContent = `Ready (${result.elapsed_sec}s server-side${result.volume_applied ? ', vol ' + result.volume_applied + 'x' : ''})`;
    els.audioPlayer.src = result.file + `?t=${Date.now()}`;
    els.audioPlayer.play().catch(() => { /* user gesture required */ });
    loadHistory();
  } catch (e) {
    toast(`Synthesis failed: ${e.message}`, true);
    els.outputState.textContent = 'Error.';
  } finally {
    els.btnSynth.disabled = false;
    els.spinnerSynth.hidden = true;
  }
}

// ── History ──────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const { entries } = await api('/api/history');
    els.historyList.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      li.title = `Click to play · ${e.text}`;
      const text = document.createElement('span');
      text.className = 'h-text';
      text.textContent = e.text.length > 80 ? e.text.slice(0, 80) + '…' : e.text;
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      meta.textContent = `${e.elapsed_sec}s`;
      const del = document.createElement('button');
      del.className = 'h-del';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await api(`/api/history/${e.id}`, { method: 'DELETE' });
        loadHistory();
      });
      li.appendChild(text);
      li.appendChild(meta);
      li.appendChild(del);
      li.addEventListener('click', () => {
        els.audioPlayer.src = `/audio/${e.file}?t=${Date.now()}`;
        els.audioPlayer.play().catch(() => {});
      });
      els.historyList.appendChild(li);
    }
  } catch (e) {
    console.warn('loadHistory failed:', e);
  }
}

// ── Health polling ───────────────────────────────────────────────
// Two channels:
//   1. Direct HTTP to Flask /api/health (primary — always works)
//   2. IPC from Electron main (secondary — for startup-failed alerts)
// Poll every 8s.

async function pollHealthDirect() {
  try {
    const r = await fetch('http://127.0.0.1:7861/api/health');
    const d = await r.json();
    if (d.flask_ready) {
      els.dotServer.className = 'dot ok';
      els.textServer.textContent = 'Flask: ready';
    } else {
      els.dotServer.className = 'dot bad';
      els.textServer.textContent = 'Flask: down';
    }
    if (d.sglang_ready) {
      els.dotSglang.className = 'dot ok';
      const models = d.sglang_models || [];
      const gpu = d.gpu || {};
      const vram = gpu.vram_free_mb ? ` (${(gpu.vram_free_mb/1024).toFixed(1)}GB free)` : '';
      els.textSglang.textContent = `Model: ${models[0] || 'ready'}${vram}`;
      state.sglangReady = true;
    } else {
      els.dotSglang.className = 'dot bad';
      const gpu = d.gpu || {};
      const vram = gpu.vram_free_mb ? ` (${(gpu.vram_free_mb/1024).toFixed(1)}GB free)` : '';
      els.textSglang.textContent = `Model: not ready${vram}`;
      state.sglangReady = false;
    }
  } catch (e) {
    els.dotServer.className = 'dot bad';
    els.textServer.textContent = 'Flask: unreachable';
    els.dotSglang.className = 'dot bad';
    els.textSglang.textContent = 'Model: unknown';
    state.sglangReady = false;
  }
}

let _healthInterval = null;
function startHealthPolling() {
  pollHealthDirect(); // immediate first call
  _healthInterval = setInterval(pollHealthDirect, 8000);
}

async function refreshHealth() {
  // Start direct HTTP polling immediately
  startHealthPolling();
  // Also listen for IPC alerts from Electron main (restart, startup-failed)
  try {
    window.higgs.onStartupFailed((payload) => {
      toast(payload.message || 'Startup failed', true);
    });
  } catch (e) {
    // window.higgs may not exist if not running in Electron — fine
  }
}

// ── Voice clone modal ────────────────────────────────────────────
function openCloneModal() {
  els.cloneName.value = '';
  els.cloneAudio.value = '';
  els.cloneTranscript.value = '';
  els.cloneModal.hidden = false;
  els.cloneModal.style.display = 'flex';
}
function closeCloneModal() {
  els.cloneModal.hidden = true;
  els.cloneModal.style.display = 'none';
}

async function saveClone() {
  const name = els.cloneName.value.trim();
  const file = els.cloneAudio.files[0];
  const transcript = els.cloneTranscript.value.trim();
  if (!name || !file || !transcript) {
    toast('Name, audio file, and transcript are all required.', true);
    return;
  }
  const fd = new FormData();
  fd.append('name', name);
  fd.append('transcript', transcript);
  fd.append('audio', file);
  try {
    const r = await fetch('http://127.0.0.1:7861/api/voices/custom', { method: 'POST', body: fd });
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

// ── Wire up events ───────────────────────────────────────────────
function init() {
  initChips();
  loadVoices();
  loadHistory();
  refreshHealth();

  els.textInput.addEventListener('input', () => {
    els.charCount.textContent = els.textInput.value.length;
  });
  els.voiceSelect.addEventListener('change', () => {
    state.selectedVoice = els.voiceSelect.value;
  });
  els.btnSynth.addEventListener('click', synthesise);
  els.btnRefreshHistory.addEventListener('click', loadHistory);
  els.btnAddVoice.addEventListener('click', openCloneModal);
  els.btnCloneCancel.addEventListener('click', closeCloneModal);
  els.btnCloneSave.addEventListener('click', saveClone);
  els.btnOutput.addEventListener('click', () => window.higgs.openOutput());
  els.btnRestart.addEventListener('click', async () => {
    toast('Restarting servers…');
    await window.higgs.restartServers();
  });
  // Advanced params → state
  for (const [el, key] of [
    [els.paramTemperature, 'temperature'],
    [els.paramTopK, 'top_k'],
    [els.paramMaxTok, 'max_new_tokens'],
  ]) {
    el.addEventListener('change', () => {
      const v = parseFloat(el.value);
      if (!isNaN(v)) state.params[key] = v;
    });
  }
  // Keyboard shortcut: Ctrl+Enter to synthesise
  els.textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      synthesise();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
