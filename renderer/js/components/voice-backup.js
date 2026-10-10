/* ══════════════════════════════════════════
   VoiceBackup —— 音色库「备份与还原」统一入口

   为什么做成一个共用组件：
   音色库页与设置页都要这几个动作（立即备份 / 从备份还原 / 更改位置 / 打开位置 /
   删除旧备份）。散成两处按钮既占地方、又容易出现"这页有那页没有"的不一致，
   所以收敛成一个弹窗，两处都只放一个入口按钮。

   备份清单、位置、上次备份时间都来自主进程的 vox:voices:stat，
   两边读到的是同一份数据，不存在不同步。
   ══════════════════════════════════════════ */

const VoiceBackup = {
  _stat: null,

  /** 读一次概况（含备份清单） */
  async load(force) {
    if (this._stat && !force) return this._stat;
    try { this._stat = await window.electronAPI.voices.stat(); }
    catch (e) { this._stat = { ok: false, voiceCount: 0, backups: [] }; }
    return this._stat;
  },

  _fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  _fmtSize(bytes) {
    if (!bytes) return '0 KB';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  },

  /** 弹窗正文（每次刷新后重绘） */
  _bodyHtml(st) {
    const n = st.voiceCount || 0;
    const dir = st.lastBackup || st.autoBackupDir || '';
    const list = st.backups || [];
    const rows = list.length
      ? list.map(b =>
          '<label class="vbk-row">'
          + '<input type="checkbox" class="vbk-ck" value="' + Util.escapeAttr(b.name) + '">'
          + '<span class="vbk-main"><b>' + Util.escapeHtml(b.name) + '</b>'
          + '<span>' + this._fmtTime(b.at) + ' · ' + b.voices + ' 个音色 · ' + b.files + ' 个文件 · ' + this._fmtSize(b.bytes)
          + (b.kind === 'auto' ? ' · 自动' : ' · 手动') + '</span></span>'
          + '<button class="btn btn-sm" data-vbk-restore="' + Util.escapeAttr(b.name) + '" title="用这一份还原">还原</button>'
          + '</label>').join('')
      : '<p class="text-sm text-muted" style="margin:0">还没有备份。</p>';

    return ''
      + '<div class="vbk-status">'
      + '<div><b>当前音色库</b><span>共 ' + n + ' 个音色 · ' + this._fmtSize(st.bytes) + '</span></div>'
      + '<div><b>备份位置</b><span>' + (dir ? Util.escapeHtml(dir) : '（未设置，首次备份时选择）') + '</span></div>'
      + (st.autoBackupAt ? '<div><b>上次自动备份</b><span>' + this._fmtTime(st.autoBackupAt) + '</span></div>' : '')
      + '</div>'
      + '<div class="vbk-acts">'
      + '<button class="btn btn-primary" data-vbk="backup">立即备份</button>'
      + '<button class="btn" data-vbk="restore">从备份还原</button>'
      + '<button class="btn" data-vbk="setdir">更改备份位置</button>'
      + '<button class="btn" data-vbk="open">打开备份位置</button>'
      + '</div>'
      + '<p class="text-sm text-muted vbk-tip">'
      + '改动音色库（新增 / 删除 / 重命名 / 改描述）后会<b>自动备份</b>一次，'
      + '3 分钟内只备一次、只保留最近 20 份自动备份；手动备份不会自动删除。'
      + '备份在软件安装目录之外，卸载或升级软件都不会丢。'
      + '</p>'
      + '<div class="vbk-listhead"><b>已有备份</b>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm btn-ghost" data-vbk="selectall">全选</button>'
      + '<button class="btn btn-sm btn-ghost btn-danger" data-vbk="del">删除选中</button>'
      + '</div>'
      + '<div class="vbk-list">' + rows + '</div>';
  },

  async show() {
    const st = await this.load(true);
    Modal.open({
      title: '音色库 · 备份与还原',
      width: 660,
      body: '<div id="vbk-body">' + this._bodyHtml(st) + '</div>',
      footer: '<button class="btn" data-vbk="close">关闭</button>',
      onMount: (overlay) => this._bind(overlay)
    });
  },

  /** 操作后刷新弹窗内容 */
  async _refresh() {
    const st = await this.load(true);
    const box = document.getElementById('vbk-body');
    if (box) { box.innerHTML = this._bodyHtml(st); this._bind(document.getElementById('modal-host')); }
  },

  /** 还原指定的一份备份（不传则让用户选目录） */
  async _restore(name) {
    const st = this._stat || {};
    const dir = name ? (st.backups || []).find((b) => b.name === name) : null;
    const ok = await Modal.confirm({
      title: '从备份还原',
      okText: '开始还原',
      message: name
        ? '用备份 <b>' + Util.escapeHtml(name) + '</b> 还原吗？<br>已有同名音色不会被覆盖，只补回缺失的。'
        : '接下来选择备份目录（可直接选备份的上级目录，会自动取最新一份）。<br>还原是<b>补充</b>：已有同名音色不会被动。'
    });
    if (!ok) return;
    try {
      const r = await window.electronAPI.voices.restore(dir ? { dir: dir.dir } : {});
      if (r && r.canceled) return;
      if (!r || !r.ok) throw new Error((r && r.message) || '还原失败');
      Toast.success('已还原：新增 ' + r.added + ' 个文件' + (r.skipped ? '，跳过已存在 ' + r.skipped + ' 个' : ''));
      if (typeof VoicesPage !== 'undefined') VoicesPage._stat = null;   // 让音色库页下次重新统计
      Modal.close();                                                    // 还原完成就收起弹窗
      App.go(App.current || 'voices');
    } catch (e) { Toast.error(String(e.message || e), true); }
  },

  _bind(overlay) {
    const host = overlay || document.getElementById('modal-host');
    if (!host) return;
    const on = (sel, fn) => host.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));

    on('[data-vbk="close"]', () => Modal.close());

    on('[data-vbk="backup"]', async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true; b.textContent = '备份中…';
      try {
        const r = await window.electronAPI.voices.backup();
        if (r && r.canceled) { Toast.show('已取消'); b.disabled = false; b.textContent = '立即备份'; return; }
        if (!r || !r.ok) throw new Error((r && r.message) || '备份失败');
        Toast.success('已备份 ' + r.voiceCount + ' 个音色到 ' + r.dest);
        await this._refresh();
      } catch (e) { Toast.error(String(e.message || e), true); b.disabled = false; b.textContent = '立即备份'; }
    });

    on('[data-vbk="restore"]', () => this._restore(''));
    on('[data-vbk-restore]', (ev) => this._restore(ev.currentTarget.dataset.vbkRestore));

    on('[data-vbk="setdir"]', async () => {
      try {
        const r = await window.electronAPI.voices.setBackupDir();
        if (r && r.canceled) return;
        if (!r || !r.ok) throw new Error((r && r.message) || '设置失败');
        Toast.success('备份位置已改为 ' + r.dir);
        await this._refresh();
      } catch (e) { Toast.error(String(e.message || e), true); }
    });

    on('[data-vbk="open"]', async () => {
      const st = this._stat || {};
      const dir = st.lastBackup || '';
      if (!dir) { Toast.error('还没有设置备份位置', true); return; }
      try { await window.electronAPI.path.reveal(dir); }
      catch (e) { Toast.error('打开失败：' + (e && e.message || e), true); }
    });

    on('[data-vbk="selectall"]', (ev) => {
      const boxes = [...host.querySelectorAll('.vbk-ck')];
      const allOn = boxes.every((c) => c.checked);
      boxes.forEach((c) => { c.checked = !allOn; });
      ev.currentTarget.textContent = allOn ? '全选' : '取消全选';
    });

    on('[data-vbk="del"]', async () => {
      const names = [...host.querySelectorAll('.vbk-ck:checked')].map((c) => c.value);
      if (!names.length) { Toast.error('先勾选要删除的备份', true); return; }
      const ok = await Modal.confirm({
        title: '删除备份', okText: '删除', danger: true,
        message: '确定删除选中的 <b>' + names.length + '</b> 份备份吗？<br>'
          + '只删除备份，不会动当前音色库；此操作不可撤销。'
      });
      if (!ok) return;
      try {
        const r = await window.electronAPI.voices.deleteBackups({ names });
        if (!r || !r.ok) throw new Error((r && r.message) || '删除失败');
        Toast.success('已删除 ' + r.removed + ' 份备份' + (r.skipped ? '，跳过 ' + r.skipped + ' 份' : ''));
        await this._refresh();
      } catch (e) { Toast.error(String(e.message || e), true); }
    });
  }
};
