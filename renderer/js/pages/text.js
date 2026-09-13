/* ══════════════════════════════════════════
   文本处理 —— 原文 → 可直接配音的台词
   ══════════════════════════════════════════ */

const TextPage = {
  _draft: null,      // { original, processed, background, lines }
  _draftKey: null,   // 这份草稿属于哪一集 —— 换集必须作废，否则会串文本

  _keyOf() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return null;
    return p.id + ':' + ep.episode.no;
  },

  /** 保证 _draft 一定是当前集的；换集就重新从磁盘读 */
  _ensureDraft() {
    const key = this._keyOf();
    if (this._draftKey !== key) { this._draftKey = key; this._draft = null; }
    if (this._draft) return this._draft;
    const ep = Store.currentEpisode;
    if (!ep) return null;
    this._draft = {
      original: ep.scriptOriginal || '',
      processed: ep.script || '',
      background: ep.episode.background || '',
      lines: (ep.lines || []).map(l => ({ ...l }))
    };
    return this._draft;
  },

  render() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return this._empty();

    const d = this._ensureDraft();
    const chars = (d.processed || '').length;
    const roles = [...new Set(d.lines.map(l => l.role).filter(Boolean))];

    return App.head('文本处理', '把原始文本变成可以直接配音的台词',
        '<span class="pill">' + Util.fmtNum(chars) + ' 字 · ' + d.lines.length + ' 句'
        + (roles.length ? ' · ' + roles.length + ' 个角色' : '') + '</span>')
      + '<div class="wrap">'

      + '<div class="card"><h2>导入 <span class="n">粘贴后点「作为原文」</span></h2>'
      + '<div class="drops">'
      + this._drop('粘贴文本', 'Ctrl+V 后用下面的按钮', 'paste')
      + this._drop('txt 文件', '点击选择', 'txt')
      + this._drop('SRT / VTT', '保留时间轴', 'srt')
      + '</div>'
      + '<textarea id="tx-import" rows="3" placeholder="也可以直接在这里粘贴原始文本，然后点右侧「作为原文」" style="margin-top:11px"></textarea>'
      + '<div class="action-row mt-8">'
      + '<button class="btn btn-sm" data-act="use-import">作为原文</button>'
      + '<button class="btn btn-sm btn-ghost" data-act="clear-all">清空</button>'
      + '</div>'
      + '<p class="text-sm text-muted mt-8" style="margin-bottom:0">两段式：<code>【背景介绍（仅供判断，不配音）】</code> 写地点时间环境、设定伏笔、人物关系与谁对谁说话；'
      + '<code>【角色（情绪）+台词（用于配音）】</code> 逐行写 <code>角色（情绪）+台词</code>。'
      + '只有明确说出口的台词会配音，旁白/动作/心理描写归入背景介绍。</p>'
      + '</div>'

      + '<div class="card"><h2>对照 <span class="n">原文永不改动，处理结果只写右栏</span></h2>'
      + '<div class="duo">'
      + '<div class="pane"><div class="ph"><span>原文</span><span style="font-weight:400">只读</span></div>'
      + '<textarea id="tx-orig" class="pane-text" spellcheck="false" readonly '
      + 'title="原文只读，保证可回溯。要改内容请用「恢复为原文」后重新导入" '
      + 'placeholder="（还没有原文）">'
      + Util.escapeHtml(d.original) + '</textarea></div>'
      + '<div class="pane"><div class="ph"><span>处理后 · 直接送 TTS</span>'
      + '<span style="font-weight:400;color:var(--ok)">✓ 可编辑</span></div>'
      + '<textarea id="tx-proc" class="pane-text" spellcheck="false" placeholder="（还没有处理结果）">'
      + Util.escapeHtml(d.processed) + '</textarea></div>'
      + '</div></div>'

      + (d.background
        ? '<div class="card"><h2>背景介绍 <span class="n">仅供判断，不参与配音</span></h2>'
          + '<div class="bg-line"><span class="pill pill-p">总结</span>'
          + '<span class="bg-text">' + Util.nl2br(Util.escapeHtml(d.background)) + '</span>'
          + '<button class="btn btn-sm btn-ghost" data-act="edit-bg">改</button></div></div>'
        : '')

      + '<div class="card"><h2>处理 <span class="n" id="tx-ai-state">'
      + (Store.hasKey() ? 'AI 已配置' : 'AI 未配置 —— 本地规则仍可用') + '</span></h2>'
      + '<div class="actgrp actgrp-ai">'
      + '<span class="actgrp-tag"><i class="dot-ai"></i>AI 处理 · 需要 Key · 慢但懂语义</span>'
      + '<div class="action-row">'
      + '<button class="btn btn-ai" data-act="script">✦ 整理成剧本</button>'
      + '<span class="text-sm text-muted">← 一键完成：背景介绍 + 角色 + 情绪 + 断句</span>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-ai" data-act="ai-proc">✦ AI 处理…（分步）</button>'
      + '</div></div>'
      + '<div class="actgrp actgrp-local">'
      + '<span class="actgrp-tag"><i class="dot-local"></i>本地处理 · 不联网 · 瞬间完成</span>'
      + '<div class="action-row">'
      + '<button class="btn btn-local" data-act="tn">本地规范化</button>'
      + '<button class="btn btn-local" data-act="split">按角色 / 标点分句</button>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-ghost" data-act="reset-proc">恢复为原文</button>'
      + '</div></div>'
      + '<p class="text-sm text-muted mt-12" style="margin-bottom:0">'
      + '<b>只想要剧本，点「✦ 整理成剧本」一个按钮就够了</b>；'
      + '「AI 处理…」用于只要其中某一环（如只规范化、只标语气、只要台词 JSON）。</p></div>'

      + '<div class="card"><h2>分句 <span class="n">' + d.lines.length + ' 句'
      + (roles.length ? ' · ' + roles.map(r => Util.escapeHtml(r)).join(' / ') : '')
      + (d.lines.length ? ' · 情绪：明确 ' + this._emoStats(d.lines).explicit
          + ' / 推断 ' + this._emoStats(d.lines).inferred
          + ' / 未标明 ' + this._emoStats(d.lines).neutral : '') + '</span></h2>'
      + (d.lines.length
        ? '<table><tr><th style="width:36px">#</th><th style="width:88px">角色</th><th style="width:92px">情绪 / 动作</th><th>台词</th>'
          + '<th style="width:56px">字数</th><th style="width:104px">音色</th><th style="width:56px">状态</th></tr>'
          + d.lines.map((l, i) => this._lineRow(l, i)).join('') + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有分句。先填原文，再点「按角色 / 标点分句」。</p>')
      + '</div>'

      + '<div class="action-row" style="justify-content:flex-end">'
      + '<button class="btn" data-act="save">保存</button>'
      + '<button class="btn btn-primary btn-lg" data-act="save-go">保存并前往配音 →</button>'
      + '</div></div>';
  },

  _empty() {
    return App.head('文本处理', '')
      + '<div class="wrap"><div class="card"><h2>还没有打开某一集</h2>'
      + '<p class="text-sm text-muted">先选一个项目、再打开一集。</p>'
      + '<div class="action-row mt-12"><button class="btn" data-act="goto-projects">去项目管理</button>'
      + '<button class="btn btn-primary" data-act="goto-eps">去集管理</button></div></div></div>';
  },

  _drop(title, sub, act) {
    return '<div class="drop" data-act="import-' + act + '"><b>' + title + '</b><span>' + sub + '</span></div>';
  },

  /** 情绪来源分级：explicit 原文明确 / inferred 推断 / neutral 未标明 / none 空 */
  _emoKind(label) {
    const s = String(label || '').trim();
    if (!s) return 'none';
    if (/^推断\s*[：:]/.test(s)) return 'inferred';
    if (/^(未标明|中性|无|未知|不详)$/.test(s)) return 'neutral';
    return 'explicit';
  },

  _emoCell(l) {
    const kind = l.emotionKind || this._emoKind(l.emotion);
    const txt = l.emotion || '未标明';
    if (kind === 'inferred') {
      return '<span class="emo-tag emo-infer" title="由上下文推断，仅作配音参考，不强制">'
        + Util.escapeHtml(txt) + '</span>';
    }
    if (kind === 'neutral' || kind === 'none') {
      return '<span class="emo-tag emo-none" title="原文未提供情绪，TTS 按中性平和处理">'
        + Util.escapeHtml(txt) + '</span>';
    }
    return '<span class="emo-tag" title="原文明确标注">' + Util.escapeHtml(txt) + '</span>';
  },

  _emoStats(lines) {
    const c = { explicit: 0, inferred: 0, neutral: 0 };
    for (const l of lines) {
      const k = l.emotionKind || this._emoKind(l.emotion);
      if (k === 'inferred') c.inferred++;
      else if (k === 'neutral' || k === 'none') c.neutral++;
      else c.explicit++;
    }
    return c;
  },

  _lineRow(l, i) {
    const st = l.audio ? '<span class="pill pill-ok">✓</span>' : '<span class="text-muted">·</span>';
    return '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td><span class="pill">' + Util.escapeHtml(l.role || '旁白') + '</span></td>'
      + '<td>' + this._emoCell(l) + '</td>'
      + '<td class="tx">' + Util.escapeHtml(l.text || '') + '</td>'
      + '<td class="num">' + (l.text || '').length + '</td>'
      + '<td class="text-sm text-muted">' + Util.escapeHtml(l.voice || '—') + '</td>'
      + '<td>' + st + '</td></tr>';
  },

  _applyParsed(parsed) {
    const p = Store.currentProject || {};
    const voiceFor = (role) => {
      const hit = (p.roles || []).find(r => r.name === role);
      return (hit && hit.voice) || p.fallbackVoice || '';
    };
    this._draft.background = parsed.background || '';
    this._draft.lines = parsed.lines.map(l => ({
      text: l.text, role: l.role || '旁白',
      emotion: l.emotion || '中性', emotionKind: this._emoKind(l.emotion || '中性'),
      voice: voiceFor(l.role || '旁白'), audio: '', error: ''
    }));
    // 按规范的两段式回写，方便人工核对
    this._draft.processed =
      (parsed.background ? '【背景介绍（仅供判断，不配音）】\n' + parsed.background + '\n\n' : '')
      + '【角色（情绪）+台词（用于配音）】\n'
      + parsed.lines.map(l => (l.role || '旁白')
          + (l.emotion ? '（' + l.emotion + '）' : '') + '+' + l.text).join('\n');
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    el.querySelector('[data-act="goto-eps"]')?.addEventListener('click', () => App.go('episodes'));
    if (!Store.currentProject || !Store.currentEpisode) return;
    this._ensureDraft();

    const orig = el.querySelector('#tx-orig');
    const proc = el.querySelector('#tx-proc');
    // 原文只读：不再监听 input，改由导入/恢复流程写入
    proc?.addEventListener('input', () => { this._draft.processed = proc.value; });

    el.querySelector('[data-act="use-import"]')?.addEventListener('click', () => {
      const t = el.querySelector('#tx-import').value;
      if (!t.trim()) { Toast.error('先粘贴点内容', true); return; }
      this._draft.original = t;
      this._draft.processed = t;
      this._draft.lines = [];
      App.go('text');
      Toast.success('已作为原文');
    });

    el.querySelector('[data-act="import-paste"]')?.addEventListener('click', async () => {
      try {
        const t = await navigator.clipboard.readText();
        if (!t.trim()) { Toast.error('剪贴板是空的', true); return; }
        this._draft.original = t; this._draft.processed = t; this._draft.lines = [];
        App.go('text'); Toast.success('已从剪贴板导入');
      } catch (e) { Toast.error('读剪贴板失败，请手动粘贴', true); }
    });

    el.querySelector('[data-act="clear-all"]')?.addEventListener('click', () => {
      this._draft = { original: '', processed: '', background: '', lines: [] };
      App.go('text');
    });

    el.querySelector('[data-act="reset-proc"]')?.addEventListener('click', () => {
      this._draft.processed = this._draft.original;
      App.go('text');
    });

    el.querySelector('[data-act="tn"]')?.addEventListener('click', () => {
      const src = this._draft.processed || this._draft.original;
      if (!src.trim()) { Toast.error('没有可处理的文本', true); return; }
      const { text, hits } = TextTools.normalize(src);
      this._draft.processed = text;
      App.go('text');
      Toast.success(hits.length ? '本地规范化完成 · ' + hits.length + ' 处' : '没有需要规范化的内容');
    });

    el.querySelector('[data-act="split"]')?.addEventListener('click', () => {
      const src = this._draft.processed || this._draft.original;
      if (!src.trim()) { Toast.error('没有可分句的文本', true); return; }
      const maxLen = (Store.currentProject.defaults || {}).maxLineLen || 25;
      const parsed = TextTools.parseScript(src, maxLen, { strict: false });
      this._applyParsed(parsed);
      App.go('text');
      const roleList = [...new Set(parsed.lines.map(l => l.role))];
      Toast.success('已切成 ' + parsed.lines.length + ' 句 · ' + roleList.length + ' 个角色'
        + (parsed.background ? ' · 含背景' : ''));
    });

    el.querySelector('[data-act="edit-bg"]')?.addEventListener('click', async () => {
      const v = await Modal.prompt({ title: '编辑背景', label: '背景（场景 / 语气 / 用途）', value: this._draft.background || '' });
      if (v === null) return;
      this._draft.background = v;
      App.go('text');
    });

    el.querySelector('[data-act="script"]')?.addEventListener('click', () => this._makeScript());

    el.querySelector('[data-act="ai-proc"]')?.addEventListener('click', () => this._aiPanel());

    const doSave = async (go) => {
      const lines = this._draft.lines;
      const chars = (this._draft.processed || '').length;
      const dur = lines.reduce((a, l) => a + (l.durationMs || 0), 0);
      const payload = {
        scriptOriginal: this._draft.original,
        script: this._draft.processed,
        lines,
        episode: {
          ...Store.currentEpisode.episode,
          background: this._draft.background || '',
          chars,
          lineCount: lines.length,
          doneCount: lines.filter(l => l.audio).length,
          durationMs: dur,
          status: Store.currentEpisode.episode.status === 'draft' && lines.length ? 'text' : Store.currentEpisode.episode.status
        }
      };
      const r = await Store.saveEpisode(payload);
      if (r && r.ok) {
        await Store.openEpisode(Store.currentEpisodeNo);
        this._draft = null;
        Toast.success('已保存到 第' + String(Store.currentEpisodeNo).padStart(Store.currentProject.padWidth || 2, '0') + '集\\');
        if (go) App.go('dub'); else App.go('text');
      } else Toast.error(r && r.message || '保存失败', true);
    };
    el.querySelector('[data-act="save"]')?.addEventListener('click', () => doSave(false));
    el.querySelector('[data-act="save-go"]')?.addEventListener('click', () => doSave(true));
  },

  /** 整理成剧本格式：有 Key 走 AI，没 Key 用本地规则 */
  async _makeScript() {
    const src = this._draft.processed || this._draft.original;
    if (!src.trim()) { Toast.error('没有可整理的文本', true); return; }
    const maxLen = (Store.currentProject.defaults || {}).maxLineLen || 25;

    if (!Store.hasKey()) {
      const parsed = TextTools.parseScript(src, maxLen);
      this._applyParsed(parsed);
      App.go('text');
      Toast.show('已用本地规则整理（未配置 AI）· ' + parsed.lines.length + ' 句');
      return;
    }

    const btn = document.querySelector('[data-act="script"]');
    const restore = btn ? btn.innerHTML : '';
    const t0 = Date.now();
    if (btn) { btn.disabled = true; btn.textContent = '整理中…'; }
    try {
      const proj = Store.currentProject || {};
      const r = await window.electronAPI.ai.process('script', src, {
        maxLen,
        projectPrompt: (proj.ai && proj.ai.prompt) || '',
        dict: proj.dict || []
      });
      if (!r.ok) throw new Error(r.message);
      const parsed = TextTools.parseScript(r.text, maxLen);
      this._applyParsed(parsed);
      App.go('text');
      Toast.success('已整理成剧本 · ' + parsed.lines.length + ' 句 · '
        + [...new Set(parsed.lines.map(l => l.role))].length + ' 个角色 · 用时 '
        + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    } catch (e) {
      Toast.error('整理失败：' + (e.message || e), true);
      if (btn) { btn.disabled = false; btn.innerHTML = restore; }
    }
  },

  _aiPanel() {
    const ai = Store.settings.ai || {};
    const proj = Store.currentProject || {};
    // 默认只勾「整理成剧本」——它已经包含断句与角色识别。
    // 以前的默认是全勾，结果后面的任务把剧本格式冲掉了
    const DEFAULT_TASKS = ['script'];
    // 注意：空数组是 truthy，必须判 length，否则项目没配 features 时一个都不勾
    const saved = (proj.ai && Array.isArray(proj.ai.features)) ? proj.ai.features : [];
    const on = saved.length ? saved : DEFAULT_TASKS;
    const TASKS = [
      ['normalize', '① 文本规范化', '先做：数字 / 日期 / 百分比 / 缩写 → 口语读法（可选）'],
      ['script', '② 整理成剧本', '核心：输出【背景介绍】+【角色（情绪）+台词】，已含断句与角色识别'],
      ['tone', '③ 语气标注', '后做：插入 [laughing] / [sigh] 等 VoxCPM2 标记（可选）'],
      ['split', '断句（单独用）', '只按标点切句，不做角色与背景 —— 整理成剧本已包含'],
      ['roles', '角色分离（单独用）', '只输出角色+台词 JSON，不含背景 —— 整理成剧本已包含']
    ];
    const hasKey = Store.hasKey();

    Modal.open({
      title: '✦ AI 文本处理', width: 620,
      body:
        '<p class="text-sm text-muted" style="margin-bottom:12px">'
        + '服务商：<b>' + Util.escapeHtml(ai.model || '未配置') + '</b> · '
        + (hasKey ? '已配置 API Key' : '<span style="color:var(--danger)">未配置 API Key</span>')
        + (proj.ai && proj.ai.provider ? ' · 项目指定服务商' : ' · 跟随全局')
        + '</p>'
        + '<div class="checks" id="ai-tasks">'
        + TASKS.map(([id, name, desc]) =>
            '<label class="check-row" data-task="' + id + '">'
            + '<span class="cbx' + (on.includes(id) ? ' on' : '') + '"></span>'
            + '<span class="check-txt"><b>' + name + '</b><i>' + Util.escapeHtml(desc) + '</i></span>'
            + '</label>').join('')
        + '</div>'
        + '<div id="ai-run-log" class="text-sm text-muted" style="margin-top:12px;min-height:18px"></div>'
        + '<p class="text-sm text-muted" style="margin:10px 0 0">'
        + (hasKey
            ? '原文不会被改动，结果只写进「处理后」栏。已选任务会按顺序执行。'
            : '请先到「设置 → AI 服务」填写接口地址、模型和 API Key。当前可先用「本地规范化」。')
        + '</p>',
      footer: '<button class="btn" data-act="cancel">关闭</button>'
            + (hasKey ? '' : '<button class="btn btn-primary" data-act="to-settings">去配置</button>')
            + (hasKey ? '<button class="btn btn-ai" data-act="run">开始处理</button>' : '')
    });

    const host = document.getElementById('modal-host');
    host.querySelectorAll('[data-task]').forEach(row =>
      row.addEventListener('click', () => {
        row.querySelector('.cbx').classList.toggle('on');
      }));
    host.querySelector('[data-act="cancel"]')?.addEventListener('click', () => Modal.close());
    host.querySelector('[data-act="to-settings"]')?.addEventListener('click', () => {
      Modal.close(); SettingsPage._sec = 'ai'; App.go('settings');
    });
    host.querySelector('[data-act="run"]')?.addEventListener('click', async (e) => {
      const picked = [...host.querySelectorAll('[data-task]')]
        .filter(r => r.querySelector('.cbx').classList.contains('on'))
        .map(r => r.dataset.task);
      if (!picked.length) { Toast.error('至少选一项', true); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await this._runAI(picked, host);
        Modal.close();
        App.go('text');
      } catch (err) {
        clearInterval(tick);
        Notify.onFail();
        Toast.error('AI 处理失败：' + (err.message || err), true);
      } finally { btn.disabled = false; }
    });
  },

  /** 依次执行选中的 AI 任务，每步都写回 _draft */
  async _runAI(tasks, host) {
    const log = host.querySelector('#ai-run-log');
    const proj = Store.currentProject || {};
    const opts = {
      maxLen: (proj.defaults || {}).maxLineLen || 25,
      projectPrompt: (proj.ai && proj.ai.prompt) || '',
      dict: proj.dict || []
    };
    const t0 = Date.now();
    const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
    let lastMsg = '';
    const say = (t) => { lastMsg = t; if (log) log.textContent = t + '　[' + secs() + ']'; };
    // 单次调用可能跑几十秒，中途没有任何回调；
    // 不加这个定时器的话秒数会一直停在 0.0s，看着像卡死
    const tick = setInterval(() => {
      if (log && lastMsg) log.textContent = lastMsg + '　[' + secs() + ']';
    }, 200);

    const tokenTotal = { prompt_tokens: 0, completion_tokens: 0 };

    // 固定管线顺序：规范化 → 整理成剧本 → 语气标注 →（单独用的断句/角色）
    const RANK = { normalize: 0, script: 1, tone: 2, split: 8, roles: 9 };
    tasks = tasks.slice().sort((a, b) => (RANK[a] ?? 5) - (RANK[b] ?? 5));

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const label = { script: '剧本格式', normalize: '规范化', split: '断句', tone: '语气标注', roles: '角色分离' }[task];
      say('[' + (i + 1) + '/' + tasks.length + '] ' + label + ' 处理中…');

      // 剧本格式：走 parseScript，一次拿到背景 + 带角色的分句
      if (task === 'script') {
        const src = this._draft.original || this._draft.processed;
        const r = await window.electronAPI.ai.process('script', src, opts);
        if (!r.ok) throw new Error(label + '：' + r.message);
        if (r.usage) { tokenTotal.prompt_tokens += r.usage.prompt_tokens || 0; tokenTotal.completion_tokens += r.usage.completion_tokens || 0; }
        this._applyParsed(TextTools.parseScript(r.text, opts.maxLen));
        continue;
      }

      if (task === 'roles') {
        const src = this._draft.processed || this._draft.original;
        const r = await window.electronAPI.ai.process('roles', src, opts);
        if (!r.ok) throw new Error(label + '：' + r.message);
        this._draft.lines = (r.roles || []).map(x => ({
          text: String(x.text || '').trim(),
          role: String(x.role || '旁白').trim(),
          voice: this._voiceForRole(x.role),
          audio: '', error: ''
        })).filter(l => l.text);
        if (r.usage) { tokenTotal.prompt_tokens += r.usage.prompt_tokens || 0; tokenTotal.completion_tokens += r.usage.completion_tokens || 0; }
        continue;
      }

      const src = this._draft.processed || this._draft.original;
      if (!src.trim()) throw new Error('没有可处理的文本');
      const r = await window.electronAPI.ai.process(task, src, opts);
      if (!r.ok) throw new Error(label + '：' + r.message);
      if (r.usage) { tokenTotal.prompt_tokens += r.usage.prompt_tokens || 0; tokenTotal.completion_tokens += r.usage.completion_tokens || 0; }

      if (task === 'normalize' || task === 'tone') this._draft.processed = r.text;
      if (task === 'split') {
        const texts = r.text.split('\n').map(s => s.trim()).filter(Boolean);
        this._draft.processed = texts.join('\n');
        const prev = this._draft.lines || [];
        this._draft.lines = texts.map((t, i) => {
          const old = prev[i] || {};
          return { text: t, role: old.role || '', voice: old.voice || this._voiceForRole(old.role), audio: '', error: '' };
        });
      }
    }

    const cost = ((tokenTotal.prompt_tokens * 0.001 + tokenTotal.completion_tokens * 0.002) / 1000).toFixed(4);
    clearInterval(tick);
    say('完成 · 用时 ' + secs() + ' · token ' + (tokenTotal.prompt_tokens + tokenTotal.completion_tokens)
      + '（输入 ' + tokenTotal.prompt_tokens + ' / 输出 ' + tokenTotal.completion_tokens + '）');
    Notify.onDone();
    Toast.success('AI 处理完成 · ' + tasks.length + ' 项');
  },

  _voiceForRole(role) {
    const p = Store.currentProject || {};
    const hit = (p.roles || []).find(r => r.name === role);
    return (hit && hit.voice) || p.fallbackVoice || '';
  },
};
/* ── 本地文本规范化 + 断句（不联网）── */
const TextTools = {
  _cn: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'],

  /** 整数 → 中文读法（支持到亿，处理零的省略） */
  _intToCn(num) {
    if (!isFinite(num)) return String(num);
    const neg = num < 0; num = Math.abs(Math.round(num));
    if (num === 0) return '零';
    const CN = this._cn, U = ['', '十', '百', '千'], G = ['', '万', '亿', '万亿'];
    let s = '', gi = 0;
    while (num > 0) {
      const chunk = num % 10000;
      if (chunk) {
        let cs = '', zero = false;
        const d = String(chunk).split('').map(Number);
        for (let i = 0; i < d.length; i++) {
          const digit = d[i], pos = d.length - 1 - i;
          if (digit === 0) { zero = true; continue; }
          if (zero) { cs += '零'; zero = false; }
          cs += CN[digit] + U[pos];
        }
        s = cs + G[gi] + s;
      } else if (s && !s.startsWith('零')) { s = '零' + s; }
      num = Math.floor(num / 10000); gi++;
    }
    s = s.replace(/^一十/, '十').replace(/零+$/, '');
    return (neg ? '负' : '') + s;
  },

  /** 小数 → 中文读法：3.14 → 三点一四 */
  _decToCn(str) {
    const [i, d] = String(str).split('.');
    let out = this._intToCn(Number(i));
    if (d) out += '点' + d.split('').map(x => this._cn[Number(x)]).join('');
    return out;
  },

  /** 通用数字读法：整数/小数/千分位 */
  _num(str) {
    const s = String(str).replace(/,/g, '');
    return s.includes('.') ? this._decToCn(s) : this._intToCn(Number(s));
  },

  _yearToCn(y) {
    return String(y).split('').map(d => this._cn[Number(d)]).join('');
  },

  /**
   * 本地文本规范化（不联网）。
   * 数字怎么读是确定性规则，本地做比 AI 更稳 —— AI 会漏、会飘，
   * 所以这里把主要 TN 场景尽量覆盖全。
   * 顺序很重要：从具体到宽泛，长模式先匹配，避免被短规则吃掉。
   */
  normalize(text) {
    const hits = [];
    const log = (from, to) => { if (from !== to) hits.push([from, to]); };
    let t = String(text || '');
    const sub = (re, fn) => {
      t = t.replace(re, (...a) => { const m = a[0]; const out = fn(...a); log(m, out); return out; });
    };
    const n2c = (s) => this._num(s);

    // ── 1. 年份（先做，避免被逐位规则拆散）──
    sub(/(\d{4})\s*年/g, (m, y) => this._yearToCn(y) + '年');

    // ── 2. 金额 ──
    sub(/[¥￥]\s*(\d[\d,]*(?:\.\d+)?)/g, (m, v) => {
      const [i, d] = String(v).replace(/,/g, '').split('.');
      let s = this._intToCn(Number(i)) + '元';
      if (d) {
        const jiao = Number(d[0] || 0), fen = Number(d[1] || 0);
        if (jiao) s += this._cn[jiao] + '角';
        if (fen) s += this._cn[fen] + '分';
      }
      return s;
    });
    sub(/\$\s*(\d[\d,]*(?:\.\d+)?)/g, (m, v) => n2c(v) + '美元');

    // ── 3. 百分比 / 千分号 ──
    sub(/(\d+(?:\.\d+)?)\s*%/g, (m, v) => '百分之' + this._decToCn(v));
    sub(/(\d+(?:\.\d+)?)\s*‰/g, (m, v) => '千分之' + this._decToCn(v));

    // ── 4. 温度 ──
    sub(/(-?\d+(?:\.\d+)?)\s*(?:℃|°C)/gi, (m, v) => this._decToCn(v) + '摄氏度');
    sub(/(-?\d+(?:\.\d+)?)\s*(?:℉|°F)/gi, (m, v) => this._decToCn(v) + '华氏度');

    // ── 5. 时间 15:30 / 9:05 ──
    sub(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mi) => {
      const hh = Number(h), mm = Number(mi);
      if (hh > 23 || mm > 59) return m;
      return this._intToCn(hh) + '点' + (mm === 0 ? '整'
        : (mm < 10 ? '零' + this._cn[mm] : this._intToCn(mm))) + '分';
    });

    // ── 6. 日期 3月5日 / 3月5号 ──
    sub(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g, (m, a, b) => this._intToCn(Number(a)) + '月' + this._intToCn(Number(b)) + '日');

    // ── 7. 分数 1/2（仅当两侧都是小整数）──
    sub(/(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/g, (m, a, b) => this._intToCn(Number(b)) + '分之' + this._intToCn(Number(a)));

    // ── 8. 比分 / 比例 3:1（排除时间已处理的情况）──
    sub(/(?<![\d:])(\d{1,3})\s*:\s*(\d{1,3})(?![\d:])/g, (m, a, b) => this._intToCn(Number(a)) + '比' + this._intToCn(Number(b)));

    // ── 11. 单位（含中文别名），必须跟在数字后 ──
    const UNITS = [
      ['km/h', '公里每小时'], ['m/s', '米每秒'], ['kWh', '千瓦时'],
      ['GB', '吉字节'], ['MB', '兆字节'], ['TB', '太字节'], ['KB', '千字节'],
      ['km', '公里'], ['kg', '千克'], ['cm', '厘米'], ['mm', '毫米'],
      ['ml', '毫升'], ['mL', '毫升'], ['Hz', '赫兹'], ['kHz', '千赫'],
      ['㎡', '平方米'], ['m³', '立方米'], ['W', '瓦'], ['V', '伏']
    ];
    for (const [k, v] of UNITS) {
      const esc = k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      sub(new RegExp('(\\d)\\s*' + esc + '(?![A-Za-z])', 'g'), (m, d) => d + v);
    }

    // ── 9. 范围 3-5 / 3~5 / 3—5 ──
    sub(/(\d+(?:\.\d+)?)\s*[-~～—－]\s*(\d+(?:\.\d+)?)/g, (m, a, b) => this._decToCn(a) + '到' + this._decToCn(b));

    // ── 10. 数学与比较符号 ──
    const SYM = { '+': '加', '＋': '加', '=': '等于', '＝': '等于',
                  '≥': '大于等于', '≤': '小于等于', '≠': '不等于',
                  '×': '乘', '÷': '除以', '±': '正负', '√': '根号',
                  '→': '变为', '≈': '约等于' };
    for (const [k, v] of Object.entries(SYM)) {
      if (t.includes(k)) sub(new RegExp('\\s*\\' + k + '\\s*', 'g'), () => v);
    }

    // ── 12. 负数 ──
    sub(/(?<![\d.])-(\d+(?:\.\d+)?)/g, (m, v) => '负' + this._decToCn(v));

    // ── 13. 序数 第3章 / 第12集 ──
    sub(/第\s*(\d+)\s*(?=[章节集课回卷篇条款项个条])/g, (m, v) => '第' + this._intToCn(Number(v)));

    // ── 14. 英文缩写：全大写 2–6 字母 → 逐字母加空格 ──
    t = t.replace(/(?<![A-Za-z])([A-Z]{2,6})(?![A-Za-z])/g, (m) => {
      // 已经是单个字母序列的跳过
      if (/^[A-Z]$/.test(m)) return m;
      const out = m.split('').join(' ');
      log(m, out); return out;
    });

    // ── 15. 长数字串（电话、编号）逐位读 ──
    sub(/(?<!\d)(\d{7,})(?!\d)/g, (m, v) => v.split('').map(d => this._cn[Number(d)]).join(''));

    // ── 16. 剩下的裸数字（不是年份/已处理）──
    sub(/(?<![\d.])(\d{1,6}(?:\.\d+)?)(?![\d.])/g, (m, v) => this._decToCn(v));

    // ── 17. 引号 / 括号统一 ──
    sub(/[“”]/g, () => '「');
    sub(/[‘’]/g, () => '「');
    sub(/[（）]/g, (m) => m === '（' ? '（' : '）');

    // ── 18. 省略号 / 破折号统一（利于断句与停顿）──
    sub(/\.{3,}|。{3,}/g, () => '……');
    sub(/—{2,}|-{2,}/g, () => '——');

    return { text: t, hits };
  },

  /**
   * 解析剧本。AI 按规范输出两段：
   *   【背景介绍（仅供判断，不配音）】
   *   【角色（情绪）+台词（用于配音）】
   * 只有明确说出口的台词进配音；旁白/动作/环境/心理描写归入背景介绍；
   * 角色名与情绪只是标注，不参与配音。
   */
  parseScript(text, maxLen = 25, opts = {}) {
    const strict = opts.strict !== false;
    const src = String(text || '').replace(/\r\n/g, '\n');
    const bgParts = [];
    const lines = [];
    let mode = null;                       // 'bg' | 'dlg' | null

    const push = (role, emotion, body) => {
      for (const piece of this.split(body, maxLen)) lines.push({ role, emotion, text: piece });
    };
    const isRole = (r) => r && r.length <= 12 && !/[+＋：:。！？，,；;.!?、]/.test(r);

    for (const raw of src.split('\n')) {
      const s = raw.trim();
      if (!s) continue;

      // 段落标题：【背景介绍（…）】/【角色（情绪）+台词（…）】/【总结】…
      const sec = s.match(/^[【\[]\s*(.+?)\s*[】\]]\s*[：:]?\s*$/);
      if (sec) {
        const t = sec[1];
        if (/背景|总览|概要|简介|说明|设定/.test(t)) mode = 'bg';
        else if (/角色|台词|对白|配音/.test(t)) mode = 'dlg';
        continue;
      }

      // 单行总结（兼容「总结：…」「背景：…」）
      const one = s.match(/^(总结|背景|总览|概要|简介|场景)\s*[：:]\s*(.+)$/);
      if (one && mode !== 'dlg') { bgParts.push(one[2].trim()); continue; }

      if (mode === 'bg') { bgParts.push(s); continue; }

      // 角色（情绪）+台词  /  角色（情绪）：台词
      const me = s.match(/^([^+＋：:\n（(]{1,12})\s*[（(]([^）)]{1,24})[）)]\s*[+＋：:]\s*(.+)$/);
      if (me && isRole(me[1].trim())) { push(me[1].trim(), me[2].trim(), me[3].trim()); continue; }

      // 角色+台词  /  角色：台词（无情绪）
      const m = s.match(/^([^+＋：:\n]{1,12})\s*[+＋：:]\s*(.+)$/);
      if (m && isRole(m[1].trim())) { push(m[1].trim(), '', m[2].trim()); continue; }

      // 认不出的行：严格模式归背景（旁白/动作/心理描写不配音），
      // 宽松模式降级为旁白（用户明确要求全篇配音时）
      if (mode === 'dlg') continue;
      if (strict) bgParts.push(s);
      else push('旁白', '中性', s);
    }
    return { background: bgParts.join('\n'), lines };
  },

  /** 按标点断句，长句再按逗号切 */
  split(text, maxLen = 25) {
    const raw = String(text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n+/)
      .flatMap(line => line.split(/(?<=[。！？!?；;])/))
      .map(s => s.trim())
      .filter(Boolean);

    const out = [];
    for (const s of raw) {
      if (s.length <= maxLen * 1.8) { out.push(s); continue; }
      // 太长 → 再按逗号切
      let buf = '';
      for (const piece of s.split(/(?<=[，,、])/)) {
        if ((buf + piece).length > maxLen && buf) { out.push(buf.trim()); buf = piece; }
        else buf += piece;
      }
      if (buf.trim()) out.push(buf.trim());
    }
    return out;
  }
};
