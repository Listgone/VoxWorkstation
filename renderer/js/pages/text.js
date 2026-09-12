/* ══════════════════════════════════════════
   文本处理 —— 原文 → 可直接配音的台词
   ══════════════════════════════════════════ */

const TextPage = {
  _draft: null,      // { original, processed, lines }

  render() {
    const p = Store.currentProject;
    const ep = Store.currentEpisode;
    if (!p || !ep) return this._empty();

    const d = this._draft || (this._draft = {
      original: ep.scriptOriginal || '',
      processed: ep.script || '',
      lines: (ep.lines || []).map(l => ({ ...l }))
    });
    const chars = (d.processed || '').length;

    return App.head('文本处理', '把原始文本变成可以直接配音的台词',
        '<span class="pill">' + Util.fmtNum(chars) + ' 字 · ' + d.lines.length + ' 句</span>')
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
      + '</div></div>'

      + '<div class="card"><h2>对照 <span class="n">原文永不改动，处理结果只写右栏</span></h2>'
      + '<div class="duo">'
      + '<div class="pane"><div class="ph"><span>原文</span><span style="font-weight:400">只读</span></div>'
      + '<textarea id="tx-orig" class="pane-text" spellcheck="false" placeholder="（还没有原文）">'
      + Util.escapeHtml(d.original) + '</textarea></div>'
      + '<div class="pane"><div class="ph"><span>处理后 · 直接送 TTS</span>'
      + '<span style="font-weight:400;color:var(--ok)">✓ 可编辑</span></div>'
      + '<textarea id="tx-proc" class="pane-text" spellcheck="false" placeholder="（还没有处理结果）">'
      + Util.escapeHtml(d.processed) + '</textarea></div>'
      + '</div></div>'

      + '<div class="card"><h2>处理 <span class="n" id="tx-ai-state">'
      + (Store.hasApiKey ? 'AI 已配置' : 'AI 未配置 —— 本地规则仍可用') + '</span></h2>'
      + '<div class="action-row">'
      + '<button class="btn btn-ai" data-act="tn">✦ 本地规范化</button>'
      + '<button class="btn" data-act="split">按标点断句</button>'
      + '<button class="btn" data-act="ai-proc">✦ AI 处理…</button>'
      + '<button class="btn btn-ghost" data-act="reset-proc">恢复为原文</button>'
      + '</div>'
      + '<p class="text-sm text-muted mt-8" style="margin-bottom:0">「本地规范化」不联网，处理数字、日期、百分比、常见缩写；'
      + '「AI 处理」需要先在设置里配置服务商。</p></div>'

      + '<div class="card"><h2>分句 <span class="n">' + d.lines.length + ' 句</span></h2>'
      + (d.lines.length
        ? '<table><tr><th style="width:36px">#</th><th style="width:96px">角色</th><th>台词</th>'
          + '<th style="width:64px">字数</th><th style="width:78px">状态</th></tr>'
          + d.lines.map((l, i) => this._lineRow(l, i)).join('') + '</table>'
        : '<p class="text-sm text-muted" style="margin:0">还没有分句。先填原文，再点上面的「按标点断句」。</p>')
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

  _lineRow(l, i) {
    const dur = l.audio ? '<span class="pill pill-ok">✓</span>' : '<span class="text-muted">·</span>';
    const role = l.role || '旁白';
    const voice = l.voice || '—';
    return '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td><span class="pill">' + Util.escapeHtml(role) + '</span></td>'
      + '<td class="tx">' + Util.escapeHtml(l.text || '') + '</td>'
      + '<td class="num">' + (l.text || '').length + '</td>'
      + '<td>' + dur + ' <span class="text-sm text-muted">' + Util.escapeHtml(voice) + '</span></td></tr>';
  },

  async mount(el) {
    el.querySelector('[data-act="goto-projects"]')?.addEventListener('click', () => App.go('projects'));
    el.querySelector('[data-act="goto-eps"]')?.addEventListener('click', () => App.go('episodes'));
    if (!Store.currentProject || !Store.currentEpisode) return;

    const orig = el.querySelector('#tx-orig');
    const proc = el.querySelector('#tx-proc');
    orig?.addEventListener('input', () => { this._draft.original = orig.value; });
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
      this._draft = { original: '', processed: '', lines: [] };
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
      const lines = TextTools.split(src, maxLen).map(t => ({ text: t, role: '', voice: '', audio: '', error: '' }));
      this._draft.lines = lines;
      App.go('text');
      Toast.success('已切成 ' + lines.length + ' 句');
    });

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

  _aiPanel() {
    const ai = Store.settings.ai || {};
    Modal.open({
      title: '✦ AI 文本处理', width: 620,
      body:
        '<p class="text-sm text-muted" style="margin-bottom:12px">服务商：<b>'
        + Util.escapeHtml(ai.model || '未配置') + '</b> · '
        + (Store.hasApiKey ? '已配置 API Key' : '<span style="color:var(--danger)">未配置 API Key</span>') + '</p>'
        + '<div class="checks">'
        + ['规范化：数字/日期/百分比/缩写 → 口语读法',
           '断句：按语义切分，目标句长 ≤ ' + ((Store.currentProject.defaults || {}).maxLineLen || 25) + ' 字',
           '语气标注：自动插入 [laughing] / [sigh] 等 VoxCPM2 标记',
           '角色分离：识别「小明：……」拆角色']
          .map(t => '<div><span class="b">✓</span>' + Util.escapeHtml(t) + '</div>').join('')
        + '</div>'
        + '<p class="text-sm text-muted mt-12" style="margin-bottom:0">'
        + (Store.hasApiKey
            ? 'AI 处理会调用你配置的服务商，原文不会被改动。'
            : '请先到「设置 → AI 服务」填写接口地址、模型和 API Key。当前可先用「本地规范化」。')
        + '</p>',
      footer: '<button class="btn" data-act="cancel">关闭</button>'
            + (Store.hasApiKey ? '' : '<button class="btn btn-primary" data-act="to-settings">去配置</button>')
    });
    document.querySelector('[data-act="cancel"]')?.addEventListener('click', () => Modal.close());
    document.querySelector('[data-act="to-settings"]')?.addEventListener('click', () => {
      Modal.close(); SettingsPage._sec = 'ai'; App.go('settings');
    });
  }
};

/* ── 本地文本规范化 + 断句（不联网）── */
const TextTools = {
  _cn: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'],

  _numToCn(n) {
    if (n === 0) return '零';
    if (n < 10) return this._cn[n];
    if (n < 20) return '十' + (n % 10 ? this._cn[n % 10] : '');
    if (n < 100) return this._cn[Math.floor(n / 10)] + '十' + (n % 10 ? this._cn[n % 10] : '');
    return String(n).split('').map(d => this._cn[Number(d)]).join('');
  },

  _yearToCn(y) {
    return String(y).split('').map(d => this._cn[Number(d)]).join('');
  },

  normalize(text) {
    const hits = [];
    let t = text;

    // 年份：2024年 → 二零二四年
    t = t.replace(/(\d{4})\s*年/g, (m, y) => { hits.push([m, this._yearToCn(y) + '年']); return this._yearToCn(y) + '年'; });

    // 百分比：3.14% → 百分之三点一四
    t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (m, v) => {
      const parts = String(v).split('.');
      const intPart = this._numToCn(Number(parts[0]));
      const decPart = parts[1] ? '点' + parts[1].split('').map(d => this._cn[Number(d)]).join('') : '';
      const out = '百分之' + intPart + decPart;
      hits.push([m, out]); return out;
    });

    // 常见英文缩写 → 逐字母
    const abbr = { 'AI': 'A I', 'IDC': 'I D C', 'GDP': 'G D P', 'CEO': 'C E O', 'API': 'A P I',
                   'CPU': 'C P U', 'GPU': 'G P U', 'IT': 'I T', 'PC': 'P C', 'USB': 'U S B' };
    for (const [k, v] of Object.entries(abbr)) {
      const re = new RegExp('(?<![A-Za-z])' + k + '(?![A-Za-z])', 'g');
      if (re.test(t)) { hits.push([k, v]); t = t.replace(re, v); }
    }

    // 单位
    const units = [['km', '公里'], ['kg', '公斤'], ['cm', '厘米'], ['mm', '毫米'], ['㎡', '平方米']];
    for (const [k, v] of units) {
      const re = new RegExp('(\\d)\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      t = t.replace(re, (m, d) => { hits.push([m, d + v]); return d + v; });
    }

    // 直角引号统一
    t = t.replace(/「/g, '“').replace(/」/g, '”');
    t = t.replace(/[ \t]+/g, ' ');
    return { text: t, hits };
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
