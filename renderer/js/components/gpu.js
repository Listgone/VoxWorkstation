/* ══════════════════════════════════════════
   GPU Monitor — polling GPU memory status
   ══════════════════════════════════════════ */

const GpuMonitor = {
  _timer: null,

  start(intervalMs = 5000) {
    this.stop();
    this._fetch();
    this._timer = setInterval(() => this._fetch(), intervalMs);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async _fetch() {
    try {
      const data = await API.getGpuMemory();
      const el = document.getElementById('gpu-text');
      if (el) {
        el.textContent = `GPU ${data.used_mb}M / ${data.total_mb}M`;
      }
    } catch {
      const el = document.getElementById('gpu-text');
      if (el) el.textContent = 'GPU --';
    }
  }
};
