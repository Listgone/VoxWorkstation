/* ══════════════════════════════════════════
   GPU Monitor — polling GPU memory status
   ══════════════════════════════════════════ */

const GpuMonitor = {
  _timer: null,
  _failures: 0,
  _lastText: '',

  start(intervalMs = 5000) {
    this.stop();
    this._fetch();
    this._timer = setInterval(() => this._fetch(), intervalMs);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  _setText(text, stale) {
    const el = document.getElementById('gpu-text');
    // 值没变就不动 DOM，避免无谓重排和视觉抖动
    if (el && text !== this._lastText) {
      el.textContent = text;
      this._lastText = text;
    }
    const ind = document.getElementById('gpu-indicator');
    if (ind) ind.classList.toggle('is-stale', !!stale);
  },

  async _fetch() {
    try {
      const data = await API.getGpuMemory();
      this._failures = 0;
      const used = Number(data && data.used_mb);
      const total = Number(data && data.total_mb);
      const text = (Number.isFinite(used) && Number.isFinite(total))
        ? `GPU ${used}M / ${total}M`
        : 'GPU --';
      const el = document.getElementById('gpu-text');
      if (el && Number.isFinite(used) && Number.isFinite(total)) {
        el.title = `显存占用 ${used} MB / ${total} MB`;
      }
      this._setText(text, false);
    } catch {
      // 单次网络抖动不刷 UI；连续 3 次失败才标记离线
      this._failures++;
      /* 后端加载模型时可能一时响应不过来：以前连续 3 次（15 秒）失败就把数值抹成
         "GPU 离线"，看着像显卡不工作了。现在只要有历史读数就保留数字、只把颜色变灰；
         从没读到过才写离线。阈值也从 3 次放宽到 6 次（30 秒）。 */
      if (this._failures >= 6) {
        const had = this._lastText && /^GPU [0-9]/.test(this._lastText);
        this._setText(had ? this._lastText : 'GPU 离线', true);
      }
    }
  }
};
