/**
 * Drag-and-drop .txt file handling for the text input panel.
 */
import { els } from './state.js';
import { toast } from './toast.js';

export function initDragDrop() {
  if (!els.textInput) return;
  const panel = els.textInput.closest('.panel-input');
  if (!panel) return;
  const textarea = els.textInput;

  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('drag-over'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('drag-over'));
  panel.addEventListener('drop', async (e) => {
    e.preventDefault();
    panel.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.txt')) { toast('Drop a .txt file.', true); return; }
    const text = await file.text();
    textarea.value = text;
    const words = text.split(/\s+/).filter(Boolean).length;
    els.charCount.textContent = words;
    toast(`Loaded ${file.name} (${words} words).`);
  });
}
