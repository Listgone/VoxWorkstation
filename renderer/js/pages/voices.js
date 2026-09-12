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
        + '<button class="btn btn-primary" data-act="new">＋ 新建音色</button>')
      + '<div class="wrap">'
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

  _card(v) {
    const used = this._usedBy(v.name);
    return '<div class="vcard">'
      + '<div class="vtop"><div class="vwave" data-wave="' + Util.escapeAttr(v.name) + '"></div>'
      + '<div class="vn"><b>' + Util.escapeHtml(v.name) + '</b>'
      + '<span>' + (v.voice_file ? '有声纹 · ' : '设计 · ') + Util.escapeHtml(v.desc || '') + '</span></div></div>'
      + '<div class="vacts">'
      + '<button class="btn btn-sm" data-act="audition" data-name="' + Util.escapeAttr(v.name) + '"'
      + (v.voice_file ? '' : ' disabled title="这个音色没有声纹文件，无法试听"') + '>▶ 试听</button>'
      + (used ? '<span class="pill pill-run">用于 ' + Util.escapeHtml(used) + '</span>' : '')
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm btn-ghost btn-danger" data-act="del" data-name="' + Util.escapeAttr(v.name) + '">删</button>'
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

    // 每次都要重建：页面重渲染后 #v-player 是新的空节点
    this._player = AudioPlayer.create('v-player');

    el.querySelector('#v-q')?.addEventListener('input', Util.debounce((e) => {
      this._q = e.target.value; App.go('voices');
    }, 250));

    el.querySelector('[data-act="refresh"]')?.addEventListener('click', async () => {
      await this._load(); App.go('voices'); Toast.success('已刷新');
    });

    el.querySelector('[data-act="new"]')?.addEventListener('click', () => this._newVoice());

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
        } catch (e) { Toast.error('删除失败：' + e.message, true); }
      }));

    // 波形缩略图
    el.querySelectorAll('[data-wave]').forEach(w => this._wave(w));
  },

  async _load() {
    try { this._voices = await API.getPresets(); }
    catch (e) { this._voices = []; Toast.error('读取音色库失败：' + e.message, true); }
    return this._voices;
  },

  /** 用名称哈希生成一条稳定的装饰波形 */
  _wave(host) {
    const name = host.dataset.wave || '';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    host.innerHTML = '';
    for (let i = 0; i < 18; i++) {
      const v = Math.abs(Math.sin((i + h % 97) * 1.7)) * 0.5 + Math.abs(Math.sin((i + h % 53) * 0.43)) * 0.5;
      const d = document.createElement('i');
      d.style.height = Math.max(2, v * 0.9 * (host.clientHeight || 30)).toFixed(1) + 'px';
      host.appendChild(d);
    }
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
    } catch (e) { Toast.error('保存失败：' + (e.message || e), true); }
  }
};
