/**
 * Synthesis engine — SSE streaming, progress, cancel.
 *
 * Sends structured controls to /api/tts/batch/stream, consumes the SSE
 * event stream, and renders sentences progressively via playlist.js.
 */
import { state, els } from './state.js';
import { toast } from './toast.js';
import { renderSentenceList } from './playlist.js';

export function buildControlsPayload() {
  const ctrl = {};
  if (state.emotion) ctrl.emotion = state.emotion;
  if (state.style) ctrl.style = state.style;
  if (state.prosody.size) ctrl.prosody = [...state.prosody];
  if (state.sfx.size) ctrl.sfx = [...state.sfx.entries()];
  return Object.keys(ctrl).length ? ctrl : undefined;
}

export async function synthesise() {
  const text = els.textInput.value.trim();
  if (!text) { toast('Type some text first.', true); return; }

  _enterSynthesisingState();
  state.sentences = [];
  state.playbackIndex = -1;
  renderSentenceList();

  const body = {
    text, voice_id: state.selectedVoice, volume: 1.8,
    temperature: state.temperature, top_k: state.topK, top_p: state.topP,
    max_new_tokens: state.maxTokens,
  };
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
          updateProgress(0, totalSentences);
        } else if (event.type === 'sentence') {
          state.sentences[event.index] = { ...event, status: 'done' };
          doneCount++;
          updateProgress(doneCount, totalSentences);
          renderSentenceList();
        } else if (event.type === 'error') {
          state.sentences[event.index] = { ...state.sentences[event.index], status: 'failed' };
          doneCount++;
          updateProgress(doneCount, totalSentences);
          renderSentenceList();
        } else if (event.type === 'done') {
          els.progressText.textContent = `${doneCount} sentences · ${event.elapsed_sec.toFixed(0)}s total`;
          toast(`Synthesised ${doneCount} sentences${event.failed ? ` (${event.failed} failed)` : ''}.`);
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      els.progressText.textContent = 'Cancelled.';
      toast('Synthesis cancelled.');
      state.sentences.forEach(s => { if (s.status === 'pending') s.status = 'failed'; });
      renderSentenceList();
    } else {
      toast(`Synthesis failed: ${e.message}`, true);
      els.progressText.textContent = 'Error.';
      state.sentences.forEach(s => { if (s.status !== 'done') s.status = 'failed'; });
      renderSentenceList();
    }
  } finally {
    _leaveSynthesisingState();
    state._abortController = null;
  }
}

export function cancelSynthesis() {
  if (state._abortController) {
    state._abortController.abort();
  }
}

export function updateProgress(done, total) {
  const pct = total > 0 ? (done / total * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = `Sentence ${done} of ${total}`;
  if (done >= total) setTimeout(() => { els.progressWrap.hidden = true; }, 3000);
}

function _enterSynthesisingState() {
  els.btnSynth.textContent = 'Cancel';
  els.btnSynth.classList.add('btn-danger');
  els.spinnerSynth.hidden = false;
  els.progressWrap.hidden = false;
}

function _leaveSynthesisingState() {
  els.btnSynth.textContent = 'Synthesise';
  els.btnSynth.classList.remove('btn-danger');
  els.spinnerSynth.hidden = true;
}
