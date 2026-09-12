/* ══════════════════════════════════════════
   Util — 通用工具（转义 / 时间 / 格式化 / 状态）
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

  /** 毫秒 → mm:ss 或 h:mm:ss */
  fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
      : m + ':' + String(s).padStart(2, '0');
  },

  /** 千分位 */
  fmtNum(n) {
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  /** 相对时间 */
  fmtAgo(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const diff = Date.now() - t;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 30 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    return new Date(t).toLocaleDateString('zh-CN');
  },

  /** 防抖 */
  debounce(fn, wait = 150) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  },

  uid(prefix = 'u') {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  },

  /** 转义 + 换行 */
  nl2br(s) {
    return Util.escapeHtml(s).replace(/\n/g, '<br>');
  },

  /** 集状态 → 徽标 */
  epStatus(status) {
    return {
      draft:     ['草稿', ''],
      text:      ['文本处理中', 'pill-warn'],
      dubbing:   ['配音中', 'pill-run'],
      done:      ['已完成', 'pill-ok'],
      delivered: ['已交付', 'pill-ok']
    }[status] || ['—', ''];
  },

  /** 项目状态 → 徽标 */
  projStatus(status) {
    return {
      active:   ['进行中', 'pill-run'],
      archived: ['已归档', ''],
      stalled:  ['停滞', 'pill-warn']
    }[status] || ['—', ''];
  },

  /** 生成进度条 HTML */
  progressBar(done, total, width) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const cls = pct >= 100 ? 'done' : '';
    return '<span class="pbar" style="width:' + (width || 78) + 'px"><i class="' + cls
      + '" style="width:' + pct + '%"></i></span>'
      + '<span class="num">' + done + '/' + total + '</span>';
  },

  /** 安全设置 innerHTML 后返回元素 */
  html(el, s) { el.innerHTML = s; return el; },

  /** 字节 → 可读 */
  fmtSize(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  },

  /** base64 → Blob */
  b64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  },

  /** ArrayBuffer → base64 */
  ab2b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
};
