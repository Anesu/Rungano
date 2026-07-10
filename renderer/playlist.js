/**
 * Sentence playlist — DOM rendering, click-to-play, download.
 */
import { state, els } from './state.js';

export function renderSentenceList() {
  els.sentenceList.innerHTML = '';
  if (!state.sentences.length) { els.btnPlayAll.hidden = true; return; }
  for (const s of state.sentences) {
    const li = document.createElement('li');
    li.className = `sentence-item ${s.status}`;
    li.dataset.index = s.index;

    const idx = document.createElement('span');
    idx.className = 's-idx';
    idx.textContent = `${s.index + 1}`;

    const txt = document.createElement('span');
    txt.className = 's-text';
    txt.textContent = s.text.length > 100 ? s.text.slice(0, 100) + '…' : s.text;
    txt.title = s.text;

    const meta = document.createElement('span');
    meta.className = 's-meta';
    if (s.status === 'pending') { meta.textContent = 'waiting'; }
    else if (s.status === 'done') { meta.textContent = `${s.elapsed_sec}s · ${(s.bytes/1024).toFixed(0)}KB`; }
    else if (s.status === 'failed') { meta.textContent = 'failed'; meta.style.color = 'var(--bad)'; }

    if (s.status === 'done') {
      li.style.cursor = 'pointer';
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('s-dl')) return;
        openInVlc(s);
      });

      const dl = document.createElement('button');
      dl.className = 's-dl';
      dl.title = 'Download WAV';
      dl.textContent = '⬇';
      dl.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadSentence(s);
      });
      li.appendChild(dl);
    }

    li.appendChild(idx);
    li.appendChild(txt);
    li.appendChild(meta);
    els.sentenceList.appendChild(li);
  }

  const hasDone = state.sentences.some(s => s.status === 'done');
  els.actionBubble.hidden = !hasDone;
  if (!hasDone) {
    els.btnPlayAll.hidden = true;
    els.btnExportWav.hidden = true;
    els.btnSaveM3u.hidden = true;
  } else {
    els.btnPlayAll.hidden = false;
    els.btnExportWav.hidden = false;
    els.btnSaveM3u.hidden = false;
  }
}

export function downloadSentence(s) {
  const a = document.createElement('a');
  a.href = state.flaskUrl + s.file;
  a.download = `sentence-${s.index + 1}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function openInVlc(s) {
  try {
    let outputDir = '';
    try { const cfg = await window.higgs?.getConfig(); outputDir = cfg?.outputDir || ''; } catch {}
    if (outputDir) {
      const rel = s.file.replace(/^\/audio\//, '');
      window.higgs?.openFile(`${outputDir}\\${rel}`.replace(/\//g, '\\'));
    } else {
      window.higgs?.openFile(state.flaskUrl + s.file);
    }
  } catch {}
}
