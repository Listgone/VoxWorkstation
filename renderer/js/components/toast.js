/* ══════════════════════════════════════════
   Toast — 轻量提示（成功 / 失败）

   各模块通过 this._toast(msg, isError) 调用；
   这里提供 Toast.show() 作为统一实现。
   ══════════════════════════════════════════ */

const Toast = (() => {
  let host = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
    return host;
  }

  /**
   * @param {string} message 提示内容
   * @param {boolean} isError true = 失败样式
   * @param {number} timeout 自动消失时间(ms)，0 表示不自动消失
   */
  function show(message, isError = false, timeout = 3200) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' toast-error' : '');
    el.setAttribute('role', isError ? 'alert' : 'status');
    el.textContent = message === null || message === undefined ? '' : String(message);

    ensureHost().appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    let timer = null;
    const dismiss = () => {
      if (timer) clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    };
    if (timeout > 0) timer = setTimeout(dismiss, timeout);
    el.addEventListener('click', dismiss);
    return dismiss;
  }

  return {
    show,
    error: (msg) => show(msg, true),
    success: (msg) => show(msg, false)
  };
})();

/* 供各模块以 this._toast(...) 调用（保留原有调用点写法） */
const ToastMixin = {
  _toast(message, isError) { Toast.show(message, isError); }
};
