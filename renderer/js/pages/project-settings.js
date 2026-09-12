/* ══════════════════════════════════════════
   项目设置 —— 这个片子特有的配置（所有集共用）
   ══════════════════════════════════════════ */

const ProjectSettingsPage = {
  _sec: 'basic',

  _SECTIONS: [
    ['basic',   '基本信息'],
    ['seasons', '季与集划分'],
    ['roles',   '角色与音色'],
    ['defaults','默认参数'],
    ['dict',    '项目词典'],
    ['ai',      'AI 处理'],
    ['output',  '输出'],
    ['storage', '存储'],
    ['danger',  '危险操作']
  ],

  render() {
    if (!Store.currentProject) {
      return App.head('项目设置', '')
        + '<div class="wrap"><div class="card"><h2>还没有选择项目</h2>'
        + '<p class="text-sm text-muted">先去「项目管理」打开一个项目。</p>'
        + '<button class="btn btn-primary mt-12" data-act="goto-projects">去项目管理</button></div></div>';
    }
    const p = Store.currentProject;
    return App.head('项目设置', p.name + ' · 所有集共用', '<span class="pill pill-ok">已保存</span>')
      + '<div class="setwrap">'
      + '<nav class="subnav">' + this._SECTIONS.map(([id, label]) =>
          '<a data-sec="' + id + '"' + (id === this._sec ? ' class="on"' : '')
          + (id === 'danger' ? ' style="color:var(--danger)"' : '') + '>' + label + '</a>').join('')
      + '</nav><div id="ps-body">' + this._section() + '</div></div>';
  },

  _section() {
    const p = Store.currentProject;
    switch (this._sec) {
      case 'basic':    return this._basic(p);
      case 'seasons':  return this._seasons(p);
      case 'roles':    return this._roles(p);
      case 'defaults': return this._defaults(p);
      case 'dict':     return this._dict(p);
      case 'ai':       return this._ai(p);
      case 'output':   return this._output(p);
      case 'storage':  return this._storage(p);
      case 'danger':   return this._danger(p);
    }
    return '';
  },

  _row(label, hint, control) {
    return '<div class="srow"><div class="l"><b>' + label + '</b><span>' + hint + '</span></div>'
      + control + '</div>';
  },

  _basic(p) {
    return '<div class="card"><h2>基本信息</h2>'
      + this._row('项目名称', '决定文件夹名，改名会同步重命名文件夹',
          '<input type="text" id="ps-name" value="' + Util.escapeAttr(p.name) + '" style="width:220px">')
      + this._row('简介', '给自己看的备注',
          '<input type="text" id="ps-desc" value="' + Util.escapeAttr(p.desc || '') + '" style="width:340px">')
      + this._row('项目类型', '影响新建集时的默认结构',
          '<select id="ps-type" style="width:200px">'
          + ['series:剧集（多集 + 季划分）', 'single:单集 / 单片', 'audiobook:有声书（章节）']
            .map(o => { const [v, t] = o.split(':'); return '<option value="' + v + '"' + (p.type === v ? ' selected' : '') + '>' + t + '</option>'; }).join('')
          + '</select>')
      + this._row('状态', '归档后不出现在主列表，文件保留',
          '<span class="pill ' + Util.projStatus(p.status)[1] + '">' + Util.projStatus(p.status)[0] + '</span>'
          + '<button class="btn btn-sm" data-act="toggle-archive">' + (p.status === 'archived' ? '恢复' : '归档') + '</button>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-basic">保存基本信息</button></div>'
      + '</div>';
  },

  _seasons(p) {
    const eps = Store.episodes;
    const rows = (p.seasons || []).map((s, i) => {
      const inS = eps.filter(e => e.no >= s.from && e.no <= s.to);
      const done = inS.filter(e => e.status === 'done' || e.status === 'delivered').length;
      const dub = inS.filter(e => e.status === 'dubbing').length;
      const dur = inS.reduce((a, e) => a + (e.durationMs || 0), 0);
      const total = Math.max(1, s.to - s.from + 1);
      const pd = Math.round((done / total) * 100), pdu = Math.round((dub / total) * 100);
      return '<div class="season">'
        + '<div class="hd"><b>' + Util.escapeHtml(s.name) + '</b>'
        + '<span class="rng">第 ' + s.from + ' – ' + s.to + ' 集 · 共 ' + total + ' 集</span>'
        + '<span style="flex:1"></span>'
        + '<button class="btn btn-sm" data-act="rename-season" data-i="' + i + '">重命名</button>'
        + '<button class="btn btn-sm btn-ghost btn-danger" data-act="del-season" data-i="' + i + '">删除</button></div>'
        + '<div class="season-bar"><i style="width:' + pd + '%;background:var(--ok)"></i>'
        + '<i style="width:' + pdu + '%;background:var(--accent)"></i></div>'
        + '<div class="season-ft"><span>已完成 ' + done + ' 集</span><span>配音中 ' + dub + ' 集</span>'
        + '<span>总时长 ' + Util.fmtDuration(dur) + '</span></div></div>';
    }).join('');

    const maxNo = eps.length ? Math.max(...eps.map(e => e.no)) : 0;
    return '<div class="card"><h2>季与集划分 <span class="n">按集号区间划分，集本身平铺在项目文件夹下</span></h2>'
      + (rows || '<p class="text-sm text-muted">还没有划分季。加一个吧。</p>')
      + '<div class="action-row mt-12">'
      + '<input type="text" id="s-name" placeholder="季名称，如 第一季·文明的进程" style="width:250px">'
      + '<input type="number" id="s-from" value="' + (maxNo + 1) + '" style="width:80px" placeholder="起">'
      + '<span class="text-sm text-muted">到</span>'
      + '<input type="number" id="s-to" value="' + (maxNo + 20) + '" style="width:80px" placeholder="止">'
      + '<button class="btn btn-sm" data-act="add-season">＋ 添加一季</button>'
      + '</div>'
      + this._row('集号格式', '前导补零，保证文件夹排序正确',
          '<select id="ps-pad" style="width:180px">'
          + [[2, '第01集（补两位）'], [3, '第001集（补三位）'], [1, '第1集（不补）']]
            .map(([v, t]) => '<option value="' + v + '"' + (p.padWidth === v ? ' selected' : '') + '>' + t + '</option>').join('')
          + '</select><button class="btn btn-sm" data-act="save-pad">应用</button>')
      + '</div>';
  },

  _roles(p) {
    const roles = p.roles || [];
    const rows = roles.map((r, i) =>
      '<tr><td><b>' + Util.escapeHtml(r.name) + '</b></td>'
      + '<td>' + (r.voice ? Util.escapeHtml(r.voice) : '<span class="text-muted">未绑定</span>') + '</td>'
      + '<td class="text-muted">' + Util.escapeHtml(r.desc || '') + '</td>'
      + '<td class="num">' + (r.cfg != null ? r.cfg.toFixed(1) : '继承默认') + '</td>'
      + '<td><button class="btn btn-sm btn-ghost" data-act="edit-role" data-i="' + i + '">改</button>'
      + '<button class="btn btn-sm btn-ghost btn-danger" data-act="del-role" data-i="' + i + '">删</button></td></tr>').join('');

    return '<div class="card"><h2>角色与音色 <span class="n">跨所有集保持一致的关键</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-6px 0 12px">这里定义一次，所有集共用。改这里 = 全项目该角色的音色统一换掉。</p>'
      + (roles.length
        ? '<table><tr><th style="width:120px">角色</th><th style="width:180px">绑定音色</th>'
          + '<th>说明</th><th style="width:110px">参数覆盖</th><th style="width:96px"></th></tr>' + rows + '</table>'
        : '<p class="text-sm text-muted">还没有角色。</p>')
      + '<div class="action-row mt-12">'
      + '<button class="btn btn-sm" data-act="add-role">＋ 添加角色</button></div>'
      + this._row('兜底音色', '剧本里出现但未登记的角色用这个，避免生成失败', 
          '<select id="ps-fallback" style="width:200px"><option value="">（不设置）</option>'
          + (p.roles || []).map(r => '<option value="' + Util.escapeAttr(r.voice || '') + '"'
              + (p.fallbackVoice === r.voice ? ' selected' : '') + '>' + Util.escapeHtml(r.voice || r.name) + '</option>').join('')
          + '</select><button class="btn btn-sm" data-act="save-fallback">应用</button>')
      + '</div>';
  },

  _defaults(p) {
    const d = p.defaults || {};
    return '<div class="card"><h2>默认参数 <span class="n">新建集时继承，个别集可在配音页覆盖</span></h2>'
      + this._row('稳定性 / 质量', '越高越贴文本；质量每 +5 约多 40% 耗时',
          '<input type="number" id="ps-cfg" value="' + (d.cfg ?? 2.0) + '" step="0.1" style="width:80px">'
          + '<input type="number" id="ps-steps" value="' + (d.steps ?? 10) + '" style="width:80px">')
      + this._row('句间停顿', '整轨拼接时每句前后的静音长度',
          '<input type="number" id="ps-pause" value="' + (d.pauseMs ?? 300) + '" style="width:90px">'
          + '<span class="text-sm text-muted">ms</span>')
      + this._row('目标句长', 'AI 断句时每句不超过多少字',
          '<input type="number" id="ps-maxlen" value="' + (d.maxLineLen ?? 25) + '" style="width:80px">'
          + '<span class="text-sm text-muted">字</span>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-defaults">保存</button></div>'
      + '</div>';
  },

  _dict(p) {
    const dict = p.dict || [];
    return '<div class="card"><h2>项目词典 <span class="n">只在这个项目生效</span></h2>'
      + (dict.length
        ? '<table><tr><th style="width:140px">词</th><th style="width:200px">读法</th><th style="width:70px"></th></tr>'
          + dict.map((d, i) => '<tr><td>' + Util.escapeHtml(d.word) + '</td><td>' + Util.escapeHtml(d.reading) + '</td>'
              + '<td><button class="btn btn-sm btn-ghost btn-danger" data-act="del-dict" data-i="' + i + '">删</button></td></tr>').join('')
          + '</table>'
        : '<p class="text-sm text-muted">还没有词条。把易读错的专有名词加进来，比如「良渚 → liáng zhǔ」。</p>')
      + '<div class="action-row mt-12">'
      + '<input type="text" id="d-word" placeholder="词" style="width:160px">'
      + '<input type="text" id="d-read" placeholder="读法" style="width:200px">'
      + '<button class="btn btn-sm" data-act="add-dict">＋ 添加词条</button></div>'
      + '</div>';
  },

  _ai(p) {
    const ai = p.ai || {};
    return '<div class="card"><h2>AI 处理 <span class="n">可覆盖全局设置</span></h2>'
      + this._row('本项目用哪个服务商', '历史纪录片术语多，可指定更强的模型',
          '<select id="ps-ai-provider" style="width:220px">'
          + [['', '跟随全局设置'], ['deepseek', 'DeepSeek'], ['qwen', '通义千问'], ['kimi', 'Kimi'], ['ollama', '本地 Ollama']]
            .map(([v, t]) => '<option value="' + v + '"' + (ai.provider === v ? ' selected' : '') + '>' + t + '</option>').join('')
          + '</select>')
      + this._row('项目提示词', '每次 AI 处理都带上，用于统一语气与术语',
          '<input type="text" id="ps-ai-prompt" value="' + Util.escapeAttr(ai.prompt || '') + '" style="width:400px" placeholder="例如：这是一部严肃历史纪录片，语气庄重">')
      + this._row('默认启用哪几项', '新建集时自动勾选',
          ['normalize:规范化', 'split:断句', 'tone:语气标注', 'roles:角色分离']
            .map(o => { const [v, t] = o.split(':'); const on = (ai.features || []).includes(v);
              return '<span class="pill ' + (on ? 'pill-p' : '') + '">' + t + '</span>'; }).join(''))
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-ai">保存</button></div>'
      + '</div>';
  },

  _output(p) {
    const o = p.output || {};
    return '<div class="card"><h2>输出</h2>'
      + this._row('项目输出目录', Util.escapeHtml(Store.settings.output.root + '\\' + p.name + '\\'),
          '<button class="btn btn-sm" data-act="reveal-project">打开目录</button>')
      + this._row('命名规则', '逐句音频文件名',
          '<input type="text" id="ps-naming" value="' + Util.escapeAttr(o.naming || '{ep}_{role}_{voice}_{no}') + '" style="width:260px">')
      + this._row('默认导出整轨 + SRT', '每次导出自动带上',
          '<label class="sw' + (o.exportSrt === false ? ' off' : '') + '" data-act="toggle-srt"></label>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-output">保存</button></div>'
      + '</div>';
  },

  _storage(p) {
    const st = p.storage || {};
    return '<div class="card"><h2>存储</h2>'
      + this._row('保留逐句音频', '关闭则只留整轨成品，省空间',
          '<label class="sw' + (st.keepLineAudio === false ? ' off' : '') + '" data-act="toggle-keep"></label>')
      + this._row('当前占用', '音频与文本合计',
          '<span class="text-sm text-muted">' + Store.episodes.length + ' 集 · '
          + Util.fmtNum(Store.stats().lines) + ' 句</span>')
      + this._row('清理回收站', '删除的项目/集在 .trash 里，可手动恢复',
          '<button class="btn btn-sm" data-act="reveal-trash">打开回收站</button>')
      + '</div>';
  },

  _danger(p) {
    return '<div class="card danger" style="border-color:rgba(207,34,46,.3)"><h2 style="color:var(--danger)">危险操作</h2>'
      + this._row('导出项目包', '打包整个项目文件夹，可换机器打开',
          '<button class="btn btn-sm" data-act="reveal-project">打开文件夹</button>')
      + this._row('归档项目', '不出现在主列表，文件全部保留',
          '<button class="btn btn-sm" data-act="toggle-archive">' + (p.status === 'archived' ? '恢复' : '归档') + '</button>')
      + this._row('删除项目', '移到回收站，不是直接抹掉，可手动拿回',
          '<button class="btn btn-sm btn-danger" data-act="del-project">删除项目</button>')
      + '</div>';
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    if (!Store.currentProject) return;

    // 子导航
    el.querySelectorAll('[data-sec]').forEach(a =>
      a.addEventListener('click', () => {
        this._sec = a.dataset.sec;
        App.go('project-settings');
      }));

    const p = Store.currentProject;
    const save = async (patch, msg) => {
      const r = await Store.saveProject(patch);
      if (r && r.ok) {
        Toast.success(msg || '已保存');
        if (r.renamedTo) await App.go('projects');
        else App.go('project-settings');
      } else Toast.error(r && r.message || '保存失败', true);
    };

    el.querySelector('[data-act="save-basic"]')?.addEventListener('click', () => save({
      name: el.querySelector('#ps-name').value.trim(),
      desc: el.querySelector('#ps-desc').value.trim(),
      type: el.querySelector('#ps-type').value
    }, '基本信息已保存'));

    el.querySelector('[data-act="save-defaults"]')?.addEventListener('click', () => save({
      defaults: {
        cfg: parseFloat(el.querySelector('#ps-cfg').value) || 2.0,
        steps: parseInt(el.querySelector('#ps-steps').value, 10) || 10,
        pauseMs: parseInt(el.querySelector('#ps-pause').value, 10) || 300,
        maxLineLen: parseInt(el.querySelector('#ps-maxlen').value, 10) || 25
      }
    }, '默认参数已保存'));

    el.querySelector('[data-act="save-ai"]')?.addEventListener('click', () => save({
      ai: { ...(p.ai || {}), provider: el.querySelector('#ps-ai-provider').value,
            prompt: el.querySelector('#ps-ai-prompt').value.trim() }
    }, 'AI 设置已保存'));

    el.querySelector('[data-act="save-output"]')?.addEventListener('click', () => save({
      output: { ...(p.output || {}), naming: el.querySelector('#ps-naming').value.trim() }
    }, '输出设置已保存'));

    el.querySelector('[data-act="save-pad"]')?.addEventListener('click', () => {
      const pad = parseInt(el.querySelector('#ps-pad').value, 10);
      Modal.confirm({
        title: '修改集号格式',
        message: '已有的集文件夹<b>不会被自动重命名</b>，只影响以后新建的集。<br><br>确定改成「补 ' + pad + ' 位」吗？',
        okText: '确定'
      }).then(ok => { if (ok) save({ padWidth: pad }, '集号格式已更新'); });
    });

    el.querySelector('[data-act="toggle-archive"]')?.addEventListener('click', async () => {
      const next = p.status === 'archived' ? 'active' : 'archived';
      await window.electronAPI.projects.setStatus(p.id, next);
      await Store.openProject(p.id);
      await Store.reloadProjects();
      Toast.success(next === 'archived' ? '已归档' : '已恢复');
      App.go('project-settings');
    });

    el.querySelector('[data-act="reveal-project"]')?.addEventListener('click', () =>
      window.electronAPI.projects.reveal(p.id));
    el.querySelector('[data-act="reveal-trash"]')?.addEventListener('click', () =>
      window.electronAPI.path.reveal(Store.settings.output.root + '\\.trash'));

    el.querySelector('[data-act="del-project"]')?.addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: '删除项目', okText: '移到回收站', danger: true,
        message: '整个项目文件夹会被移到 <code>.trash\\</code>，<b>不是直接抹掉</b>。<br><br>项目：<b>' + Util.escapeHtml(p.name) + '</b>'
      });
      if (!ok) return;
      const r = await window.electronAPI.projects.remove(p.id, true);
      if (r && r.ok) {
        Store.currentProjectId = null; Store.currentProject = null;
        await Store.reloadProjects();
        Toast.success('已移到回收站');
        App.go('projects');
      } else Toast.error(r && r.message || '删除失败', true);
    });

    /* 季 */
    el.querySelector('[data-act="add-season"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#s-name').value.trim() || ('第' + ((p.seasons || []).length + 1) + '季');
      const from = parseInt(el.querySelector('#s-from').value, 10);
      const to = parseInt(el.querySelector('#s-to').value, 10);
      if (!(from > 0) || !(to >= from)) { Toast.error('起止集号不对', true); return; }
      const seasons = [...(p.seasons || []), { name, from, to }].sort((a, b) => a.from - b.from);
      await save({ seasons }, '已添加：' + name);
    });

    el.querySelectorAll('[data-act="rename-season"]').forEach(b =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        const seasons = [...(p.seasons || [])];
        const name = await Modal.prompt({ title: '重命名季', label: '季名称', value: seasons[i].name });
        if (!name) return;
        seasons[i] = { ...seasons[i], name };
        await save({ seasons }, '已重命名');
      }));

    el.querySelectorAll('[data-act="del-season"]').forEach(b =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        const seasons = (p.seasons || []).filter((_, k) => k !== i);
        const ok = await Modal.confirm({ title: '删除季划分', okText: '删除', danger: true,
          message: '只删除<b>划分</b>，集和音频文件都不受影响。' });
        if (ok) await save({ seasons }, '已删除该季划分');
      }));

    /* 角色 */
    el.querySelector('[data-act="add-role"]')?.addEventListener('click', () => this._editRole(null, -1));
    el.querySelectorAll('[data-act="edit-role"]').forEach(b =>
      b.addEventListener('click', () => this._editRole((p.roles || [])[Number(b.dataset.i)], Number(b.dataset.i))));
    el.querySelectorAll('[data-act="del-role"]').forEach(b =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        const roles = (p.roles || []).filter((_, k) => k !== i);
        await save({ roles }, '已删除角色');
      }));
    el.querySelector('[data-act="save-fallback"]')?.addEventListener('click', () =>
      save({ fallbackVoice: el.querySelector('#ps-fallback').value }, '兜底音色已保存'));

    /* 词典 */
    el.querySelector('[data-act="add-dict"]')?.addEventListener('click', async () => {
      const word = el.querySelector('#d-word').value.trim();
      const reading = el.querySelector('#d-read').value.trim();
      if (!word || !reading) { Toast.error('词和读法都要填', true); return; }
      await save({ dict: [...(p.dict || []), { word, reading }] }, '已添加词条');
    });
    el.querySelectorAll('[data-act="del-dict"]').forEach(b =>
      b.addEventListener('click', async () => {
        const i = Number(b.dataset.i);
        await save({ dict: (p.dict || []).filter((_, k) => k !== i) }, '已删除词条');
      }));

    /* 开关 */
    el.querySelector('[data-act="toggle-srt"]')?.addEventListener('click', (e) => {
      const on = !e.currentTarget.classList.contains('off');
      save({ output: { ...(p.output || {}), exportSrt: !on } }, '已更新');
    });
    el.querySelector('[data-act="toggle-keep"]')?.addEventListener('click', (e) => {
      const on = !e.currentTarget.classList.contains('off');
      save({ storage: { ...(p.storage || {}), keepLineAudio: !on } }, '已更新');
    });
  },

  async _editRole(role, index) {
    const p = Store.currentProject;
    const voices = (window.__voices || []);
    const overlay = Modal.open({
      title: index >= 0 ? '编辑角色' : '添加角色',
      width: 460,
      body:
        '<div class="form-group"><label class="form-label">角色名</label>'
        + '<input type="text" id="r-name" value="' + Util.escapeAttr(role ? role.name : '') + '" placeholder="例如：旁白"></div>'
        + '<div class="form-group mt-12"><label class="form-label">绑定音色</label>'
        + '<input type="text" id="r-voice" value="' + Util.escapeAttr(role ? (role.voice || '') : '') + '" placeholder="音色名（留空则不绑定）"></div>'
        + '<div class="form-group mt-12"><label class="form-label">说明</label>'
        + '<input type="text" id="r-desc" value="' + Util.escapeAttr(role ? (role.desc || '') : '') + '" placeholder="例如：全片主叙述"></div>'
        + '<div class="form-group mt-12"><label class="form-label">稳定性覆盖（留空继承默认）</label>'
        + '<input type="number" id="r-cfg" step="0.1" value="' + (role && role.cfg != null ? role.cfg : '') + '"></div>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
            + '<button class="btn btn-primary" data-act="ok">保存</button>'
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
    overlay.querySelector('[data-act="ok"]').addEventListener('click', async () => {
      const name = overlay.querySelector('#r-name').value.trim();
      if (!name) { Toast.error('请输入角色名', true); return; }
      const cfgRaw = overlay.querySelector('#r-cfg').value.trim();
      const item = {
        name,
        voice: overlay.querySelector('#r-voice').value.trim(),
        desc: overlay.querySelector('#r-desc').value.trim(),
        cfg: cfgRaw === '' ? null : parseFloat(cfgRaw),
        steps: role ? role.steps : null
      };
      const roles = [...(p.roles || [])];
      if (index >= 0) roles[index] = item; else roles.push(item);
      Modal.close();
      const r = await Store.saveProject({ roles });
      if (r && r.ok) { Toast.success('已保存角色'); App.go('project-settings'); }
      else Toast.error(r && r.message || '保存失败', true);
    });
  }
};
