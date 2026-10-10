/* ══════════════════════════════════════════
   角色管理 —— 角色 ↔ 音色的总台账

   为什么需要这一页：
   角色一多，"哪个角色用的哪个音色"就记不住了；而音色只写在台词的角色上，
   散在各集里，没有一个地方能一眼看全。这一页只做两件事：
     ① 台账：每个角色当前绑的是哪个音色（还能看到这份音频实际用过哪些音色）
     ② 分布：每个角色在多少集里出现过 —— 用横向条形图，不逐集罗列
   放在「集管理」同级，属于项目级信息。
   ══════════════════════════════════════════ */

const RolesPage = {
  _stat: null,
  _loading: false,
  _err: '',
  _focusEp: null,
  _tried: false,      // 是否已尝试统计（防止 mount 里反复重画）

  render() {
    const p = Store.currentProject;
    if (!p) {
      return App.head('角色管理', '角色与音色的总台账')
        + '<div class="wrap"><div class="card"><h2>还没有打开项目</h2>'
        + '<p class="text-sm text-muted">角色是项目级的，先选一个项目。</p>'
        + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="goto-projects">去项目管理</button></div>'
        + '</div></div>';
    }
    if (this._loading && !this._stat) {
      return App.head('角色管理', '正在统计…')
        + '<div class="wrap"><div class="card"><p class="text-sm text-muted" style="margin:0">正在读取各集台词…</p></div></div>';
    }

    const st = this._stat || { rows: [], episodes: [] };
    const rows = st.rows || [];
    const maxEps = Math.max(1, ...rows.map(r => (r.episodes || []).length));

    const head = App.head('角色管理', '这个项目里有哪些角色、各自绑的什么音色',
      '<button class="btn" data-act="reload-roles">重新统计</button>'
      + '<button class="btn btn-primary" data-act="add-role">＋ 新建角色</button>');

    /* ── ① 台账：角色 / 绑定音色 / 句数 / 用过的音色 ──
       这里只做统计，不做"该不该重新生成"的提醒 —— 提醒交给配音页。 */
    const ledger = '<div class="card"><h2>角色台账 <span class="n">'
      + rows.length + ' 个角色</span></h2>'
      + (rows.length
        ? '<table class="role-ledger"><tr>'
          + '<th style="width:170px">角色</th><th style="width:190px">绑定音色</th>'
          + '<th style="width:80px">句数</th><th>用过的音色</th>'
          + '<th style="width:200px"></th></tr>'
          + rows.map(r => {
              const usedList = Object.keys(r.used || {});
              /* 名字 + 描述统一装进 .role-cell：它高度固定，
                 这样有没有描述都不会改变行高，操作按钮才能跟别的行对齐 */
              return '<tr><td><div class="role-cell">'
                + '<b>' + Util.escapeHtml(r.name) + '</b>'
                + (r.desc
                    ? '<span class="text-sm text-muted role-desc" title="' + Util.escapeAttr(r.desc) + '">'
                      + Util.escapeHtml(r.desc) + '</span>'
                    : '')
                + '</div></td>'
                + '<td>' + (r.voice
                    ? '<span class="pill pill-ok">' + Util.escapeHtml(r.voice) + '</span>'
                    : '<span class="pill">未绑定</span>') + '</td>'
                + '<td class="num">' + r.lines + '</td>'
                + '<td><div class="used-pills">' + (usedList.length
                    ? usedList.map(v => '<span class="pill' + (v === r.voice ? ' pill-ok' : '') + '">'
                        + Util.escapeHtml(v) + (r.used[v] > 1 ? ' ×' + r.used[v] : '') + '</span>').join('')
                    : '<span class="text-sm text-muted">还没生成</span>') + '</div></td>'
                + '<td><div class="row-acts">'
                + '<button class="btn btn-sm" data-act="bind-role" data-role="' + Util.escapeAttr(r.name) + '">换音色</button>'
                + '<button class="btn btn-sm btn-ghost btn-danger" data-act="del-role" data-role="' + Util.escapeAttr(r.name) + '"'
                + ' title="只从项目角色表里移除，不会删除已有音频">移除</button>'
                + '</div></td></tr>';
            }).join('') + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有角色。角色可以在「项目设置」或这里新建，'
          + '配音页里选角色时会自动带出对应的音色。</p>')
      + '</div>';

    /* ── ② 集数分布：横向条形图，只表达"出现在多少集"，不逐集罗列 ── */
    const nameW = Math.min(120, Math.max(72, ...rows.map(r => String(r.name).length * 14 + 12)));
    const dist = '<div class="card"><h2>集数分布 <span class="n">每个角色在本项目里出现过多少集</span></h2>'
      + (rows.length
        ? '<div class="hbars">' + rows.map(row => {
            const n = (row.episodes || []).length;
            const pct = Math.round((n / maxEps) * 100);
            const epsText = n ? (row.episodes || []).map(x => '第' + String(x).padStart(p.padWidth || 2, '0') + '集').join('、') : '还没出现过';
            return '<div class="hbar" title="' + Util.escapeAttr(row.name + '：' + epsText) + '">'
              + '<span class="nm" style="width:' + nameW + 'px">' + Util.escapeHtml(row.name) + '</span>'
              + '<span class="tr"><i style="width:' + pct + '%"></i></span>'
              + '<span class="vv">' + (n ? n + ' 集' : '未出现') + '</span></div>';
          }).join('') + '</div>'
        : '<p class="text-sm text-muted" style="margin:0">还没有角色。</p>')
      + '<p class="text-sm text-muted" style="margin:16px 0 0">'
      + '条子越长代表这个角色跨的集越多；把鼠标停在某一行可以看到具体是哪些集。</p></div>';

    return head + '<div class="wrap">'
      + ledger + dist
      + (this._err ? '<div class="card"><p class="text-sm" style="color:var(--danger);margin:0">' + Util.escapeHtml(this._err) + '</p></div>' : '')
      + '</div>';
  },

  /** 读各集台词，汇总角色 × 音色 × 集数 */
  async load(force) {
    if (this._stat && !force) return this._stat;
    if (this._loading) return this._stat;
    const p = Store.currentProject;
    if (!p) return null;
    this._loading = true;
    this._err = '';
    try {
      const roles = p.roles || [];
      const eps = (Store.episodes || []).slice().sort((a, b) => a.no - b.no);
      const rowsMap = {};
      const episodes = [];

      /* "音色设计"要归一化：没绑定音色时用 tts 直接合成，
         want 为空、used 是 '(音色设计)' 属于同一种情况。
         口径必须和配音页的 DubPage._isStale 一致，否则同一句两处判定不同。 */
      const norm = (v) => {
        const s = String(v === null || v === undefined ? '' : v).trim();
        return (s === '(音色设计)' || s === '音色设计') ? '' : s;
      };

      for (const e of eps) {
        let lines = [];
        try {
          const r = await window.electronAPI.episodes.read(Store.currentProjectId, e.no);
          lines = (r && (r.lines || (r.episode && r.episode.lines))) || [];
        } catch (err) { /* 这一集读不到就跳过 */ }
        if (!lines.length) continue;

        const byRole = {};
        let epStale = 0;
        for (const l of lines) {
          const name = l.role || '旁白';
          const def = roles.find(x => x.name === name);
          const want = norm((l.voiceOverride && l.voice) ? l.voice : ((def && def.voice) || p.fallbackVoice || ''));
          const used = norm(l.voiceUsed || (l.audio ? (l.voice || '') : ''));
          const isStale = !!l.audio && want !== used;

          if (!byRole[name]) byRole[name] = { voice: (def && def.voice) || '', lines: 0, used: {} };
          byRole[name].lines++;
          if (l.audio && used) byRole[name].used[used] = (byRole[name].used[used] || 0) + 1;
          if (isStale) epStale++;

          if (!rowsMap[name]) {
            rowsMap[name] = { name, desc: (def && def.desc) || '', voice: (def && def.voice) || '', lines: 0, stale: 0, episodes: [], used: {} };
          }
          rowsMap[name].lines++;
          if (isStale) rowsMap[name].stale++;
          if (l.audio && used) rowsMap[name].used[used] = (rowsMap[name].used[used] || 0) + 1;
          if (!rowsMap[name].episodes.includes(e.no)) rowsMap[name].episodes.push(e.no);
        }
        episodes.push({ no: e.no, title: e.title || '', lines: lines.length, stale: epStale, byRole });
      }

      /* 台账也要带上"定义了但还没在任何一集出现"的角色 */
      for (const r of roles) {
        if (!rowsMap[r.name]) {
          rowsMap[r.name] = { name: r.name, desc: r.desc || '', voice: r.voice || '', lines: 0, stale: 0, episodes: [], used: {} };
        }
      }

      this._stat = {
        rows: Object.keys(rowsMap).map(k => rowsMap[k])
          .sort((a, b) => (b.episodes || []).length - (a.episodes || []).length || b.lines - a.lines || a.name.localeCompare(b.name)),
        episodes
      };
    } catch (e) {
      this._err = '统计失败：' + (e.message || e);
      this._stat = { rows: [], episodes: [] };
    }
    this._loading = false;
    return this._stat;
  },

  async mount(el) {
    const p = Store.currentProject;
    /* 只在"确实还没统计过"时重画一次。
       以前只用 !this._stat 判断，统计失败时 _stat 仍是空值，
       每次 mount 都再 App.go → 无限重画，界面直接卡死。 */
    if (p && !this._stat && !this._tried) {
      this._tried = true;
      await this.load(true);
      return App.go('roles');
    }
    if (!p || this._stat) this._tried = false;

    el.querySelector('[data-act="reload-roles"]')?.addEventListener('click', async () => {
      this._stat = null;
      await this.load(true);
      App.go('roles');
    });
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));

    el.querySelectorAll('[data-act="bind-role"]').forEach(b =>
      b.addEventListener('click', () => this._bindRole(b.dataset.role)));

    el.querySelectorAll('[data-act="del-role"]').forEach(b =>
      b.addEventListener('click', async () => {
        const name = b.dataset.role;
        const ok = await Modal.confirm({
          title: '移除角色', okText: '移除', danger: true,
          message: '把「' + Util.escapeHtml(name) + '」从项目角色表里移除吗？<br>'
            + '已有音频与台词不受影响；之后这些台词会被当作"未绑定角色"。'
        });
        if (!ok) return;
        const roles = (Store.currentProject.roles || []).filter(r => r.name !== name);
        const r = await Store.saveProject({ roles });
        if (r && r.ok) { Toast.success('已移除角色：' + name); this._stat = null; await this.load(true); App.go('roles'); }
        else Toast.error((r && r.message) || '保存失败', true);
      }));

    el.querySelector('[data-act="add-role"]')?.addEventListener('click', () => this._newRole());
  },

  async _newRole() {
    const rs = await API.getPresets().catch(() => []);
    Modal.open({
      title: '新建角色', width: 460,
      body: '<div class="form-group"><label class="form-label">角色名</label>'
        + '<input type="text" id="nr-name" maxlength="20" placeholder="例如：林寻"></div>'
        + '<div class="form-group mt-12"><label class="form-label">描述（可留空）</label>'
        + '<input type="text" id="nr-desc" maxlength="60" placeholder="例如：主角，少年音"></div>'
        + '<div class="form-group mt-12"><label class="form-label">绑定音色</label>'
        + '<div class="model-chips" id="nr-voices">'
        + (rs.length
            ? rs.map((r, i) => '<button type="button" class="mchip' + (i === 0 ? ' on' : '') + '" data-voice="'
                + Util.escapeAttr(r.name) + '">' + Util.escapeHtml(r.name) + '</button>').join('')
            : '<span class="text-sm text-muted">音色库是空的，先不绑也行</span>')
        + '</div></div>',
      footer: '<button class="btn" data-act="cancel">取消</button>'
        + '<button class="btn btn-primary" data-act="save-role">保存</button>',
      onMount: (host) => {
        host.querySelectorAll('#nr-voices .mchip').forEach(c =>
          c.addEventListener('click', () => {
            host.querySelectorAll('#nr-voices .mchip').forEach(x => x.classList.remove('on'));
            c.classList.add('on');
          }));
        host.querySelector('[data-act="cancel"]')?.addEventListener('click', () => Modal.close());
        host.querySelector('[data-act="save-role"]')?.addEventListener('click', async () => {
          const name = (host.querySelector('#nr-name').value || '').trim();
          const desc = (host.querySelector('#nr-desc').value || '').trim();
          const pick = host.querySelector('#nr-voices .mchip.on');
          const voice = pick ? pick.dataset.voice : '';
          if (!name) { Toast.error('角色名不能为空', true); return; }
          const roles = [...(Store.currentProject.roles || [])];
          if (roles.some(r => r.name === name)) { Toast.error('已经有同名角色了', true); return; }
          roles.push({ name, voice, desc, cfg: null });
          const r = await Store.saveProject({ roles });
          if (r && r.ok) {
            Modal.close();
            Toast.success('已新建角色：' + name + (voice ? '（音色 ' + voice + '）' : '（未绑定音色）'));
            this._stat = null; await this.load(true); App.go('roles');
          } else Toast.error((r && r.message) || '保存失败', true);
        });
      }
    });
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
      footer: '<button class="btn" data-act="cancel">取消</button>',
      onMount: (host) => host.querySelector('[data-act="cancel"]')?.addEventListener('click', () => Modal.close())
    });
    document.querySelectorAll('[data-voice]').forEach(it =>
      it.addEventListener('click', async () => {
        const roles = [...(Store.currentProject.roles || [])];
        const i = roles.findIndex(r => r.name === roleName);
        const newVoice = it.dataset.voice;
        if (i >= 0) roles[i] = { ...roles[i], voice: newVoice };
        else roles.push({ name: roleName, voice: newVoice, desc: '', cfg: null });
        Modal.close();
        const r = await Store.saveProject({ roles });
        if (r && r.ok) {
          Toast.success('「' + roleName + '」已绑定：' + newVoice + '（到配音页点「生成全部」用新音色重生成）');
          this._stat = null; await this.load(true); App.go('roles');
        } else Toast.error((r && r.message) || '保存失败', true);
      }));
  }
};
