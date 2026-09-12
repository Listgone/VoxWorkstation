/* ══════════════════════════════════════════
   项目管理 —— 项目少，卡片式
   ══════════════════════════════════════════ */

const ProjectsPage = {
  render() {
    const active = Store.projects.filter(p => p.status !== 'archived');
    const archived = Store.projects.filter(p => p.status === 'archived');

    return App.head('项目管理', active.length + ' 个项目 · 每个独立成一个文件夹',
        '<button class="btn" data-act="reveal-root">打开输出目录</button>'
        + '<button class="btn btn-primary" data-act="new">＋ 新建项目</button>')
      + '<div class="wrap">'
      + '<div class="pgrid">'
      + active.map(p => this._card(p)).join('')
      + '<div class="pcard pcard-new" data-act="new">'
      +   '<div style="font-size:26px;line-height:1">＋</div>'
      +   '<div style="margin-top:8px;font-size:12.5px">新建项目</div>'
      +   '<div class="text-sm text-muted">空白 / 从模板</div>'
      + '</div>'
      + '</div>'
      + (archived.length ? this._archived(archived) : '')
      + '</div>';
  },

  _card(p) {
    const rate = p.episodeCount ? Math.round((p.doneCount / p.episodeCount) * 100) : 0;
    const cur = p.id === Store.currentProjectId;
    const [label, cls] = Util.projStatus(p.status);
    return '<div class="pcard' + (cur ? ' cur' : '') + '">'
      + '<div class="pcover">' + Util.escapeHtml(p.name) + '</div>'
      + '<div class="pname">' + Util.escapeHtml(p.name)
      + '<span class="pill ' + cls + '">' + label + '</span>'
      + (cur ? '<span class="pill pill-run">当前</span>' : '') + '</div>'
      + '<div class="pmeta">' + Util.escapeHtml(p.dir) + ' · ' + Util.fmtAgo(p.updatedAt) + '</div>'
      + '<div class="pstats">'
      + '<div><b>' + p.episodeCount + '</b>集</div>'
      + '<div><b>' + Util.fmtDuration(p.totalDurationMs) + '</b>总时长</div>'
      + '<div><b>' + rate + '%</b>完成率</div>'
      + '</div>'
      + '<div class="action-row">'
      + '<button class="btn btn-sm ' + (cur ? '' : 'btn-primary') + '" data-act="open" data-id="' + Util.escapeAttr(p.id) + '">'
      + (cur ? '进入' : '打开') + '</button>'
      + '<button class="btn btn-sm" data-act="pset" data-id="' + Util.escapeAttr(p.id) + '">项目设置</button>'
      + '<button class="btn btn-sm btn-ghost" data-act="reveal" data-id="' + Util.escapeAttr(p.id) + '">目录</button>'
      + '<button class="btn btn-sm btn-ghost" data-act="archive" data-id="' + Util.escapeAttr(p.id) + '">归档</button>'
      + '</div></div>';
  },

  _archived(list) {
    return '<div class="card" style="margin-top:16px"><h2>已归档 <span class="n">恢复后重新出现在上面</span></h2>'
      + '<table><tr><th>项目</th><th style="width:70px">集数</th><th style="width:100px">总时长</th>'
      + '<th style="width:120px">最近编辑</th><th style="width:170px"></th></tr>'
      + list.map(p => '<tr><td><b>' + Util.escapeHtml(p.name) + '</b></td>'
          + '<td class="num">' + p.episodeCount + '</td>'
          + '<td class="num">' + Util.fmtDuration(p.totalDurationMs) + '</td>'
          + '<td class="num">' + Util.fmtAgo(p.updatedAt) + '</td>'
          + '<td><button class="btn btn-sm" data-act="restore" data-id="' + Util.escapeAttr(p.id) + '">恢复</button> '
          + '<button class="btn btn-sm btn-danger" data-act="delete" data-id="' + Util.escapeAttr(p.id) + '">删除</button></td></tr>').join('')
      + '</table></div>';
  },

  async mount(el) {
    el.querySelector('[data-act="reveal-root"]')?.addEventListener('click', () => {
      window.electronAPI?.path.reveal(Store.settings.output.root);
    });

    el.querySelectorAll('[data-act="new"]').forEach(b =>
      b.addEventListener('click', () => this._newProject()));

    el.querySelectorAll('[data-act="open"]').forEach(b =>
      b.addEventListener('click', async () => {
        const r = await Store.openProject(b.dataset.id);
        if (r && r.ok) { Toast.success('已打开：' + r.project.name); await App.go('episodes'); }
        else Toast.error(r && r.message || '打开失败', true);
      }));

    el.querySelectorAll('[data-act="pset"]').forEach(b =>
      b.addEventListener('click', async () => {
        if (Store.currentProjectId !== b.dataset.id) await Store.openProject(b.dataset.id);
        await App.go('project-settings');
      }));

    el.querySelectorAll('[data-act="reveal"]').forEach(b =>
      b.addEventListener('click', () => window.electronAPI?.projects.reveal(b.dataset.id)));

    el.querySelectorAll('[data-act="archive"]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const ok = await Modal.confirm({
          title: '归档项目', okText: '归档',
          message: '归档后项目不会出现在主列表，<b>文件不会被删除</b>，随时可以恢复。<br><br>项目：<b>' + Util.escapeHtml(id) + '</b>'
        });
        if (!ok) return;
        await window.electronAPI.projects.setStatus(id, 'archived');
        await Store.reloadProjects();
        if (Store.currentProjectId === id) { Store.currentProjectId = null; Store.currentProject = null; }
        await App.go('projects');
        Toast.success('已归档：' + id);
      }));

    el.querySelectorAll('[data-act="restore"]').forEach(b =>
      b.addEventListener('click', async () => {
        await window.electronAPI.projects.setStatus(b.dataset.id, 'active');
        await Store.reloadProjects(); await App.go('projects');
        Toast.success('已恢复');
      }));

    el.querySelectorAll('[data-act="delete"]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        const ok = await Modal.confirm({
          title: '删除项目', okText: '移到回收站', danger: true,
          message: '项目文件夹会被移到 <code>&lt;输出目录&gt;\\.trash\\</code>，<b>不是直接抹掉</b>，误删可以手动拿回来。<br><br>项目：<b>' + Util.escapeHtml(id) + '</b>'
        });
        if (!ok) return;
        const r = await window.electronAPI.projects.remove(id, true);
        await Store.reloadProjects(); await App.go('projects');
        if (r && r.ok) Toast.success('已移到回收站'); else Toast.error(r && r.message || '删除失败', true);
      }));
  },

  async _newProject() {
    const overlay = Modal.open({
      title: '新建项目',
      width: 480,
      body:
        '<div class="form-group"><label class="form-label">项目名称</label>'
        + '<input type="text" id="np-name" placeholder="例如：纪录片旁白"></div>'
        + '<div class="form-group mt-12"><label class="form-label">简介（可选）</label>'
        + '<input type="text" id="np-desc" placeholder="给自己看的备注"></div>'
        + '<div class="form-group mt-12"><label class="form-label">项目类型</label>'
        + '<select id="np-type"><option value="series">剧集（多集 + 季划分）</option>'
        + '<option value="single">单集 / 单片</option><option value="audiobook">有声书（章节）</option></select></div>'
        + '<p class="text-sm text-muted mt-12">将创建在 <code>'
        + Util.escapeHtml(Store.settings.output.root) + '\\&lt;项目名&gt;\\</code></p>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
            + '<button class="btn btn-primary" data-act="ok">创建</button>'
    });

    const doCreate = async () => {
      const name = overlay.querySelector('#np-name').value.trim();
      if (!name) { Toast.error('请输入项目名称', true); return; }
      const r = await Store.createProject({
        name,
        desc: overlay.querySelector('#np-desc').value.trim(),
        type: overlay.querySelector('#np-type').value
      });
      if (!r.ok) { Toast.error(r.message, true); return; }
      Modal.close();
      await Store.openProject(r.project.id);
      Toast.success('已创建：' + r.project.name);
      await App.go('project-settings');
    };
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => Modal.close());
    overlay.querySelector('[data-act="ok"]').addEventListener('click', doCreate);
    overlay.querySelector('#np-name').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
  }
};
