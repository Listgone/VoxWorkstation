/* ══════════════════════════════════════════
   配音 —— 把台词变成音频
   ══════════════════════════════════════════ */

const DubPage = {
  _player: null,
  _queue: [],
  _running: false,
  _voices: [],
  _takes: [],       // 本次生成的结果 [{lineIdx, voice, cfg, url, blob, ms}]

  render() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return this._empty();

    const lines = ep.lines || [];
    const done = lines.filter(l => l.audio).length;

    return App.head('配音', '把台词变成音频',
        '<span class="pill">' + lines.length + ' 句 · 已完成 ' + done + '</span>')
      + '<div class="wrap">'
/* 内容区（对齐线框图）：
     ① 角色与音色                ② 试听
     ③ 台词（左，整块）           ④ 参数/队列/本次生成（右，上下展开）
   参数区收起时只有一条细窄条；展开后在试听下面往下长出三块内容，
   台词始终留在左边那一大块里，不被挤到下面。 */
      + '<div class="dub-main' + (this.railCollapsed() ? ' rail-off' : '') + '">'

      + '<div class="card dub-roles"><h2>角色与音色 <span class="n">来自项目设置，同一角色共用音色</span></h2>'
      + this._roles(p, lines)
      + '</div>'

      /* 试听卡：标题行 =「试听」+ 状态（未选择/第N句）靠左，收发按钮在右侧（红框位置）。
         收起时台词横跨整宽；展开时右栏长出三块内容，台词右移让位。 */
      + '<div class="card dub-listen"><h2 class="listen-head">'
      + '<span class="lh-t">试听</span>'
      + '<span class="n" id="dub-now">未选择</span>'
      + '<button class="lf-toggle" data-act="rail-toggle" id="dub-rail-btn" '
      + 'title="' + (this.railCollapsed() ? '展开 参数 / 队列 / 本次生成' : '收起 参数 / 队列 / 本次生成') + '">'
      + '<span class="rt-ic">' + (this.railCollapsed() ? '›' : '⌄') + '</span>'
      + '</button>'
      + '</h2>'
      + '<div id="dub-player"></div>'
      + '</div>'

      /* 右栏第 2 行：展开后直接显示 参数 / 队列 / 本次生成 三张卡，
         不再放标题栏（标题栏那种重复的「参数 / 队列 / 本次生成」条已去掉）。 */
      + '<div class="rail-col">'
      + '<div class="rail-body">'
      + '<div class="rail-body-inner">'
      + '<div class="card"><h2>参数</h2>'
      + this._param('cfg', '稳定性', '10', '30', (p.defaults.cfg ?? 2.0) * 10, 10, (p.defaults.cfg ?? 2.0).toFixed(1))
      + this._param('steps', '质量', '5', '30', p.defaults.steps ?? 10, 1, String(p.defaults.steps ?? 10))
      + '<p class="text-sm text-muted" style="margin:8px 0 0">稳定性越高越贴文本；质量每 +5 约多 40% 耗时。</p>'
      + '</div>'

      + '<div class="card"><h2>队列 <span class="n" id="dub-queue">空闲</span></h2>'
      + '<div class="qbar"><i id="dub-qbar" style="width:0%"></i></div>'
      + '<p class="text-sm text-muted mt-8" style="margin-bottom:0">GPU 串行推理，一次只跑一句。</p></div>'

      + '<div class="card" style="margin-bottom:0"><h2>本次生成 <span class="n">' + this._takes.length + ' 条</span></h2>'
      + (this._takes.length
        ? '<div class="takes">' + this._takes.map((t, i) =>
            '<div class="take' + (i === 0 ? ' on' : '') + '" data-take="' + i + '">'
            + '<span class="tp">▶</span><span class="tn">' + Util.escapeHtml(t.label) + '</span>'
            + '<span class="td">' + Util.fmtDuration(t.ms) + '</span></div>').join('') + '</div>'
        : '<p class="text-sm text-muted" style="margin:0">还没有生成结果。</p>')
      + '</div>'
      + '</div>'
      + '</div>'
      + '</div>'

      + '<div class="card dub-lines"><h2>台词 <span class="n">来自文本处理页</span></h2>'
      + (lines.length
        ? '<table class="line-table"><tr><th style="width:40px">#</th><th style="width:100px">角色</th><th style="width:128px">情绪 / 动作</th><th>台词</th>'
          + '<th style="width:128px">音色</th><th style="width:96px">状态</th><th style="width:120px"></th></tr>'
          + lines.map((l, i) => this._row(l, i)).join('') + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有台词。先去「文本处理」把文本切好句。</p>')
      + '</div>'

      + '<div class="action-row">'
      + '<button class="btn btn-primary btn-lg" data-act="gen-all"' + (lines.length ? '' : ' disabled') + '>'
      + '生成全部（' + lines.length + ' 句）</button>'
      + '<button class="btn" data-act="gen-failed">只重生成失败句</button>'
      + '<span style="flex:1"></span>'
      + '<button class="btn" data-act="goto-export">前往导出 →</button>'
      + '</div>'

      + '</div></div>';
  },

  /* 右栏（参数/队列/本次生成）展开状态。默认收起 —— 只显示试听卡片。
     收发按钮在试听卡右侧那条状态带上；展开时从试听往下长、台词被挤到左边。 */
  _railKey: 'vox-dub-rail',
  railCollapsed() {
    try {
      const v = localStorage.getItem(this._railKey);
      return v === null ? true : v === 'off';
    } catch (e) { return true; }
  },
  _setRail(collapsed) {
    try { localStorage.setItem(this._railKey, collapsed ? 'off' : 'on'); } catch (e) { /* 忽略 */ }
    const main = document.querySelector('#page-dub .dub-main');
    if (main) main.classList.toggle('rail-off', collapsed);
    const btn = document.getElementById('dub-rail-btn');
    if (btn) {
      const ic = btn.querySelector('.rt-ic');
      if (ic) ic.textContent = collapsed ? '›' : '⌄';
      btn.title = collapsed ? '展开 参数 / 队列 / 本次生成' : '收起 参数 / 队列 / 本次生成';
    }
    // 播放器宽度变了，波形要按新宽度重画
    setTimeout(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* 忽略 */ } }, 320);
  },

  _empty() {
    return App.head('配音', '')
      + '<div class="wrap"><div class="card"><h2>还没有打开某一集</h2>'
      + '<p class="text-sm text-muted">先选项目、打开一集，并处理好文本。</p>'
      + '<div class="action-row mt-12"><button class="btn" data-act="goto-projects">去项目管理</button>'
      + '<button class="btn btn-primary" data-act="goto-eps">去集管理</button></div></div></div>';
  },

  _roles(p, lines) {
    const roles = (p.roles || []);
    const used = {};
    for (const l of lines) { const r = l.role || '旁白'; used[r] = (used[r] || 0) + 1; }
    const names = Object.keys(used);
    if (!names.length) return '<p class="text-sm text-muted" style="margin:0">还没有台词，无法判断角色。</p>';
    return '<div class="action-row" style="gap:10px">' + names.map(n => {
      const def = roles.find(r => r.name === n);
      const voice = def && def.voice ? def.voice : (p.fallbackVoice || '未绑定');
      return '<div class="rolecard"><div class="text-sm text-muted">角色 · '
        + Util.escapeHtml(n) + '（' + used[n] + ' 句）</div>'
        + '<div class="rolecard-v"><b>' + Util.escapeHtml(voice) + '</b>'
        + '<button class="btn btn-sm" data-act="bind-role" data-role="' + Util.escapeAttr(n) + '">更换 ▾</button>'
        + '</div></div>';
    }).join('') + '</div>';
  },

  _param(id, label, min, max, val, div, text) {
    return '<div class="param"><label>' + label + '</label>'
      + '<input type="range" id="dub-' + id + '" min="' + min + '" max="' + max + '" value="' + val + '">'
      + '<b id="dub-' + id + '-val">' + text + '</b></div>';
  },

  _row(l, i) {
    const [stLabel, stCls] = l.error ? ['失败', 'pill-err']
      : l.audio ? ['✓ ' + Util.fmtDuration(l.durationMs || 0), 'pill-ok']
      : ['· 待生成', ''];
    const role = l.role || '旁白';
    return '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td><div class="cell-c"><button class="pill pill-btn" data-act="set-role" data-i="' + i + '" title="改这一句的角色">'
      + Util.escapeHtml(role) + ' ▾</button></div></td>'
      + '<td class="emo-cell"><div class="cell-c">' + TextPage._emoCell(l) + '</div></td>'
      + '<td class="tx">' + Util.escapeHtml(l.text || '') + '</td>'
      + '<td><div class="cell-c"><button class="pill pill-btn" data-act="set-voice" data-i="' + i + '" title="单独指定这一句的音色">'
      + Util.escapeHtml(l.voice || '跟随角色') + ' ▾</button></div></td>'
      + '<td><span class="pill ' + stCls + '">' + stLabel + '</span></td>'
      + '<td class="row-acts">'
      + (l.audio
          ? '<button class="btn btn-sm btn-play" data-act="play-one" data-i="' + i + '" title="试听这一句">▶</button>'
          : '')
      + '<button class="btn btn-sm btn-gen" data-act="gen-one" data-i="' + i + '" title="只把台词本身送进 TTS，角色与情绪仅作标注">生成</button>'
      + '</td></tr>';
  },

  /** 改单句角色 —— 台词不可能全是一个人说的 */
  _setRole(i, btn) {
    const p = Store.currentProject;
    const lines = Store.currentEpisode.lines || [];
    const line = lines[i];
    if (!line) return;
    const used = [...new Set(lines.map(l => l.role).filter(Boolean))];
    const declared = (p.roles || []).map(r => r.name);
    const names = [...new Set([...declared, ...used])];
    const items = names.map(n => {
      const def = (p.roles || []).find(r => r.name === n);
      return { label: n, value: n, active: n === (line.role || '旁白'),
               sub: def && def.voice ? def.voice : '未绑定音色' };
    });
    items.push({ label: '＋ 新建角色…', value: '__new__' });
    items.push({ label: '应用到本句之后所有未生成的行', value: '__fill__' });

    App._menu(btn || document.body, items, async (v) => {
      if (v === '__new__') {
        const name = await Modal.prompt({ title: '新建角色', label: '角色名', placeholder: '例如：小明' });
        if (!name) return;
        const roles = [...(p.roles || [])];
        if (!roles.some(r => r.name === name)) roles.push({ name, voice: '', desc: '', cfg: null });
        await Store.saveProject({ roles });
        this._applyRole(i, name, false);
        return;
      }
      if (v === '__fill__') { this._applyRole(i, line.role || '旁白', true); return; }
      this._applyRole(i, v, false);
    }, { minWidth: 220 });
  },

  async _applyRole(i, role, fillAfter) {
    const lines = (Store.currentEpisode.lines || []).map(l => ({ ...l }));
    const p = Store.currentProject;
    const def = (p.roles || []).find(r => r.name === role);
    const voice = (def && def.voice) || p.fallbackVoice || '';
    const apply = (idx) => {
      lines[idx].role = role;
      if (!lines[idx].voiceOverride) lines[idx].voice = voice;
    };
    apply(i);
    if (fillAfter) for (let k = i + 1; k < lines.length; k++) if (!lines[k].audio) apply(k);
    await Store.saveEpisode({ lines });
    await Store.openEpisode(Store.currentEpisodeNo);
    App.go('dub');
    Toast.success(fillAfter ? '本句及之后未生成的行已设为「' + role + '」' : '第 ' + (i + 1) + ' 句角色改为「' + role + '」');
  },

  /** 单句音色覆盖 */
  async _setVoice(i, btn) {
    const p = Store.currentProject;
    const lines = (Store.currentEpisode.lines || []).map(l => ({ ...l }));
    const line = lines[i];
    if (!line) return;
    const def = (p.roles || []).find(r => r.name === (line.role || '旁白'));
    const items = [{ label: '跟随角色默认' + (def && def.voice ? '（' + def.voice + '）' : ''), value: '__role__' }]
      .concat(this._voices.map(v => ({ label: v.name, value: v.name, sub: v.desc || '' })));
    App._menu(btn || document.body, items, async (v) => {
      if (v === '__role__') {
        line.voiceOverride = false;
        line.voice = (def && def.voice) || p.fallbackVoice || '';
      } else {
        line.voiceOverride = true;
        line.voice = v;
      }
      await Store.saveEpisode({ lines });
      await Store.openEpisode(Store.currentEpisodeNo);
      App.go('dub');
      Toast.success('第 ' + (i + 1) + ' 句音色：' + (line.voice || '未指定'));
    }, { minWidth: 240 });
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    el.querySelector('[data-act="goto-eps"]')?.addEventListener('click', () => App.go('episodes'));
    el.querySelector('[data-act="goto-export"]')?.addEventListener('click', () => App.go('export'));
    el.querySelector('[data-act="rail-toggle"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setRail(!this.railCollapsed());
    });

    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return;

    // 每次渲染都要重建播放器：App.go() 会重建 #dub-player 的 DOM，
    // 复用旧实例会指向已被移除的节点，导致点了播放没反应
    this._player = AudioPlayer.create('dub-player');
    if (!this._voices.length) {
      try { this._voices = await API.getPresets(); } catch (e) { this._voices = []; }
    }

    el.querySelectorAll('[data-act="set-role"]').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); this._setRole(Number(b.dataset.i), b); }));
    el.querySelectorAll('[data-act="set-voice"]').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); this._setVoice(Number(b.dataset.i), b); }));

    ['cfg', 'steps'].forEach(k => {
      const sl = el.querySelector('#dub-' + k);
      sl?.addEventListener('input', () => {
        const v = el.querySelector('#dub-' + k + '-val');
        if (v) v.textContent = k === 'cfg' ? (parseInt(sl.value, 10) / 10).toFixed(1) : sl.value;
      });
    });

    el.querySelector('[data-act="gen-all"]')?.addEventListener('click', () => {
      const idx = (ep.lines || []).map((_, i) => i);
      this._generate(idx);
    });
    el.querySelector('[data-act="gen-failed"]')?.addEventListener('click', () => {
      const idx = (ep.lines || []).map((l, i) => l.error ? i : -1).filter(i => i >= 0);
      if (!idx.length) { Toast.show('没有失败的句子', false); return; }
      this._generate(idx);
    });
    el.querySelectorAll('[data-act="gen-one"]').forEach(b =>
      b.addEventListener('click', () => this._generate([Number(b.dataset.i)])));

    // 逐句试听：从集文件夹里读回音频再播
    el.querySelectorAll('[data-act="play-one"]').forEach(b =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        const line = (Store.currentEpisode.lines || [])[i];
        if (!line || !line.audio) return;
        b.disabled = true;
        try {
          const r = await window.electronAPI.audio.read(Store.currentProjectId, Store.currentEpisodeNo, line.audio);
          if (!r.ok) throw new Error(r.message || '读取失败');
          await this._player.load(Util.b64ToBlob(r.base64, 'audio/wav'), null, line.audio);
          this._player.play();
          const now = el.querySelector('#dub-now');
          if (now) now.textContent = '第 ' + (i + 1) + ' 句 · ' + (line.voice || '默认');
        } catch (e) { Toast.error('试听失败：' + e.message, true); }
        finally { b.disabled = false; }
      }));

    el.querySelectorAll('[data-act="bind-role"]').forEach(b =>
      b.addEventListener('click', () => this._bindRole(b.dataset.role)));

    el.querySelectorAll('[data-take]').forEach(t =>
      t.addEventListener('click', async () => {
        const tk = this._takes[Number(t.dataset.take)];
        if (!tk || !this._player) return;
        el.querySelectorAll('[data-take]').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        // 以前只 load 不 play，所以点了没声音，必须再去上面的试听模块按播放
        await this._player.load(tk.blob, null, tk.filename || 'audio.wav');
        this._player.play();
        const now = el.querySelector('#dub-now');
        if (now) now.textContent = '第 ' + (tk.lineIdx + 1) + ' 句 · ' + tk.label;
      }));
  },

  _bindingFor(line) {
    const p = Store.currentProject;
    const roles = p.roles || [];
    const roleName = line.role || '旁白';
    const def = roles.find(r => r.name === roleName);
    // 单句覆盖优先于角色默认
    const voice = (line.voiceOverride && line.voice)
      ? line.voice
      : ((def && def.voice) || p.fallbackVoice || line.voice || '');
    const cfg = (def && def.cfg != null) ? def.cfg : (p.defaults.cfg ?? 2.0);
    return { role: roleName, voice, cfg, steps: p.defaults.steps ?? 10 };
  },

  async _bindRole(roleName) {
    const rs = await API.getPresets().catch(() => []);
    if (!rs.length) { Toast.error('音色库是空的，先去「音色库」新建音色', true); return; }
    Modal.open({
      title: '为「' + roleName + '」选择音色', width: 460,
      body: '<div class="pick-list">' + rs.map(r =>
          '<div class="pick-item" data-voice="' + Util.escapeAttr(r.name) + '">'
          + '<b>' + Util.escapeHtml(r.name) + '</b>'
          + '<span class="text-sm text-muted">' + Util.escapeHtml(r.desc || '') + '</span></div>').join('') + '</div>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
    });
    document.querySelector('[data-act="cancel"]')?.addEventListener('click', () => Modal.close());
    document.querySelectorAll('[data-voice]').forEach(it =>
      it.addEventListener('click', async () => {
        const p = Store.currentProject;
        const roles = [...(p.roles || [])];
        const i = roles.findIndex(r => r.name === roleName);
        if (i >= 0) roles[i] = { ...roles[i], voice: it.dataset.voice };
        else roles.push({ name: roleName, voice: it.dataset.voice, desc: '', cfg: null });
        Modal.close();
        const r = await Store.saveProject({ roles });
        if (r && r.ok) { Toast.success('已绑定：' + it.dataset.voice); App.go('dub'); }
        else Toast.error(r && r.message || '保存失败', true);
      }));
  },

  async _generate(indexes) {
    if (this._running) { Toast.error('正在生成中，请等队列跑完', true); return; }
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    const lines = (ep.lines || []).map(l => ({ ...l }));

    const cfg = parseInt(document.getElementById('dub-cfg')?.value || '20', 10) / 10;
    const steps = parseInt(document.getElementById('dub-steps')?.value || '10', 10);

    this._running = true;
    this._queue = indexes.slice();
    const total = indexes.length;
    const qbar = document.getElementById('dub-qbar');
    const qlabel = document.getElementById('dub-queue');

    for (let k = 0; k < indexes.length; k++) {
      const i = indexes[k];
      const line = lines[i];
      if (qlabel) qlabel.textContent = (k + 1) + ' / ' + total + ' · 第 ' + (i + 1) + ' 句';
      if (qbar) qbar.style.width = Math.round((k / total) * 100) + '%';
      App._syncStatus('生成中', '第 ' + (i + 1) + ' / ' + total + ' 句');

      const bind = this._bindingFor(line);
      try {
        let r;
        if (bind.voice) {
          r = await API.generateClone(line.text, bind.voice, cfg || bind.cfg, steps, null, bind.voice);
        } else {
          r = await API.generateDesign(line.text, '无', cfg || bind.cfg, steps);
        }
        if (!r.blob) throw new Error('后端没有返回音频');

        const buf = await r.blob.arrayBuffer();
        // 注意：不能用 String.fromCharCode(...bytes)，130KB 的 WAV 会爆栈
        const b64 = Util.ab2b64(buf);
        // 命名：序号_角色_台词前几字 —— 便于在文件夹里认出是谁的台词
        const idx = String(i + 1).padStart(3, '0');
        const snippet = String(line.text || '')
          .replace(/\[[^\]]*\]/g, '')                 // 去掉语气标记
          .replace(/[\\/:*?"<>|\r\n]/g, '')
          .replace(/\s+/g, '')
          .slice(0, 6) || '未命名';
        const filename = idx + '_' + (line.role || '旁白') + '_' + snippet + '.wav';
        await window.electronAPI.audio.save(Store.currentProjectId, Store.currentEpisodeNo, filename, b64);

        // 估算时长
        let ms = 0;
        try {
          const ctx = AudioPlayer._getAudioContext();
          const ab = await ctx.decodeAudioData(buf.slice(0));
          ms = Math.round(ab.duration * 1000);
        } catch (e) { /* 解码失败不影响保存 */ }

        Object.assign(line, { audio: filename, voice: bind.voice, error: '', durationMs: ms });
        this._takes.unshift({
          lineIdx: i, label: (bind.voice || '默认') + ' · 稳定性 ' + (cfg || bind.cfg).toFixed(1),
          blob: r.blob, ms, filename
        });
        if (this._takes.length > 8) this._takes.pop();
      } catch (e) {
        line.error = e.message || '生成失败';
        line.audio = '';
      }
      // 每句都落盘，中断也能续
      await Store.saveEpisode({
        lines,
        episode: {
          ...Store.currentEpisode.episode,
          lineCount: lines.length,
          doneCount: lines.filter(l => l.audio).length,
          durationMs: lines.reduce((a, l) => a + (l.durationMs || 0), 0),
          status: 'dubbing'
        }
      });
    }

    if (qbar) qbar.style.width = '100%';
    if (qlabel) qlabel.textContent = '完成 ' + total + ' 句';
    this._running = false;

    await Store.openEpisode(Store.currentEpisodeNo);
    const failed = (Store.currentEpisode.lines || []).filter(l => l.error).length;
    App.go('dub');
    if (failed) { Toast.error('完成，但有 ' + failed + ' 句失败', true); Notify.onFail(); }
    else {
      Notify.onDone();
      Toast.success('已生成 ' + total + ' 句并保存到 第'
        + String(Store.currentEpisodeNo).padStart(p.padWidth || 2, '0') + '集\\audio\\');
    }
  }
};
