/* ══════════════════════════════════════════
   集管理 —— 集多，列表式；按季分组 + 搜索/筛选/批量
   ══════════════════════════════════════════ */

const EpisodesPage = {
  _q: '', _status: '', _season: '', _sort: 'no', _sel: new Set(),

  render() {
    const p = Store.currentProject;
    if (!p) return this._empty();

    let list = Store.episodes.slice();
    if (this._q) {
      const q = this._q.toLowerCase();
      list = list.filter(e => String(e.title).toLowerCase().includes(q) || String(e.no).includes(q));
    }
    if (this._status) list = list.filter(e => e.status === this._status);
    if (this._sort === 'updated') list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    else list.sort((a, b) => a.no - b.no);

    // 按季分组（季是区间）
    const seasons = [...(p.seasons || [])].sort((a, b) => a.from - b.from);
    const groups = [];
    for (const s of seasons) {
      const eps = list.filter(e => e.no >= s.from && e.no <= s.to);
      if (eps.length) groups.push({ name: s.name, from: s.from, to: s.to, eps });
    }
    const orphans = list.filter(e => !seasons.some(s => e.no >= s.from && e.no <= s.to));
    if (orphans.length) groups.push({ name: '未归属季', from: orphans[0].no, to: orphans[orphans.length - 1].no, eps: orphans });

    const st = Store.stats();

    return App.head('集管理', p.name + ' · ' + (seasons.length ? seasons.length + ' 季 · ' : '') + Store.episodes.length + ' 集',
        '<button class="btn" data-act="batch-import">批量导入 txt</button>'
        + '<button class="btn btn-primary" data-act="new-ep">＋ 新建集</button>')
      + '<div class="wrap">'
      + '<div class="toolrow">'
      + '<input type="text" id="ep-q" placeholder="搜索集标题 / 集号…" style="width:260px" value="' + Util.escapeAttr(this._q) + '">'
      + '<select id="ep-season" style="width:150px"><option value="">全部季</option>'
      + seasons.map((s, i) => '<option value="' + i + '"' + (String(this._season) === String(i) ? ' selected' : '') + '>'
          + Util.escapeHtml(s.name) + '</option>').join('') + '</select>'
      + '<select id="ep-status" style="width:140px">'
      + [['', '全部状态'], ['draft', '草稿'], ['text', '文本处理中'], ['dubbing', '配音中'], ['done', '已完成'], ['delivered', '已交付']]
          .map(([v, t]) => '<option value="' + v + '"' + (this._status === v ? ' selected' : '') + '>' + t + '</option>').join('')
      + '</select>'
      + '<select id="ep-sort" style="width:140px">'
      + [['no', '按集号'], ['updated', '按更新时间']]
          .map(([v, t]) => '<option value="' + v + '"' + (this._sort === v ? ' selected' : '') + '>' + t + '</option>').join('')
      + '</select>'
      + '<span style="flex:1"></span>'
      + '<span class="text-sm text-muted">共 ' + list.length + ' 集 · 已生成 ' + st.doneLines + '/' + st.lines + ' 句</span>'
      + '</div>'
      + (this._sel.size ? this._selbar() : '')
      + (groups.length ? groups.map(g => this._group(g)).join('')
          : '<div class="card"><p class="text-sm text-muted" style="margin:0">'
            + (Store.episodes.length ? '没有符合筛选条件的集。' : '还没有集。点右上角「＋ 新建集」开始。') + '</p></div>')
      + '</div>';
  },

  _empty() {
    return App.head('集管理', '')
      + '<div class="wrap"><div class="card"><h2>还没有选择项目</h2>'
      + '<p class="text-sm text-muted">先去「项目管理」打开或新建一个项目。</p>'
      + '<button class="btn btn-primary mt-12" data-act="goto-projects">去项目管理</button></div></div>';
  },

  _selbar() {
    return '<div class="selbar"><b>已选 ' + this._sel.size + ' 集</b><span style="flex:1"></span>'
      + '<button class="btn btn-sm" data-act="sel-clear">取消选择</button>'
      + '<button class="btn btn-sm" data-act="sel-status">改状态…</button>'
      + '<button class="btn btn-sm btn-danger" data-act="sel-delete">删除</button></div>';
  },

  _group(g) {
    const done = g.eps.filter(e => e.status === 'done' || e.status === 'delivered').length;
    const dub = g.eps.filter(e => e.status === 'dubbing').length;
    const dur = g.eps.reduce((a, e) => a + (e.durationMs || 0), 0);
    return '<div class="seasonblock">'
      + '<div class="seasonhead"><b>' + Util.escapeHtml(g.name) + '</b>'
      + '<span class="pill">第 ' + g.from + ' – ' + g.to + ' 集</span>'
      + '<span class="num">已完成 ' + done + (dub ? ' · 配音中 ' + dub : '') + '</span>'
      + '<span style="flex:1"></span>'
      + '<span class="num text-sm">' + g.eps.length + ' 集 · ' + Util.fmtDuration(dur) + '</span>'
      + '<button class="btn btn-sm" data-act="add-ep-season" data-from="' + g.from + '" data-to="' + g.to + '">＋ 本季新建集</button>'
      + '</div>'
      + '<table><tr><th style="width:34px"></th><th style="width:60px">集号</th><th>标题</th>'
      + '<th style="width:66px">字数</th><th style="width:54px">句数</th><th style="width:60px">时长</th>'
      + '<th style="width:150px">配音进度</th><th style="width:92px">状态</th><th style="width:120px"></th></tr>'
      + g.eps.map(e => this._row(e)).join('')
      + '</table></div>';
  },

  _row(e) {
    const [label, cls] = Util.epStatus(e.status);
    const cur = e.no === Store.currentEpisodeNo;
    const pad = (Store.currentProject.padWidth || 2);
    const fail = e.failureCount > 0 ? ' <span class="pill pill-err">' + e.failureCount + ' 句失败</span>' : '';
    return '<tr' + (cur ? ' class="row-cur"' : '') + '>'
      + '<td><span class="cb' + (this._sel.has(e.no) ? ' on' : '') + '" data-sel="' + e.no + '"></span></td>'
      + '<td class="num">' + String(e.no).padStart(pad, '0') + '</td>'
      + '<td><b>' + Util.escapeHtml(e.title || '') + '</b>' + fail
      + (cur ? ' <span class="pill pill-run">当前</span>' : '') + '</td>'
      + '<td class="num">' + Util.fmtNum(e.chars || 0) + '</td>'
      + '<td class="num">' + (e.lineCount || 0) + '</td>'
      + '<td class="num">' + (e.durationMs ? Util.fmtDuration(e.durationMs) : '—') + '</td>'
      + '<td>' + Util.progressBar(e.doneCount || 0, e.lineCount || 0, 72) + '</td>'
      + '<td><span class="pill ' + cls + '">' + label + '</span></td>'
      + '<td class="row-acts">'
      + '<button class="btn btn-sm' + (cur ? ' btn-primary' : '') + '" data-act="open-ep" data-no="' + e.no + '">'
      + (cur ? '继续' : '打开') + '</button>'
      + '<button class="btn btn-sm btn-ghost btn-danger btn-del" data-act="del-ep" data-no="' + e.no + '"'
      + ' title="删除这一集">删除</button></td>'
      + '</tr>';
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    if (!Store.currentProject) return;

    const re = () => App.go('episodes');
    el.querySelector('#ep-q')?.addEventListener('input', Util.debounce((e) => { this._q = e.target.value; re(); }, 250));
    el.querySelector('#ep-status')?.addEventListener('change', (e) => { this._status = e.target.value; re(); });
    el.querySelector('#ep-sort')?.addEventListener('change', (e) => { this._sort = e.target.value; re(); });
    el.querySelector('#ep-season')?.addEventListener('change', (e) => { this._season = e.target.value; re(); });

    el.querySelectorAll('[data-sel]').forEach(cb =>
      cb.addEventListener('click', () => {
        const no = Number(cb.dataset.sel);
        if (this._sel.has(no)) this._sel.delete(no); else this._sel.add(no);
        re();
      }));

    el.querySelector('[data-act="sel-clear"]')?.addEventListener('click', () => { this._sel.clear(); re(); });

    el.querySelector('[data-act="sel-status"]')?.addEventListener('click', async () => {
      const overlay = Modal.open({
        title: '批量修改状态', width: 400,
        body: '<div class="form-group"><label class="form-label">新状态</label><select id="bs-sel">'
          + [['draft', '草稿'], ['text', '文本处理中'], ['dubbing', '配音中'], ['done', '已完成'], ['delivered', '已交付']]
              .map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('')
          + '</select></div>',
        footer: '<button class="btn" data-act="cancel">取消</button>'
              + '<button class="btn btn-primary" data-act="ok">应用</button>'
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
      overlay.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        const status = overlay.querySelector('#bs-sel').value;
        for (const no of this._sel) {
          const r = await window.electronAPI.episodes.read(Store.currentProjectId, no);
          if (r && r.ok) await window.electronAPI.episodes.write(Store.currentProjectId, no, { episode: { ...r.episode, status } });
        }
        Modal.close(); this._sel.clear();
        await Store.reloadEpisodes(); Toast.success('已批量修改状态'); re();
      });
    });

    el.querySelector('[data-act="sel-delete"]')?.addEventListener('click', async () => {
      const n = this._sel.size;
      const ok = await Modal.confirm({ title: '批量删除', okText: '移到回收站', danger: true,
        message: '将删除 <b>' + n + ' 集</b>，文件夹会被移到 <code>.trash\\</code>，可手动恢复。' });
      if (!ok) return;
      for (const no of this._sel) await window.electronAPI.episodes.remove(Store.currentProjectId, no, true);
      this._sel.clear();
      await Store.reloadEpisodes(); Toast.success('已删除 ' + n + ' 集'); re();
    });

    el.querySelectorAll('[data-act="open-ep"]').forEach(b =>
      b.addEventListener('click', async () => {
        const r = await Store.openEpisode(Number(b.dataset.no));
        if (r && r.ok) App.go('dub');
        else Toast.error(r && r.message || '打不开该集', true);
      }));

    el.querySelectorAll('[data-act="del-ep"]').forEach(b =>
      b.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const no = Number(b.dataset.no);
        const ok = await Modal.confirm({ title: '删除这一集', okText: '移到回收站', danger: true,
          message: '第 <b>' + no + '</b> 集的整个文件夹会移到 <code>.trash\\</code>，包括已生成的音频。<br>可手动恢复。' });
        if (!ok) return;
        await window.electronAPI.episodes.remove(Store.currentProjectId, no, true);
        if (Store.currentEpisodeNo === no) { Store.currentEpisodeNo = null; Store.currentEpisode = null; }
        await Store.reloadEpisodes(); Toast.success('已删除'); re();
      }));

    el.querySelector('[data-act="new-ep"]')?.addEventListener('click', () => this._newEp());
    el.querySelectorAll('[data-act="add-ep-season"]').forEach(b =>
      b.addEventListener('click', () => this._newEp(Number(b.dataset.from))));

    el.querySelector('[data-act="batch-import"]')?.addEventListener('click', () =>
      Toast.show('批量导入需要文件对话框，下一步接入', false));
  },

  async _newEp(preferFrom) {
    const p = Store.currentProject;
    const used = new Set(Store.episodes.map(e => e.no));
    let next = preferFrom || 1;
    while (used.has(next)) next++;
    const overlay = Modal.open({
      title: '新建集', width: 440,
      body:
        '<div class="form-group"><label class="form-label">集号</label>'
        + '<input type="number" id="ne-no" value="' + next + '"></div>'
        + '<div class="form-group mt-12"><label class="form-label">标题（可留空）</label>'
        + '<input type="text" id="ne-title" placeholder="例如：技术的渗透"></div>'
        + '<p class="text-sm text-muted mt-12">将创建文件夹 <code>'
        + Util.escapeHtml(p.name + '\\第' + String(next).padStart(p.padWidth || 2, '0') + '集\\')
        + '</code>，内含 script / lines / audio / output。</p>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
            + '<button class="btn btn-primary" data-act="ok">创建并打开</button>'
    });
    const upd = () => {
      const no = parseInt(overlay.querySelector('#ne-no').value, 10) || 1;
      overlay.querySelector('code').textContent =
        p.name + '\\第' + String(no).padStart(p.padWidth || 2, '0') + '集\\';
    };
    overlay.querySelector('#ne-no').addEventListener('input', upd);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
    overlay.querySelector('[data-act="ok"]').addEventListener('click', async () => {
      const no = parseInt(overlay.querySelector('#ne-no').value, 10);
      const title = overlay.querySelector('#ne-title').value.trim();
      if (!(no > 0)) { Toast.error('集号要大于 0', true); return; }
      const r = await Store.createEpisode(no, title);
      if (!r.ok) { Toast.error(r.message, true); return; }
      Modal.close();
      await Store.openEpisode(no);
      Toast.success('已创建第 ' + no + ' 集');
      App.go('text');
    });
  }
};
