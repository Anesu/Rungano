/**
 * Health display — IPC-driven traffic-light status with detail tooltip.
 */
import { state, els } from './state.js';
import { initChips } from './chips.js';
import { toast } from './toast.js';

export function updateHealthUI(flaskReady, sglangReady, flaskBody) {
  if (!flaskReady) {
    els.dotStatus.className = 'dot bad';
    els.textStatus.textContent = 'Offline';
  } else if (!sglangReady) {
    els.dotStatus.className = 'dot warn';
    els.textStatus.textContent = 'Loading model…';
  } else {
    els.dotStatus.className = 'dot ok';
    els.textStatus.textContent = 'Ready';
    if (!state.sglangReady) {
      state.sglangReady = true;
      initChips();
    }
  }
  _updateTooltipDetail(flaskReady, sglangReady, flaskBody);
}

function _updateTooltipDetail(flaskReady, sglangReady, flaskBody) {
  const detail = document.getElementById('tooltip-detail');
  if (!detail) return;
  const models = flaskBody?.sglang_models || [];
  const gpu = flaskBody?.gpu || {};
  const modelName = models[0] ? models[0].split('/').pop() : '—';
  const freeGB = gpu.vram_free_mb ? (gpu.vram_free_mb / 1024).toFixed(1) : '?';
  const totalGB = gpu.vram_total_mb ? (gpu.vram_total_mb / 1024).toFixed(0) : '?';
  detail.innerHTML = `
    <p class="muted">Model: ${modelName}</p>
    <p class="muted">VRAM free: ${freeGB} GB / ${totalGB} GB</p>
    <p class="muted">GPU: ${gpu.name || '—'}</p>
  `;
}

export function startHealthListening() {
  if (window.higgs?.onHealth) {
    window.higgs.onHealth((payload) => {
      updateHealthUI(payload.flask, payload.sglang, payload.flaskBody);
    });
  }
  if (window.higgs?.onStartupFailed) {
    window.higgs.onStartupFailed((payload) => {
      els.dotStatus.className = 'dot bad';
      els.textStatus.textContent = 'Startup failed';
      toast(payload?.message || 'Server startup failed. Use ⟳ to retry.', true);
    });
  }
}
