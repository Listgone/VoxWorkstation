/* ══════════════════════════════════════════
   导出 —— 把配音结果输出成文件
   ══════════════════════════════════════════ */

const ExportPage = {
  _outputs: [],

  render() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return this._empty();

    const lines = ep.lines || [];
    const done = lines.filter(l => l.audio);
    const totalMs = done.reduce((a, l) => a + (l.durationMs || 0), 0);
    const allDone = lines.length > 0 && done.length === lines.length;
    const o = p.output || {};
    const g = Store.settings.output || {};

    return App.head('导出', '把配音结果输出成文件，并存档音色供下次复用',
        allDone ? '<span class="pill pill-ok">已完成 ' + done.length + ' / ' + lines.length + ' 句</span>'
                : '<span class="pill pill-warn">已完成 ' + done.length + ' / ' + lines.length + ' 句</span>')
      + '<div class="wrap slim">'

      + '<div class="card"><h2>本次成品 <span class="n">' + Util.escapeHtml(ep.episode.title || '') + '</span></h2>'
      + '<div class="action-row" style="align-items:center;gap:12px;margin-bottom:12px">'
      + '<span class="text-sm text-muted">' + done.length + ' 句 · 总时长 ' + Util.fmtDuration(totalMs) + '</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm" data-act="play-first"' + (done.length ? '' : ' disabled') + '>试听第 1 句</button>'
      + '</div>'
      + '<div id="exp-player"></div>'
      + '<div class="exp mt-12">'
      + '<button class="btn btn-lg" data-act="export-merged"' + (done.length ? '' : ' disabled') + '>整轨 WAV</button>'
      + '<button class="btn btn-lg" data-act="open-audio">打开逐句音频目录</button>'
      + '<button class="btn btn-lg" data-act="export-srt"' + (done.length ? '' : ' disabled') + '>SRT 字幕</button>'
      + '<button class="btn btn-lg" data-act="open-output">打开导出目录</button>'
      + '</div></div>'

      + '<div class="card"><h2>导出选项 <span class="n">在「设置 → 音频输出」里改默认值</span></h2>'
      + this._row('音频格式', Util.escapeHtml((g.format || 'wav').toUpperCase()) + ' · ' + (g.sampleRate || 44100) + ' Hz')
      + this._row('句间停顿', (g.pauseMs || 300) + ' ms · 按每句设定插入静音，避免整轨连读')
      + this._row('文件命名规则', Util.escapeHtml(o.naming || g.naming || '{ep}_{role}_{voice}_{no}'))
      + this._row('输出目录', Util.escapeHtml(Store.settings.output.root + '\\' + p.name + '\\第'
          + String(ep.episode.no).padStart(p.padWidth || 2, '0') + '集\\output\\'))
      + '</div>'

      + '<div class="card"><h2>逐句音频 <span class="n" id="exp-count">' + done.length + ' 个文件</span></h2>'
      + '<div id="exp-files"><p class="text-sm text-muted" style="margin:0">点上面「打开逐句音频目录」查看。</p></div>'
      + '</div>'

      + '<div class="card" style="margin-bottom:0"><h2>导出记录</h2>'
      + ((ep.exportLog || []).length
        ? '<table><tr><th style="width:150px">时间</th><th>内容</th><th style="width:100px"></th></tr>'
          + ep.exportLog.slice(0, 10).map(l =>
            '<tr><td class="num">' + Util.escapeHtml(new Date(l.time).toLocaleString('zh-CN')) + '</td>'
            + '<td>' + Util.escapeHtml(l.what || '') + '</td>'
            + '<td><button class="btn btn-sm" data-act="reveal-path" data-p="' + Util.escapeAttr(l.path || '') + '">打开目录</button></td></tr>').join('')
          + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有导出过。</p>')
      + '</div></div>';
  },

  _empty() {
    return App.head('导出', '')
      + '<div class="wrap"><div class="card"><h2>还没有打开某一集</h2>'
      + '<p class="text-sm text-muted">先选项目、打开一集并生成配音。</p>'
      + '<button class="btn btn-primary mt-12" data-act="goto-eps">去集管理</button></div></div>';
  },

  _row(label, value) {
    return '<div class="srow"><div class="l"><b>' + label + '</b><span>' + value + '</span></div></div>';
  },

  async mount(el) {
    el.querySelector('[data-act="goto-eps"]')?.addEventListener('click', () => App.go('episodes'));
    const p = Store.currentProject, ep = Store.currentEpisode;
    if (!p || !ep) return;
    const id = Store.currentProjectId, no = ep.episode.no;

    // 每次渲染都重建播放器（DOM 已被 App.go 换掉）
    this._player = AudioPlayer.create('exp-player');

    el.querySelector('[data-act="open-audio"]')?.addEventListener('click', () => {
      window.electronAPI.path.reveal(ep.dir + '\\audio');
    });
    el.querySelector('[data-act="open-output"]')?.addEventListener('click', () => {
      window.electronAPI.path.reveal(ep.dir + '\\output');
    });
    el.querySelectorAll('[data-act="reveal-path"]').forEach(b =>
      b.addEventListener('click', () => window.electronAPI.path.reveal(b.dataset.p)));

    // 逐句文件列表
    const files = await window.electronAPI.episodes.listAudio(id, no);
    const box = el.querySelector('#exp-files');
    if (box) {
      box.innerHTML = files.length
        ? '<div class="filelist">' + files.map(f => '<span class="pill">' + Util.escapeHtml(f) + '</span>').join('') + '</div>'
        : '<p class="text-sm text-muted" style="margin:0">还没有逐句音频。</p>';
    }

    const lines = ep.lines || [];
    const done = lines.filter(l => l.audio);

    // 试听第一句
    el.querySelector('[data-act="play-first"]')?.addEventListener('click', async () => {
      const first = done[0];
      if (!first) return;
      const r = await window.electronAPI.audio.read(id, no, first.audio);
      if (!r.ok) { Toast.error('读取音频失败', true); return; }
      const blob = Util.b64ToBlob(r.base64, 'audio/wav');
      await this._player.load(blob, null, first.audio);
      this._player.play();
    });

    // 整轨合并：调后端 merge 接口
    el.querySelector('[data-act="export-merged"]')?.addEventListener('click', async () => {
      if (!done.length) return;
      App._syncStatus('导出中', '合并 ' + done.length + " 个音频片段");
      try {
        const files = [];
        for (const l of done) {
          const r = await window.electronAPI.audio.read(id, no, l.audio);
          if (r.ok) files.push(new File([Util.b64ToBlob(r.base64, 'audio/wav')], l.audio, { type: 'audio/wav' }));
        }
        if (!files.length) throw new Error('没有可合并的音频');
        const res = await API.mergeAudio(files);
        if (!res.blob) throw new Error('后端没有返回音频');
        const buf = await res.blob.arrayBuffer();
        const name = '第' + String(no).padStart(p.padWidth || 2, '0') + '集_整轨.wav';
        const out = ep.dir + '\\output';
        await window.electronAPI.audio.save(id, no, '..\\output\\' + name, Util.ab2b64(buf));
        await window.electronAPI.episodes.logExport(id, no, {
          what: '整轨 WAV（' + files.length + ' 句 · ' + Util.fmtDuration(done.reduce((a, l) => a + (l.durationMs || 0), 0)) + '）',
          path: out
        });
        await Store.openEpisode(no);
        App.go('export');
        Notify.onDone();
        Toast.success('已导出：' + name);
      } catch (e) {
        Toast.error('导出失败：' + (e.message || e), true);
      }
      App._syncStatus('就绪');
    });

    // SRT 字幕
    el.querySelector('[data-act="export-srt"]')?.addEventListener('click', async () => {
      if (!done.length) return;
      const g = Store.settings.output || {};
      let t = 0, srt = '';
      const pause = g.pauseMs || 300;
      done.forEach((l, i) => {
        const dur = l.durationMs || 2000;
        const a = t, b = t + dur;
        srt += (i + 1) + '\n' + this._ts(a) + ' --> ' + this._ts(b) + '\n'
          + (l.text || '') + '\n\n';
        t = b + pause;
      });
      const name = '第' + String(no).padStart(p.padWidth || 2, '0') + '集.srt';
      const b64 = btoa(unescape(encodeURIComponent(srt)));
      await window.electronAPI.audio.save(id, no, '..\\output\\' + name, b64);
      await window.electronAPI.episodes.logExport(id, no, {
        what: 'SRT 字幕（' + done.length + ' 条）', path: ep.dir + '\\output'
      });
      await Store.openEpisode(no);
      App.go('export');
      Notify.onDone();
      Toast.success('已导出字幕：' + name);
    });
  },

  _ts(ms) {
    const total = Math.floor(ms);
    const h = String(Math.floor(total / 3600000)).padStart(2, '0');
    const m = String(Math.floor((total % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((total % 60000) / 1000)).padStart(2, '0');
    const msPart = String(total % 1000).padStart(3, '0');
    return h + ':' + m + ':' + s + ',' + msPart;
  }
};
