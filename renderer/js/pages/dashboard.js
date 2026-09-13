/* ══════════════════════════════════════════
   仪表板 —— 所有项目与集的数据总览
   ══════════════════════════════════════════ */

const DashPage = {
  render() {
    const projects = Store.projects;
    const all = projects.reduce((acc, p) => {
      return {
        count: acc.count + 1,
        episodes: acc.episodes + p.episodeCount,
        done: acc.done + p.doneCount,
        chars: acc.chars + p.totalChars,
        lines: acc.lines + p.totalLines,
        durationMs: acc.durationMs + p.totalDurationMs
      };
    }, { count: 0, episodes: 0, done: 0, chars: 0, lines: 0, durationMs: 0 });

    const rate = all.episodes ? Math.round((all.done / all.episodes) * 100) : 0;

    return App.head('仪表板', '所有项目与集的数据总览',
        '<button class="btn" data-act="refresh">刷新</button>')
      + '<div class="wrap">'
      + this._kpis(all, rate)
      + this._alerts()
      + this._projectChart(projects)
      + this._recent(projects)
      + '</div>';
  },

  _kpis(all, rate) {
    const cell = (label, value, sub, up) =>
      '<div class="kpi"><div class="lb">' + label + '</div><div class="vl">' + value + '</div>'
      + '<div class="sub' + (up ? ' up' : '') + '">' + sub + '</div></div>';
    const active = Store.projects.filter(p => p.status === 'active').length;
    return '<div class="kpis">'
      + cell('项目数', all.count, active + ' 进行中 · ' + (all.count - active) + ' 已归档')
      + cell('总集数', Util.fmtNum(all.episodes), '已完成 ' + all.done)
      + cell('总时长', Util.fmtDuration(all.durationMs), all.durationMs ? '已生成部分' : '暂无')
      + cell('总字数', Util.fmtNum(all.chars), all.lines ? '平均 ' + (all.chars / all.lines).toFixed(1) + ' 字/句' : '—')
      + cell('总句数', Util.fmtNum(all.lines), '—')
      + cell('完成率', rate + '%', rate >= 80 ? '进展良好' : '仍有待推进', rate >= 80)
      + '</div>';
  },

  _alerts() {
    const items = [];
    // 有失败句的集
    for (const p of Store.projects) {
      if (p.id !== Store.currentProjectId) continue;
    }
    const failed = Store.episodes.filter(e => e.failureCount > 0);
    for (const e of failed.slice(0, 2)) {
      items.push({ type: 'err', tag: '失败',
        text: '《' + Store.currentProject.name + '》第 ' + e.no + ' 集 有 <b>' + e.failureCount + ' 句生成失败</b>',
        act: 'dub', actText: '去重试', no: e.no });
    }
    // 长期未更新的集
    const stale = Store.episodes.filter(e => {
      const t = Date.parse(e.updatedAt || '');
      return Number.isFinite(t) && (Date.now() - t) > 10 * 86400e3
        && e.status !== 'done' && e.status !== 'delivered';
    });
    if (stale.length) {
      items.push({ type: 'warn', tag: '停滞',
        text: '有 <b>' + stale.length + ' 集</b>超过 10 天未更新',
        act: 'episodes', actText: '去看看' });
    }
    // 未处理文本
    const drafts = Store.episodes.filter(e => e.status === 'draft' && e.chars === 0);
    if (drafts.length) {
      items.push({ type: 'warn', tag: '待处理',
        text: '有 <b>' + drafts.length + ' 集</b>还没有文本内容',
        act: 'episodes', actText: '批量处理' });
    }
    if (!items.length) {
      return '<div class="card"><h2>异常提醒</h2>'
        + '<p class="text-sm text-muted" style="margin:0">暂无需要处理的问题。</p></div>';
    }
    return '<div class="card"><h2>异常提醒 <span class="n">需要你处理的</span></h2>'
      + '<div class="alerts">' + items.map(i =>
          '<div class="alert ' + (i.type === 'err' ? 'alert-err' : 'alert-warn') + '">'
          + '<span class="pill ' + (i.type === 'err' ? 'pill-err' : 'pill-warn') + '">' + i.tag + '</span>'
          + '<span style="flex:1">' + i.text + '</span>'
          + '<button class="btn btn-sm" data-act="' + i.act + '"'
          + (i.no ? ' data-no="' + i.no + '"' : '') + '>' + i.actText + '</button>'
          + '</div>').join('') + '</div></div>';
  },

  _projectChart(projects) {
    if (!projects.length) {
      return '<div class="card"><h2>各项目进度</h2>'
        + '<p class="text-sm text-muted" style="margin:0">还没有项目。去「项目管理」新建一个。</p></div>';
    }
    const max = Math.max(10, ...projects.map(p => p.episodeCount));
    // 用 CSS 柱状图而不是固定 viewBox 的 SVG —— 后者在宽屏下会被拉伸留白
    const cols = projects.map(p => {
      const totalH = Math.max(2, (p.episodeCount / max) * 100);
      const doneH = p.episodeCount ? (p.doneCount / p.episodeCount) * totalH : 0;
      const full = p.episodeCount > 0 && p.doneCount === p.episodeCount;
      const color = p.status === 'archived' ? 'var(--text-mute)' : (full ? 'var(--ok)' : 'var(--accent)');
      return '<div class="bc-col" title="' + Util.escapeAttr(p.name + '：' + p.doneCount + '/' + p.episodeCount + ' 集') + '">'
        + '<div class="bc-bar"><i class="bc-total" style="height:' + totalH + '%"></i>'
        + '<i class="bc-done" style="height:' + doneH + '%;background:' + color + '"></i></div>'
        + '<div class="bc-name">' + Util.escapeHtml(p.name) + '</div>'
        + '<div class="bc-sub">' + p.doneCount + '/' + p.episodeCount + ' 集</div>'
        + '</div>';
    }).join('');

    return '<div class="card"><h2>各项目进度 <span class="n">单位：集 · 上限 ' + max + '</span></h2>'
      + '<div class="barchart">'
      + '<div class="bc-axis"><span>' + max + '</span><span>' + Math.round(max / 2) + '</span><span>0</span></div>'
      + '<div class="bc-plot">' + cols + '</div>'
      + '</div>'
      + '<div class="legend"><span><i style="background:var(--accent)"></i>进行中</span>'
      + '<span><i style="background:var(--ok)"></i>已完成</span>'
      + '<span><i style="background:var(--bg-elev);border:1px solid var(--border)"></i>总数</span></div></div>';
  },

  _recent(projects) {
    const rows = [];
    for (const p of projects) {
      if (!p.updatedAt) continue;
      rows.push('<div class="recent">'
        + '<span class="pill ' + (p.status === 'active' ? 'pill-run' : '') + '">' + Util.escapeHtml(p.name) + '</span>'
        + '<div style="flex:1"><b style="font-size:12.5px">' + p.doneCount + ' / ' + p.episodeCount + ' 集完成</b>'
        + '<div class="text-sm text-muted">' + Util.escapeHtml(p.desc || p.dir) + ' · ' + Util.fmtAgo(p.updatedAt) + '</div></div>'
        + '<button class="btn btn-sm" data-act="open-project" data-id="' + Util.escapeAttr(p.id) + '">打开</button>'
        + '</div>');
      if (rows.length >= 4) break;
    }
    return '<div class="card" style="margin-bottom:0"><h2>最近项目</h2>'
      + (rows.length ? rows.join('') : '<p class="text-sm text-muted" style="margin:0">还没有项目</p>')
      + '</div>';
  },

  async mount(el) {
    el.querySelector('[data-act="refresh"]')?.addEventListener('click', async () => {
      await Store.reloadProjects();
      if (Store.currentProjectId) { await Store.reloadEpisodes(); }
      await App.go('dash');
      Toast.success('已刷新');
    });
    el.querySelectorAll('[data-act="open-project"]').forEach(b =>
      b.addEventListener('click', async () => {
        await Store.openProject(b.dataset.id);
        await App.go('episodes');
      }));
    el.querySelectorAll('[data-act="episodes"], [data-act="dub"]').forEach(b =>
      b.addEventListener('click', () => App.go(b.dataset.act === 'dub' ? 'dub' : 'episodes')));
  }
};
