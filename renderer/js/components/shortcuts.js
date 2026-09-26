/* ══════════════════════════════════════════
   Shortcuts —— 全局快捷键
   ══════════════════════════════════════════ */

const Shortcuts = {
  /* [按键显示, 说明] —— 设置页直接读这个表 */
  LIST: [
    ['Ctrl + Enter', '生成当前集全部台词'],
    ['Ctrl + S',     '保存当前集'],
    ['空格',          '播放 / 暂停试听'],
    ['Ctrl + ← / →', '上一集 / 下一集'],
    ['Ctrl + 1…9',   '切换到对应页面'],
    ['Ctrl + ,',     '打开设置'],
    ['Ctrl + D',     '回到仪表板'],
    ['Esc',          '关闭弹层']
  ],

  PAGE_ORDER: ['dash', 'projects', 'episodes', 'text', 'dub', 'export', 'voices', 'settings', 'quick'],

  init() {
    window.addEventListener('keydown', (e) => this._onKey(e), true);
  },

  _isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
  },

  _onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;

    // Esc —— 关弹层（无论焦点在哪）
    if (key === 'Escape') {
      const host = document.getElementById('modal-host');
      if (host && host.children.length) { Modal.close(); e.preventDefault(); }
      return;
    }

    // Ctrl + 数字 —— 切页
    if (ctrl && /^[1-9]$/.test(key)) {
      const page = this.PAGE_ORDER[Number(key) - 1];
      if (page) { e.preventDefault(); App.go(page); }
      return;
    }

    // Ctrl + , —— 设置
    if (ctrl && key === ',') { e.preventDefault(); App.go('settings'); return; }

    // Ctrl + D —— 仪表板
    if (ctrl && (key === 'd' || key === 'D')) { e.preventDefault(); App.go('dash'); return; }

    // Ctrl + ← / → —— 上一集 / 下一集
    if (ctrl && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      this._stepEpisode(key === 'ArrowRight' ? 1 : -1);
      return;
    }

    // Ctrl + S —— 保存当前集（文本处理页）
    if (ctrl && (key === 's' || key === 'S')) {
      e.preventDefault();
      this._saveCurrent();
      return;
    }

    // Ctrl + Enter —— 生成全部（配音页）
    if (ctrl && key === 'Enter') {
      const btn = document.querySelector('#page-dub [data-act="gen-all"]');
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }

    // 空格 —— 播放 / 暂停（不在输入框里时）
    if (key === ' ' && !this._isTyping()) {
      const play = document.querySelector('.page.active .ap-play-btn');
      if (play) { e.preventDefault(); play.click(); }
    }
  },

  async _stepEpisode(delta) {
    const list = Store.episodes;
    if (!list.length) return;
    const cur = Store.currentEpisodeNo;
    const idx = list.findIndex(x => x.no === cur);
    const next = list[Math.min(list.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + delta))];
    if (!next || next.no === cur) { Toast.show(delta > 0 ? '已经是最后一集' : '已经是第一集'); return; }
    const r = await Store.openEpisode(next.no);
    if (r && r.ok) {
      Toast.show('第 ' + next.no + ' 集 · ' + (next.title || ''));
      App.go(App.current === 'dub' || App.current === 'text' || App.current === 'export' ? App.current : 'dub');
    }
  },

  _saveCurrent() {
    if (App.current === 'text') {
      const btn = document.querySelector('#page-text [data-act="save"]');
      if (btn) { btn.click(); return; }
    }
    if (App.current === 'project-settings') {
      const btn = document.querySelector('#page-project-settings [data-act="save-basic"]');
      if (btn) { btn.click(); return; }
    }
    Toast.show('当前页面没有需要保存的改动');
  }
};
