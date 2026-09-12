/* ══════════════════════════════════════════
   Util — 通用工具（转义 / 时间 / 防抖）
   ══════════════════════════════════════════ */

const Util = {
  /** HTML 文本转义。所有拼进 innerHTML 的动态内容都必须过这一层。 */
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** 属性值转义 */
  escapeAttr(value) {
    return Util.escapeHtml(value).replace(/`/g, '&#96;');
  },

  /** 秒 → mm:ss */
  fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  },

  /** 防抖 */
  debounce(fn, wait = 150) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  },

  /** 生成短 id */
  uid(prefix = 'u') {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }
};
