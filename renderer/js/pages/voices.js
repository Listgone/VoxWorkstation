/* ══════════════════════════════════════════
   音色库 —— 管理音色资产
   ══════════════════════════════════════════ */

const VoicesPage = {
  _q: '',
  _voices: [],
  _player: null,

  render() {
    const list = this._voices.filter(v =>
      !this._q || String(v.name).toLowerCase().includes(this._q.toLowerCase()));

    return App.head('音色库', '管理音色资产，从这里选音色给台词用',
        '<button class="btn" data-act="refresh">刷新</button>'
        + '<button class="btn" data-act="restore">从备份还原</button>'
        + '<button class="btn" data-act="backup">备份音色库</button>'
        + '<button class="btn btn-primary" data-act="new">＋ 新建音色</button>')
      + '<div class="wrap">'
      + this._backupBar()
      + '<div class="toolrow">'
      + '<input type="text" id="v-q" placeholder="搜索音色…" style="width:260px" value="' + Util.escapeAttr(this._q) + '">'
      + '<span style="flex:1"></span>'
      + '<span class="text-sm text-muted">' + list.length + ' 个音色</span>'
      + '</div>'
      + '<div id="v-player"></div>'
      + (list.length
        ? '<div class="vgrid" style="margin-top:12px">' + list.map(v => this._card(v)).join('') + '</div>'
        : '<div class="card"><p class="text-sm text-muted" style="margin:0">'
          + (this._voices.length ? '没有匹配的音色。' : '音色库是空的。点右上角「＋ 新建音色」，或去「克隆源」用设计/克隆的方式生成一个。') + '</p></div>')
      + '</div>';
  },

  /** 备份提示条：告诉用户音色存在哪、上次备份到哪，并给出一键备份/还原 */
  _backupBar() {
    const st = this._stat || {};
    const n = st.voiceCount || 0;
    const dir = st.lastBackup || '';
    const mb = st.bytes ? (st.bytes / 1048576).toFixed(1) + ' MB' : '0 MB';
    return '<div class="card vbackup">'
      + '<div class="vbackup-head">'
      + '<b>音色备份</b>'
      + '<span class="text-sm text-muted">共 ' + n + ' 个音色 · ' + mb + '</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm" data-act="backup">立即备份</button>'
      + '<button class="btn btn-sm" data-act="restore">从备份还原</button>'
      + '<button class="btn btn-sm" data-act="open-voice-dir" title="打开音色实际存放的目录">打开位置</button>'
      + '</div>'
      + '<p class="text-sm text-muted vbackup-note">'
      + '音色文件与描述都放在软件目录里（<code>' + Util.escapeHtml(st.profiles || '') + '</code>）。'
      + '备份会复制到你指定的目录（建议选网盘同步目录或另一块硬盘），每次生成一个带时间戳的文件夹，'
      + '不会覆盖之前的备份。'
      + (dir ? '<br>上次备份到：<code>' + Util.escapeHtml(dir) + '</code>' : '')
      + '</p></div>';
  },

  /** 音色库有变动就自动备份（新增 / 删除 / 重命名 / 改描述都会走到这里）。
   *  节流与保留份数由主进程负责；这里不打扰用户：成功只留一行提示，失败也不弹错误。 */
  async _autoBackup(reason) {
    try {
      const r = await window.electronAPI?.voices?.autoBackup?.();
      if (!r || !r.ok) return null;
      this._stat = null;                       // 下次进页面重新统计（含上次备份位置）
      if (r.skipped) return r;
      Toast.show('已自动备份音色库（' + (r.voiceCount || 0) + ' 个音色' + (reason ? ' · ' + reason : '') + '）');
      return r;
    } catch (e) { return null; }               // 自动备份失败不该打断用户操作
  },

  _card(v) {
    const used = this._usedBy(v.name);
    const initial = String(v.name).trim().slice(0, 1) || '音';
    const kind = v.voice_file ? '声纹克隆' : '音色设计';
    return '<div class="vcard">'
      + '<div class="vtop">'
      + '<div class="vchip">' + Util.escapeHtml(initial) + '</div>'
      + '<div class="vn"><b>' + Util.escapeHtml(v.name) + '</b>'
      + '<span>' + kind + (v.desc ? ' · ' + Util.escapeHtml(v.desc) : '') + '</span></div>'
      + '</div>'
      + '<div class="vacts">'
      + '<button class="btn btn-sm" data-act="audition" data-name="' + Util.escapeAttr(v.name) + '"'
      + (v.voice_file ? '' : ' disabled title="这个音色没有声纹文件，无法试听"') + '>▶ 试听</button>'
      + (used ? '<span class="pill">用于 ' + Util.escapeHtml(used) + '</span>' : '')
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm" data-act="edit" data-name="' + Util.escapeAttr(v.name) + '"'
      + ' title="重命名 / 修改描述">重命名</button>'
      + '<button class="btn btn-sm btn-ghost btn-danger" data-act="del" data-name="' + Util.escapeAttr(v.name) + '" title="删除这个音色">删除</button>'
      + '</div></div>';
  },

  _usedBy(voiceName) {
    const p = Store.currentProject;
    if (!p) return '';
    const hit = (p.roles || []).find(r => r.voice === voiceName);
    return hit ? hit.name : '';
  },

  async mount(el) {
    // 首次进入时音色还没加载，加载完要重新渲染一次，否则停在空状态
    if (!this._loaded) {
      await this._load();
      this._loaded = true;
      return App.go('voices');
    }
    // 备份提示条需要音色库概况（数量、体积、上次备份目录）
    if (!this._stat) {
      try { this._stat = await window.electronAPI.voices.stat(); }
      catch (e) { this._stat = { voiceCount: 0, bytes: 0 }; }
      return App.go('voices');
    }

    // 每次都要重建：页面重渲染后 #v-player 是新的空节点
    this._player = AudioPlayer.create('v-player');

    el.querySelector('#v-q')?.addEventListener('input', Util.debounce((e) => {
      this._q = e.target.value; App.go('voices');
    }, 250));

    el.querySelector('[data-act="refresh"]')?.addEventListener('click', async () => {
      await this._load(); App.go('voices'); Toast.success('已刷新');
    });

    el.querySelector('[data-act="new"]')?.addEventListener('click', () => this._newVoice());

    /* 备份 / 还原 / 打开音色目录 */
    el.querySelectorAll('[data-act="backup"]').forEach(b =>
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '备份中…';
        try {
          const r = await window.electronAPI.voices.backup();
          if (r && r.canceled) { Toast.show('已取消备份'); return; }
          if (!r || !r.ok) throw new Error((r && r.message) || '备份失败');
          this._stat = null;
          await App.go('voices');
          Toast.success('已备份 ' + r.voiceCount + ' 个音色（' + r.copied + ' 个文件）到 ' + r.dest.replace(/\\[^\\]+$/, ''));
        } catch (e) {
          Toast.error(String(e.message || e), true);
          b.disabled = false; b.textContent = '立即备份';
        }
      }));

    el.querySelectorAll('[data-act="restore"]').forEach(b =>
      b.addEventListener('click', async () => {
        const ok = await Modal.confirm({
          title: '从备份还原音色',
          okText: '选择备份目录',
          message: '选择之前备份的目录（可以直接选 VoxVoices-… 的上级目录，会取最新的一份）。<br>'
            + '还原是<b>补充</b>：已有同名音色不会被动，只把缺失的补回来。'
        });
        if (!ok) return;
        b.disabled = true; b.textContent = '还原中…';
        try {
          const r = await window.electronAPI.voices.restore();
          if (r && r.canceled) { Toast.show('已取消'); return; }
          if (!r || !r.ok) throw new Error((r && r.message) || '还原失败');
          this._stat = null;
          await this._load();
          await App.go('voices');
          Toast.success('已还原：新增 ' + r.added + ' 个文件' + (r.skipped ? '，跳过已存在 ' + r.skipped + ' 个' : ''));
        } catch (e) {
          Toast.error(String(e.message || e), true);
          b.disabled = false; b.textContent = '从备份还原';
        }
      }));

    el.querySelectorAll('[data-act="open-voice-dir"]').forEach(b =>
      b.addEventListener('click', () => window.electronAPI.path.reveal((this._stat || {}).profiles || '')));

    el.querySelectorAll('[data-act="audition"]').forEach(b =>
      b.addEventListener('click', async () => {
        const name = b.dataset.name;
        if (!this._player) this._player = AudioPlayer.create('v-player');
        try {
          const resp = await fetch(API.getPresetVoiceUrl(name));
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          const blob = await resp.blob();
          await this._player.load(blob, API.getPresetVoiceUrl(name), name + '.wav');
          this._player.play();
          Toast.show('试听：' + name);
        } catch (e) { Toast.error('试听失败：' + e.message, true); }
      }));

    el.querySelectorAll('[data-act="edit"]').forEach(b =>
      b.addEventListener('click', () => this._renameVoice(b.dataset.name)));

    el.querySelectorAll('[data-act="del"]').forEach(b =>
      b.addEventListener('click', async () => {
        const name = b.dataset.name;
        const ok = await Modal.confirm({
          title: '删除音色', okText: '删除', danger: true,
          message: '确定删除音色 <b>' + Util.escapeHtml(name) + '</b> 吗？<br>声纹文件会一并删除，不可撤销。'
        });
        if (!ok) return;
        try {
          await API.deletePreset(name);
          await this._load(); App.go('voices');
          Toast.success('已删除：' + name);
          this._autoBackup('删除音色');
        } catch (e) { Toast.error('删除失败：' + e.message, true); }
      }));
  },

  /** 重命名 / 改描述。声纹文件不动（后端会在没上传新文件时沿用旧的）。 */
  _renameVoice(name) {
    const v = this._voices.find(x => x.name === name) || { name, desc: '', voice_file: '' };
    const used = this._usedBy(name);
    Modal.open({
      title: '修改音色', width: 460,
      body:
        '<div class="form-group"><label class="form-label">音色名称</label>'
        + '<input type="text" id="rv-name" value="' + Util.escapeAttr(v.name) + '" maxlength="40"></div>'
        + '<div class="form-group mt-12"><label class="form-label">描述（会显示在音色卡片上）</label>'
        + '<input type="text" id="rv-desc" value="' + Util.escapeAttr(v.desc || '') + '" '
        + 'placeholder="例如：声纹克隆 · 示例文本"></div>'
        + '<p class="text-sm text-muted" style="margin:12px 0 0">'
        + '只改名称或描述，<b>声纹文件不会动</b>；想换声纹请新建一个音色。'
        + (used ? '<br>注意：当前项目里有角色在用这个音色，改名后需要到「项目设置 → 角色音色」里重新选一次。' : '')
        + '</p>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
            + '<button class="btn btn-primary" data-act="save-rename">保存</button>'
    });
    const host = document.getElementById('modal-host');
    host.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
    const doSave = async () => {
      const nn = host.querySelector('#rv-name').value.trim();
      const nd = host.querySelector('#rv-desc').value.trim();
      if (!nn) { Toast.error('名称不能为空', true); return; }
      if (nn === v.name && nd === (v.desc || '')) { Modal.close(); return; }
      const btn = host.querySelector('[data-act="save-rename"]');
      btn.disabled = true; btn.textContent = '保存中…';
      try {
        await API.updatePreset(v.name, nn, nd, null);
        Modal.close();
        await this._load(); App.go('voices');
        Toast.success('已保存：' + nn);
        this._autoBackup(v.name === nn ? '修改描述' : '重命名');
      } catch (e) {
        Toast.error('保存失败：' + (e.message || e), true);
        btn.disabled = false; btn.textContent = '保存';
      }
    };
    host.querySelector('[data-act="save-rename"]').addEventListener('click', doSave);
    host.querySelector('#rv-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
    host.querySelector('#rv-desc').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
  },

  async _load() {
    try { this._voices = await API.getPresets(); }
    catch (e) { this._voices = []; Toast.error('读取音色库失败：' + e.message, true); }
    return this._voices;
  },

  _newVoice() {
    Modal.open({
      title: '新建音色', width: 520,
      body:
        '<p class="text-sm text-muted" style="margin-bottom:12px">'
        + '三种方式获得音色，结果都存进音色库。建议<b>先试听、满意再保存</b>。</p>'
        + '<div class="tabs" style="margin-bottom:14px">'
        + '<button class="tab-btn active" data-mode="design">音色设计</button>'
        + '<button class="tab-btn" data-mode="clone">可控克隆</button>'
        + '<button class="tab-btn" data-mode="hifi">极致克隆</button></div>'
        + '<div id="nv-body">' + this._form('design') + '</div>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
            + '<button class="btn" data-act="audition">试听</button>'
            + '<button class="btn btn-primary" data-act="save">保存到音色库</button>'
    });
    const overlay = document.getElementById('modal-host');
    let mode = 'design';
    overlay.querySelectorAll('[data-mode]').forEach(b =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        overlay.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
        overlay.querySelector('#nv-body').innerHTML = this._form(mode);
      }));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
    overlay.querySelector('[data-act="audition"]').addEventListener('click', () => this._audition(mode));
    overlay.querySelector('[data-act="save"]').addEventListener('click', () => this._save(mode));
  },

  _form(mode) {
    const hint = {
      design: ['描述你想要的音色', '温柔的女声，语速中等，适合纪录片旁白'],
      clone:  ['参考音频（必填）', '上传一段清晰的目标人声'],
      hifi:   ['Prompt 音频 + 对应文本（必填）', '保真度最高，适合要求严格的场景']
    }[mode];
    return '<div class="form-group"><label class="form-label">' + hint[0] + '</label>'
      + (mode === 'design'
          ? '<textarea id="nv-desc" rows="2" placeholder="' + hint[1] + '"></textarea>'
          : '<input type="file" id="nv-ref" accept="audio/*">'
            + (mode === 'hifi' ? '<input type="text" id="nv-prompt-text" class="mt-8" placeholder="音频对应的文本内容">' : ''))
      + '</div>'
      + '<div class="form-group mt-12"><label class="form-label">试听文本</label>'
      + '<input type="text" id="nv-text" value="你好，这是一段用于试听的示例文本。"></div>'
      + '<div class="form-group mt-12"><label class="form-label">音色名称（满意后再填）</label>'
      + '<input type="text" id="nv-name" placeholder="例如：纪录片旁白-温柔女声"></div>';
  },

  async _audition(mode) {
    const host = document.getElementById('modal-host');
    const text = host.querySelector('#nv-text').value.trim();
    if (!text) { Toast.error('请输入试听文本', true); return; }
    const btn = host.querySelector('[data-act="audition"]');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      let r;
      if (mode === 'design') {
        const desc = host.querySelector('#nv-desc').value.trim();
        if (!desc) throw new Error('请描述你想要的音色');
        r = await API.generateDesign(text, '无', 2.0, 10);
      } else {
        const f = host.querySelector('#nv-ref').files[0];
        if (!f) throw new Error('请选择参考音频');
        if (mode === 'clone') r = await API.generateClone(text, '无', 2.0, 10, f, '');
        else {
          const pt = host.querySelector('#nv-prompt-text').value.trim();
          if (!pt) throw new Error('请填写 Prompt 音频对应的文本');
          r = await API.generateHifi(text, f, pt, undefined, 2.0, 10);
        }
      }
      if (!r.blob) throw new Error('后端没有返回音频');
      this._lastBlob = r.blob;
      if (!this._player) this._player = AudioPlayer.create('v-player');
      await this._player.load(r.blob, null, 'audition.wav');
      this._player.play();
      Toast.success('生成成功，听完满意就保存');
    } catch (e) {
      Toast.error('试听失败：' + (e.message || e), true);
      this._lastBlob = null;
    } finally {
      btn.disabled = false; btn.textContent = '试听';
    }
  },

  async _save(mode) {
    const host = document.getElementById('modal-host');
    const name = host.querySelector('#nv-name').value.trim();
    if (!name) { Toast.error('请先填音色名称', true); return; }
    const text = host.querySelector('#nv-text').value.trim();
    const desc = mode === 'design'
      ? host.querySelector('#nv-desc').value.trim()
      : (text || '');
    try {
      let blob = this._lastBlob;
      if (!blob) {
        // 没试听过 → 直接生成一次再存
        Toast.show('还没试听，先生成一次…');
        await this._audition(mode);
        blob = this._lastBlob;
        if (!blob) return;
      }
      await API.addPreset(name, desc, new File([blob], name + '.wav', { type: 'audio/wav' }));
      Modal.close();
      await this._load();
      Toast.success('已保存到音色库：' + name);
      App.go('voices');
      this._autoBackup('新增音色');
    } catch (e) { Toast.error('保存失败：' + (e.message || e), true); }
  }
};
