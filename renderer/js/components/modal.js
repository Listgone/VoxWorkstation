/* ══════════════════════════════════════════
   Modal —— 统一的弹层
   ══════════════════════════════════════════ */

const Modal = {
  open({ title, body, footer, width = 560, onMount }) {
    this.close();
    const host = document.getElementById('modal-host');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box" style="width:' + width + 'px">'
      + '<div class="modal-head"><h3>' + Util.escapeHtml(title || '') + '</h3>'
      + '<button class="modal-x" title="关闭">✕</button></div>'
      + '<div class="modal-body">' + (body || '') + '</div>'
      + (footer ? '<div class="modal-foot">' + footer + '</div>' : '')
      + '</div>';
    host.appendChild(overlay);
    const close = () => this.close();
    overlay.querySelector('.modal-x').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', this._esc = (e) => { if (e.key === 'Escape') close(); });
    if (onMount) onMount(overlay);
    const first = overlay.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    return overlay;
  },

  close() {
    const host = document.getElementById('modal-host');
    if (host) host.innerHTML = '';
    if (this._esc) { document.removeEventListener('keydown', this._esc); this._esc = null; }
  },

  /** 确认框 */
  confirm({ title, message, okText = '确定', danger = false }) {
    return new Promise((resolve) => {
      const overlay = this.open({
        title,
        width: 420,
        body: '<p style="font-size:13px;color:var(--text-dim);line-height:1.75">' + message + '</p>',
        footer: '<button class="btn" data-act="cancel">取消</button>'
              + '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">'
              + Util.escapeHtml(okText) + '</button>'
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => { this.close(); resolve(false); });
      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => { this.close(); resolve(true); });
    });
  },

  /** 输入框 */
  prompt({ title, label, value = '', placeholder = '', okText = '确定' }) {
    return new Promise((resolve) => {
      const overlay = this.open({
        title,
        width: 440,
        body: '<div class="form-group"><label class="form-label">' + Util.escapeHtml(label || '') + '</label>'
            + '<input type="text" id="mp-input" value="' + Util.escapeAttr(value) + '" placeholder="' + Util.escapeAttr(placeholder) + '"></div>',
        footer: '<button class="btn" data-act="cancel">取消</button>'
              + '<button class="btn btn-primary" data-act="ok">' + Util.escapeHtml(okText) + '</button>'
      });
      const input = overlay.querySelector('#mp-input');
      const done = (v) => { this.close(); resolve(v); };
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(input.value.trim()));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim()); });
    });
  }
};
