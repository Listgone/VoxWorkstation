/* ══════════════════════════════════════════
   配音 —— 把台词变成音频
   ══════════════════════════════════════════ */

const DubPage = {
  _player: null,
  _queue: [],
  _running: false,
  _takes: [],       // 本次生成的结果 [{lineIdx, voice, cfg, url, blob, ms}]

  render() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return this._empty();

    const lines = ep.lines || [];
    const done = lines.filter(l => l.audio).length;

    return App.head('配音', '把台词变成音频',
        '<span class="pill">' + lines.length + ' 句 · 已完成 ' + done + '</span>')
      + '<div class="wrap"><div class="cols">'
      + '<div>'

      + '<div class="card"><h2>角色与音色 <span class="n">来自项目设置，同一角色共用音色</span></h2>'
      + this._roles(p, lines)
      + '</div>'

      + '<div class="card"><h2>台词 <span class="n">来自文本处理页</span></h2>'
      + (lines.length
        ? '<table><tr><th style="width:34px">#</th><th style="width:64px">角色</th><th>台词</th>'
          + '<th style="width:96px">音色</th><th style="width:92px">状态</th><th style="width:74px"></th></tr>'
          + lines.map((l, i) => this._row(l, i)).join('') + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有台词。先去「文本处理」把文本切好句。</p>')
      + '</div>'

      + '<div class="action-row">'
      + '<button class="btn btn-primary btn-lg" data-act="gen-all"' + (lines.length ? '' : ' disabled') + '>'
      + '生成全部（' + lines.length + ' 句）</button>'
      + '<button class="btn" data-act="gen-failed">只重生成失败句</button>'
      + '<span style="flex:1"></span>'
      + '<button class="btn" data-act="goto-export">前往导出 →</button>'
      + '</div></div>'

      + '<aside>'
      + '<div class="card"><h2>试听 <span class="n" id="dub-now">未选择</span></h2>'
      + '<div id="dub-player"></div></div>'

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
      + '</aside>'
      + '</div></div>';
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
    const pad = Store.currentProject.padWidth || 2;
    return '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td><span class="pill">' + Util.escapeHtml(l.role || '旁白') + '</span></td>'
      + '<td class="tx">' + Util.escapeHtml(l.text || '') + '</td>'
      + '<td class="text-sm text-muted">' + Util.escapeHtml(l.voice || '—') + '</td>'
      + '<td><span class="pill ' + stCls + '">' + stLabel + '</span></td>'
      + '<td><button class="btn btn-sm btn-ghost" data-act="gen-one" data-i="' + i + '" title="只生成这一句">生成</button></td>'
      + '</tr>';
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    el.querySelector('[data-act="goto-eps"]')?.addEventListener('click', () => App.go('episodes'));
    el.querySelector('[data-act="goto-export"]')?.addEventListener('click', () => App.go('export'));

    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return;

    if (!this._player) this._player = AudioPlayer.create('dub-player');

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

    el.querySelectorAll('[data-act="bind-role"]').forEach(b =>
      b.addEventListener('click', () => this._bindRole(b.dataset.role)));

    el.querySelectorAll('[data-take]').forEach(t =>
      t.addEventListener('click', () => {
        const tk = this._takes[Number(t.dataset.take)];
        if (!tk || !this._player) return;
        el.querySelectorAll('[data-take]').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        this._player.load(tk.blob, null, tk.filename || 'audio.wav');
        const now = el.querySelector('#dub-now');
        if (now) now.textContent = '第 ' + (tk.lineIdx + 1) + ' 句 · ' + tk.label;
      }));
  },

  _bindingFor(line) {
    const p = Store.currentProject;
    const roles = p.roles || [];
    const roleName = line.role || '旁白';
    const def = roles.find(r => r.name === roleName);
    return {
      role: roleName,
      voice: (def && def.voice) || p.fallbackVoice || '',
      cfg: (def && def.cfg != null) ? def.cfg : (p.defaults.cfg ?? 2.0),
      steps: p.defaults.steps ?? 10
    };
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
        const pad = String(i + 1).padStart(4, '0');
        const filename = pad + '_' + (line.role || '旁白') + '_' + (bind.voice || '默认') + '.wav';
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
    if (failed) Toast.error('完成，但有 ' + failed + ' 句失败', true);
    else Toast.success('已生成 ' + total + ' 句并保存到 第'
      + String(Store.currentEpisodeNo).padStart(p.padWidth || 2, '0') + '集\\audio\\');
  }
};
