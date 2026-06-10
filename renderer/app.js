/**
 * Rungano — renderer logic (sentence-by-sentence architecture)
 *
 * The Higgs model performs best on short utterances. We split text into
 * sentences, synthesize each independently, and present them as a playlist.
 * No trimming, no crossfading, no concatenation — each sentence is a clean WAV.
 */

const $ = (id) => document.getElementById(id);
const els = {
  textInput: $('text-input'), charCount: $('char-count'),
  voiceSelect: $('voice-select'), btnAddVoice: $('btn-add-voice'),
  btnSynth: $('btn-synth'), btnRestart: $('btn-restart'), btnOutput: $('btn-output'),
  spinnerSynth: $('spinner-synth'),
  audioPlayer: $('audio-player'), outputState: $('output-state'),
  sentenceList: $('sentence-list'), btnPlayAll: $('btn-play-all'),
  progressWrap: $('progress-wrap'), progressFill: $('progress-fill'), progressText: $('progress-text'),
  dotServer: $('dot-server'), textServer: $('text-server'),
  dotSglang: $('dot-sglang'), textSglang: $('text-sglang'),
  emotionChips: $('emotion-chips'), styleChips: $('style-chips'),
  prosodyChips: $('prosody-chips'), sfxChips: $('sfx-chips'),
  cloneModal: $('clone-modal'), cloneName: $('clone-name'), cloneAudio: $('clone-audio'),
  cloneTranscript: $('clone-transcript'), btnCloneCancel: $('btn-clone-cancel'), btnCloneSave: $('btn-clone-save'),
  toast: $('toast'),
};

// ── Control catalogues ────────────────────────────────────────────────
const EMOTIONS = ["elation","amusement","enthusiasm","determination","pride","contentment",
  "affection","relief","contemplation","confusion","surprise","awe","longing","arousal",
  "anger","fear","disgust","bitterness","sadness","shame","helplessness"];
const STYLES = ["singing","shouting","whispering"];
const PROSODY = ["speed_very_slow","speed_slow","speed_fast","speed_very_fast",
  "pitch_low","pitch_high","pause","long_pause","expressive_high","expressive_low"];
const SFX = [
  { token: "cough", suggested: "Ahem" }, { token: "laughter", suggested: "Haha / Hehe" },
  { token: "crying", suggested: "Boohoo / Sob" }, { token: "screaming", suggested: "Ahh / Aaah" },
  { token: "burping", suggested: "Burp" }, { token: "humming", suggested: "Hmm / Mmm" },
  { token: "sigh", suggested: "Uh / Ahh" }, { token: "sniff", suggested: "Sff" },
  { token: "sneeze", suggested: "Achoo" },
];

const state = {
  voices: [], selectedVoice: "default",
  emotion: null, style: null, prosody: new Set(), sfx: new Map(),
  sglangReady: false,
  sentences: [],  // { index, text, file, elapsed_sec, bytes, status: 'pending'|'running'|'done'|'failed' }
  playbackIndex: -1,
};

// ── API ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:7861${path}`, opts);
  if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || res.statusText); }
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, isError = false) {
  els.toast.textContent = msg; els.toast.hidden = false;
  els.toast.style.borderColor = isError ? 'var(--bad)' : 'var(--border)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}

// ── Chips ────────────────────────────────────────────────────────────
function buildChipRow(parent, items, mode = 'single', dataKey = 'token') {
  parent.innerHTML = '';
  for (const it of (typeof items[0] === 'string' ? items.map(s => ({ [dataKey]: s, label: s })) : items)) {
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
}
function initChips() {
  buildChipRow(els.emotionChips, EMOTIONS, 'single');
  buildChipRow(els.styleChips, STYLES, 'single');
  buildChipRow(els.prosodyChips, PROSODY, 'multi-prosody');
  buildChipRow(els.sfxChips, SFX, 'multi-sfx');
}

function buildInputText() {
  const raw = els.textInput.value;
  if (/<\|[a-z]+:[a-z_]+\|>/.test(raw)) return raw;
  const tags = [];
  if (state.emotion) tags.push(`<|emotion:${state.emotion}|>`);
  if (state.style) tags.push(`<|style:${state.style}|>`);
  for (const p of state.prosody) tags.push(`<|prosody:${p}|>`);
  for (const [token, ono] of state.sfx) tags.push(`<|sfx:${token}|>${ono}`);
  return tags.join('') + raw;
}

// ── Voices ───────────────────────────────────────────────────────────
async function loadVoices() {
  try {
    const { voices } = await api('/api/voices');
    state.voices = voices; els.voiceSelect.innerHTML = '';
    for (const v of voices) { const opt = document.createElement('option'); opt.value = v.id; opt.textContent = `${v.name}${v.kind === 'custom' ? '  •  custom' : ''}`; els.voiceSelect.appendChild(opt); }
    if (voices.length && !voices.find(v => v.id === state.selectedVoice)) state.selectedVoice = voices[0].id;
    els.voiceSelect.value = state.selectedVoice;
  } catch (e) { els.voiceSelect.innerHTML = '<option>Server unavailable</option>'; }
}

// ── Sentence playlist ────────────────────────────────────────────────
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
    if (s.status === 'running') { meta.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>'; }
    else if (s.status === 'done') { meta.textContent = `${s.elapsed_sec}s · ${(s.bytes/1024).toFixed(0)}KB`; }
    else if (s.status === 'failed') { meta.textContent = 'failed'; meta.style.color = 'var(--bad)'; }
    else { meta.textContent = 'waiting'; }

    if (s.status === 'done') {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => playSentence(s.index));
    }

    li.appendChild(idx); li.appendChild(txt); li.appendChild(meta);
    els.sentenceList.appendChild(li);
  }
  els.btnPlayAll.hidden = !state.sentences.some(s => s.status === 'done');
}

function playSentence(index) {
  const s = state.sentences.find(x => x.index === index);
  if (!s || s.status !== 'done') return;
  state.playbackIndex = index;
  els.audioPlayer.src = s.file + `?t=${Date.now()}`;
  els.audioPlayer.play().catch(() => {});
  highlightCurrentSentence();
}

function playNextSentence() {
  const next = state.sentences.find(s => s.index > state.playbackIndex && s.status === 'done');
  if (next) { playSentence(next.index); }
  else { state.playbackIndex = -1; highlightCurrentSentence(); }
}

function highlightCurrentSentence() {
  for (const li of els.sentenceList.children) {
    li.classList.toggle('playing', parseInt(li.dataset.index) === state.playbackIndex);
  }
}

// ── Synthesise batch ─────────────────────────────────────────────────
async function synthesise() {
  const text = buildInputText().trim();
  if (!text) { toast('Type some text first.', true); return; }

  els.btnSynth.disabled = true; els.spinnerSynth.hidden = false;
  els.progressWrap.hidden = false; els.outputState.textContent = 'Starting…';
  state.sentences = [];
  renderSentenceList();

  try {
    const body = { text, voice_id: state.selectedVoice, volume: 1.8 };
    const result = await api('/api/tts/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // Populate sentence list from server response
    state.sentences = result.sentences.map(s => ({ ...s, status: 'done' }));
    const done = result.sentences.length;
    const total = result.total;
    const failed = result.failed;

    updateProgress(done, done + failed);
    els.outputState.textContent = `${done} sentences · ${(result.elapsed_sec).toFixed(0)}s total`;
    toast(`Synthesised ${done} sentences${failed ? ` (${failed} failed)` : ''}.`);

  } catch (e) {
    toast(`Synthesis failed: ${e.message}`, true);
    els.outputState.textContent = 'Error.';
    state.sentences.forEach(s => { if (s.status !== 'done') s.status = 'failed'; });
  } finally {
    els.btnSynth.disabled = false; els.spinnerSynth.hidden = true;
    renderSentenceList();
  }
}

function updateProgress(done, total) {
  const pct = total > 0 ? (done / total * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `${done} / ${total}`;
  if (done >= total) setTimeout(() => { els.progressWrap.hidden = true; }, 2000);
}

// ── Progress polling during batch synthesis ──────────────────────────
// The batch is synchronous (server processes all sentences and returns).
// Progress is shown as a simple done/total counter.

// ── Health ───────────────────────────────────────────────────────────
async function pollHealthDirect() {
  try {
    const d = await api('/api/health');
    if (d.flask_ready) { els.dotServer.className = 'dot ok'; els.textServer.textContent = 'Flask: ready'; }
    else { els.dotServer.className = 'dot bad'; els.textServer.textContent = 'Flask: down'; }
    if (d.sglang_ready) {
      els.dotSglang.className = 'dot ok';
      const models = d.sglang_models || []; const gpu = d.gpu || {};
      const vram = gpu.vram_free_mb ? ` (${(gpu.vram_free_mb/1024).toFixed(1)}GB free)` : '';
      els.textSglang.textContent = `Model: ${models[0] || 'ready'}${vram}`;
      state.sglangReady = true;
    } else {
      els.dotSglang.className = 'dot bad'; els.textSglang.textContent = 'Model: not ready';
      state.sglangReady = false;
    }
  } catch (e) {
    els.dotServer.className = 'dot bad'; els.textServer.textContent = 'Flask: unreachable';
    els.dotSglang.className = 'dot bad'; els.textSglang.textContent = 'Model: unknown';
    state.sglangReady = false;
  }
}
let _healthInterval = null;
function startHealthPolling() { pollHealthDirect(); _healthInterval = setInterval(pollHealthDirect, 8000); }

// ── Clone modal ──────────────────────────────────────────────────────
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
    const r = await fetch('http://127.0.0.1:7861/api/voices/custom', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    toast(`Voice "${name}" added.`); closeCloneModal(); await loadVoices();
    const data = await r.json(); state.selectedVoice = data.id; els.voiceSelect.value = data.id;
  } catch (e) { toast(`Save failed: ${e.message}`, true); }
}

// ── Init ─────────────────────────────────────────────────────────────
function init() {
  initChips();
  loadVoices();
  startHealthPolling();

  els.textInput.addEventListener('input', () => { els.charCount.textContent = els.textInput.value.length; });
  els.voiceSelect.addEventListener('change', () => { state.selectedVoice = els.voiceSelect.value; });
  els.btnSynth.addEventListener('click', synthesise);
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
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
