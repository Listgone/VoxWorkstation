/* ══════════════════════════════════════════
   快速配音 —— 不建项目、不建集，粘一段文本就能配音导出

   设计要点（对应「单文本不该污染项目」这条需求）：
     · 数据落在独立工作区 <userData>\_quick\，与项目根目录物理隔离，
       项目列表 / 回收站 / 仪表盘统计都不会出现它；
       进出快速模式，项目文件一个字节都不会被改写。
     · 本页只写「快速工作区」，不碰 text.js / dub.js 的任何 _draft，
       所以项目里已整理好的剧本不会被单文本处理冲掉。
     · 每一步改动立即落盘，切页 / 崩溃 / 重开都能接着干。
   ══════════════════════════════════════════ */

const QuickPage = {
  _draft: null,        // { original, processed, lines }
  _voices: [],
  _busy: false,
  _player: null,       // 当前试听的 Audio
  _playUrl: '',
  _lastVoice: '',      // 整批音色：新台词自动沿用，不用每次重选
  _srcParsed: '',      // 上次自动分句时的文本，避免无谓重算

  /* ── 工作区 ─────────────────────────────── */

  async _enter() {
    const r = await window.electronAPI.quick.enter();
    if (!r || !r.ok) { Toast.error((r && r.message) || '无法进入快速配音', true); return false; }
    Store.enterQuick(r.projectId, r.episodeNo, r.dir);
    this._draft = null;
    this._srcParsed = '';
    return true;
  },

  async _exit() {
    if (this._playing()) this._stop();
    await window.electronAPI.quick.exit();
    Store.exitQuick();
    App.go(Store.currentProject ? 'text' : 'dash');
  },

  /** 保证有草稿：从快速工作区读回来，读不到就开一份空的 */
  async _ensureDraft() {
    if (this._draft) return this._draft;
    let ep = null;
    if (Store.currentProjectId && Store.currentEpisodeNo) {
      const r = await window.electronAPI.episodes.read(Store.currentProjectId, Store.currentEpisodeNo);
      if (r && r.ok) ep = r;
    }
    // 注意：这里必须用 ?? 而不是 || —— 空的 script / lines 是**合法值**
    // （用户刚清空、或只写过一部分），用 || 会把它们当成"读不到"，
    // 于是内存草稿被重置成空，界面上的文本与台词凭空消失。
    const scriptOriginal = (ep && ep.scriptOriginal) ?? '';
    const script = (ep && ep.script) ?? '';
    const lines = (ep && ep.lines) ?? [];
    this._draft = {
      original: scriptOriginal || script,
      processed: script || scriptOriginal,
      lines: (Array.isArray(lines) ? lines : []).map(l => ({ ...l }))
    };
    return this._draft;
  },

  /** 写回快速工作区。每一处改动都落盘，避免"弄完又得重来" */
  async _save(opts = {}) {
    if (!Store.currentProjectId || !Store.currentEpisodeNo) return { ok: false };
    const d = this._draft;
    if (!d) return { ok: false };
    const lines = d.lines.map(l => ({ ...l }));
    const prev = (Store.currentEpisode && Store.currentEpisode.episode) || {};
    const payload = {
      scriptOriginal: d.original,
      script: d.processed,
      lines,
      episode: {
        ...prev,
        no: Store.currentEpisodeNo,
        title: prev.title || '快速配音',
        background: '',
        chars: (d.processed || '').length,
        lineCount: lines.length,
        doneCount: lines.filter(l => l.audio).length,
        durationMs: lines.reduce((a, l) => a + (l.durationMs || 0), 0),
        failureCount: lines.filter(l => l.error).length,
        status: lines.some(l => l.audio) ? 'dubbing'
              : (lines.length ? 'text' : 'draft')
      }
    };
    const r = await window.electronAPI.episodes.write(Store.currentProjectId, Store.currentEpisodeNo, payload);
    if (r && r.ok) {
      Store.currentEpisode = {
        ...(Store.currentEpisode || {}),
        episode: payload.episode, lines,
        script: d.processed, scriptOriginal: d.original
      };
    } else if (!opts.silent) {
      Toast.error((r && r.message) || '保存失败', true);
    }
    return r;
  },

  /* ── 渲染 ───────────────────────────────── */

  render() {
    const on = Store.isQuick;
    return App.head('快速配音',
        on ? '独立工作区：不建项目、不建集，粘一段文本就能配音导出'
           : '只想单独配几句话时用这里 —— 不建项目、不建集，也不碰任何项目文件',
        on ? this._headRight() : '')
      + '<div class="wrap">'
      + (on ? this._body() : this._intro())
      + '</div>';
  },

  _headRight() {
    return '<span class="pill" title="' + Util.escapeAttr(Store.quickDir || '') + '">独立工作区</span>'
      + '<button class="btn btn-sm" data-act="reveal-dir">打开文件夹</button>'
      + '<button class="btn btn-sm" data-act="clear">清空本次</button>'
      + '<button class="btn btn-sm" data-act="exit">退出快速配音</button>';
  },

  _intro() {
    return '<div class="card"><h2>快速配音 <span class="n">独立工作区 · 与项目完全隔离</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-4px 0 12px">'
      + '只想配几句话、做个 demo、试个音色时用这里：<b>不用建项目、不用建集</b>，'
      + '粘一段文本 → 分句 → 生成 → 导出就完了。'
      + '产物落在独立目录，<b>项目里的原文与整理好的剧本不会被改动或覆盖</b>。</p>'
      + '<div class="qsteps">'
      + this._step('1', '粘贴文本', '一段话、一节小说、几条口播稿都行')
      + this._step('2', '分句 / 整理', '本地标点分句，或先用 AI 整理成剧本')
      + this._step('3', '生成音频', '逐句落盘，中断了也能接着生成')
      + this._step('4', '导出', '单条 WAV、整轨合并、纯文本台词')
      + '</div>'
      + '<div class="action-row mt-12">'
      + '<button class="btn btn-primary btn-lg" data-act="start">进入快速配音 →</button>'
      + '<span class="text-sm text-muted">随时可「退出快速配音」，项目流程一切照旧</span>'
      + '</div></div>';
  },

  _step(n, title, sub) {
    return '<div class="qstep"><i>' + n + '</i><b>' + title + '</b><span>' + sub + '</span></div>';
  },

  _body() {
    const d = this._draft || { original: '', processed: '', lines: [] };
    const lines = d.lines || [];
    const done = lines.filter(l => l.audio).length;
    const chars = (d.processed || '').length;
    const hasKey = Store.hasKey();

    return '<div class="cols">'
      + '<div>'

      + '<div class="card"><h2>① 文本 <span class="n">'
      + Util.fmtNum(chars) + ' 字 · <span id="q-linecount">' + lines.length + '</span> 句</span></h2>'
      + '<textarea id="q-src" rows="6" spellcheck="false" '
      + 'placeholder="把要配音的文本粘到这里 —— 粘完就会自动切成一句一行（下方「② 台词」），不需要先做任何处理就能直接生成">'
      + Util.escapeHtml(d.original || d.processed || '') + '</textarea>'
      + '<p class="text-sm text-muted mt-8" style="margin-bottom:9px">'
      + '改动这里会<b>自动重新分句</b>；只想配整段、不切口也没关系，直接点「生成全部」即可。</p>'
      + '<div class="actgrp actgrp-local">'
      + '<span class="actgrp-tag"><i class="dot-local"></i>本地处理 · 不联网 · 瞬间完成</span>'
      + '<div class="action-row">'
      + '<button class="btn btn-local btn-sm" data-act="split">重新分句</button>'
      + '<button class="btn btn-local btn-sm" data-act="tn">数字 / 单位规范化</button>'
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-ghost btn-sm" data-act="reset-lines">丢弃台词改动，按文本重排</button>'
      + '</div></div>'
      + '<div class="actgrp actgrp-ai mt-8">'
      + '<span class="actgrp-tag"><i class="dot-ai"></i>AI 整理 · 需要 Key · 慢但懂语义</span>'
      + '<div class="action-row">'
      + '<button class="btn btn-ai btn-sm" data-act="script">✦ 整理成剧本（带角色与情绪）</button>'
      + '<button class="btn btn-ai btn-sm" data-act="split-ai">✦ 智能断句</button>'
      + '<span style="flex:1"></span>'
      + '<span class="text-sm text-muted">' + (hasKey ? 'AI 已配置' : 'AI 未配置 —— 不影响直接生成') + '</span>'
      + '</div></div>'
      + '</div>'

      + '<div class="card"><h2>② 台词 <span class="n" id="q-linehead">' + lines.length + ' 句 · 已生成 ' + done + '</span></h2>'
      + '<div id="q-linesbox">'
      + (lines.length
        ? '<div class="qlist">' + lines.map((l, i) => this._row(l, i)).join('') + '</div>'
        : '<p class="text-sm text-muted" style="margin:0">还没有可生成的文本。上面粘贴内容即可，'
          + '会<b>自动切句</b>；也可以直接点下面的「生成全部」—— 未切句时会自动按标点切开再生成。</p>')
      + '</div>'
      + '<div class="action-row mt-12">'
      + '<button class="btn btn-primary btn-lg" data-act="gen-all">生成全部</button>'
      + '<button class="btn" data-act="gen-failed">只重生成失败句</button>'
      + '<span style="flex:1"></span>'
      + '<span class="text-sm text-muted" id="q-queue">空闲</span>'
      + '</div>'
      + '<div class="qbar mt-8"><i id="q-qbar" style="width:0%"></i></div>'
      + '<div class="action-row mt-8">'
      + '<span class="text-sm text-muted">整批音色</span>'
      + '<button class="btn btn-sm" data-act="voice-all" title="把下面选的音色应用到全部台词">'
      + '统一音色：' + Util.escapeHtml(this._lastVoice || '默认（音色设计）') + ' ▾</button>'
      + '<span class="text-sm text-muted">新加的台词会自动沿用这个音色，不用每次重选</span>'
      + '</div>'
      + '</div>'

      + '</div>'

      + '<aside>'
      + '<div class="card"><h2>试听 <span class="n" id="q-now">未选择</span></h2>'
      + '<audio id="q-audio" controls style="width:100%;display:none"></audio>'
      + '<p class="text-sm text-muted" id="q-audio-hint" style="margin:8px 0 0">生成后点「▶ 试听」。</p>'
      + '</div>'

      + '<div class="card"><h2>参数 <span class="n">本次生成</span></h2>'
      + this._param('cfg', '稳定性', 10, 30, 20, 10, '2.0')
      + this._param('steps', '质量', 5, 30, 10, 1, '10')
      + '<p class="text-sm text-muted" style="margin:8px 0 0">稳定性越高越贴文本；质量每 +5 约多 40% 耗时。</p>'
      + '</div>'

      + '<div class="card"><h2>导出 <span class="n">' + done + ' 句已生成</span></h2>'
      + '<div class="action-row" style="flex-wrap:wrap">'
      + '<button class="btn btn-sm" data-act="export-merged"' + (done ? '' : ' disabled') + '>整轨合并 WAV</button>'
      + '<button class="btn btn-sm" data-act="export-text"' + (lines.length ? '' : ' disabled') + '>导出台词文本</button>'
      + '<button class="btn btn-sm btn-ghost" data-act="open-out">打开导出目录</button>'
      + '</div>'
      + '<p class="text-sm text-muted mt-8" style="margin-bottom:0">'
      + '逐句 WAV 在 <code>audio\\</code>，合并与文本在 <code>output\\</code>。'
      + '目录：<span class="text-mute">' + Util.escapeHtml(Store.quickDir || '') + '</span></p>'
      + '</div>'

      + '<div class="card" style="margin-bottom:0"><h2>说明</h2>'
      + '<p class="text-sm text-muted" style="margin:0">'
      + '这里是<b>独立工作区</b>：不建项目、不建集，也不会读写任何项目文件。'
      + '内容和音频每次改动立即落盘，随时切走再回来都能接着干；'
      + '「清空本次」只清这个工作区。</p>'
      + '</div>'
      + '</aside>'
      + '</div>';
  },

  _param(id, label, min, max, val, div, text) {
    return '<div class="param"><label>' + label + '</label>'
      + '<input type="range" id="q-' + id + '" min="' + min + '" max="' + max + '" value="' + val + '">'
      + '<b id="q-' + id + '-val">' + text + '</b></div>';
  },

  _row(l, i) {
    const st = l.error ? '<span class="pill pill-err" title="' + Util.escapeAttr(l.error) + '">失败</span>'
      : l.audio ? '<span class="pill pill-ok">✓ ' + Util.fmtDuration(l.durationMs || 0) + '</span>'
      : '<span class="pill">待生成</span>';
    const role = l.role && l.role !== '旁白' ? l.role : '';
    return '<div class="qrow" data-i="' + i + '">'
      + '<div class="qrow-top">'
      + '<span class="num">' + (i + 1) + '</span>'
      + (role ? '<span class="pill pill-p">' + Util.escapeHtml(role)
          + (l.emotion ? '（' + Util.escapeHtml(l.emotion) + '）' : '') + '</span>' : '')
      + st
      + '<span style="flex:1"></span>'
      + '<button class="btn btn-sm" data-act="q-voice" data-i="' + i + '" title="给这一句指定音色">'
      + Util.escapeHtml(l.voice || '默认音色') + ' ▾</button>'
      + '<button class="btn btn-sm btn-gen" data-act="q-gen" data-i="' + i + '">生成</button>'
      + (l.audio ? '<button class="btn btn-sm btn-play" data-act="q-play" data-i="' + i + '" title="试听这一句">▶</button>' : '')
      + '<button class="btn btn-sm btn-ghost" data-act="q-del" data-i="' + i + '" title="删掉这一句">✕</button>'
      + '</div>'
      + '<textarea class="qrow-text" data-act="q-text" data-i="' + i + '" rows="1" spellcheck="false">'
      + Util.escapeHtml(l.text || '') + '</textarea>'
      + '</div>';
  },

  /* ── 挂载 ───────────────────────────────── */

  async mount(el) {
    el.querySelector('[data-act="reveal-dir"]')?.addEventListener('click', () => window.electronAPI.quick.reveal());
    el.querySelector('[data-act="exit"]')?.addEventListener('click', async () => {
      const d = this._draft;
      const hasWork = d && ((d.processed || '').trim() || (d.lines || []).length);
      if (hasWork) {
        const ok = await Modal.confirm({
          title: '退出快速配音', okText: '退出',
          message: '退出后会回到项目流程。<br>快速工作区的内容<b>会保留</b>，下次进来还在。'
        });
        if (!ok) return;
      }
      await this._exit();
    });
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => this._clear());
    el.querySelector('[data-act="open-out"]')?.addEventListener('click', () => window.electronAPI.quick.reveal());

    // 未进入工作区：只处理「进入」
    if (!Store.isQuick) {
      el.querySelector('[data-act="start"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const ok = await this._enter();
        if (ok) { await App.go('quick'); Toast.success('已进入快速配音工作区'); }
        else btn.disabled = false;
      });
      return;
    }

    // 等草稿读回来再绑交互：文本区要先填上内容
    const wasReady = !!this._draft;
    await this._ensureDraft();
    if (!wasReady) { await App.go('quick'); return; }   // 重渲染一次，带上真实内容

    const ta = el.querySelector('#q-src');
    /* 文本区是唯一来源：改动即自动分句，不需要用户先点任何按钮。
       300ms 防抖，避免每敲一个字就整页重渲染、把光标顶掉。 */
    ta?.addEventListener('input', () => {
      this._draft.original = ta.value;
      this._draft.processed = ta.value;
      this._scheduleAutoSplit(ta.value);
    });
    ta?.addEventListener('blur', () => this._save({ silent: true }));

    el.querySelector('[data-act="tn"]')?.addEventListener('click', () => {
      const src = this._src(ta);
      if (!src.trim()) { Toast.error('先粘点文本', true); return; }
      const { text, hits } = TextTools.normalize(src);
      if (ta) ta.value = text;
      this._parseFromText(text, { announce: false });
      this._rerender();
      Toast.success(hits.length ? '本地规范化完成 · ' + hits.length + ' 处' : '没有需要规范化的内容');
    });

    el.querySelector('[data-act="split"]')?.addEventListener('click', () => {
      const src = this._src(ta);
      if (!src.trim()) { Toast.error('先粘点文本', true); return; }
      this._parseFromText(src);
      this._rerender();
      Toast.success('已切成 ' + this._draft.lines.length + ' 句');
    });

    el.querySelector('[data-act="reset-lines"]')?.addEventListener('click', () => {
      const src = this._src(ta);
      if (!src.trim()) { Toast.error('先粘点文本', true); return; }
      const parsed = TextTools.parseScript(src, this._maxLen(), { strict: false });
      this._applyParsed(parsed, src, null);
      this._rerender();
      Toast.success('已按当前文本重排 ' + this._draft.lines.length + ' 句');
    });

    el.querySelector('[data-act="script"]')?.addEventListener('click', () => this._aiRun('script', ta));
    el.querySelector('[data-act="split-ai"]')?.addEventListener('click', () => this._aiRun('split', ta));

    ['cfg', 'steps'].forEach(k => {
      const sl = el.querySelector('#q-' + k);
      sl?.addEventListener('input', () => {
        const v = el.querySelector('#q-' + k + '-val');
        if (v) v.textContent = k === 'cfg' ? (parseInt(sl.value, 10) / 10).toFixed(1) : sl.value;
      });
    });

    // 台词行的交互统一走 _bindRows（局部刷新时复用同一套绑定）
    this._bindRows(el);

    el.querySelector('[data-act="gen-all"]')?.addEventListener('click', () =>
      this._generate('all'));
    el.querySelector('[data-act="gen-failed"]')?.addEventListener('click', () => {
      const idx = this._draft.lines.map((l, i) => l.error ? i : -1).filter(i => i >= 0);
      if (!idx.length) { Toast.show('没有失败的句子'); return; }
      this._generate(idx);
    });
    el.querySelector('[data-act="voice-all"]')?.addEventListener('click', (e) =>
      this._pickVoiceForAll(e.currentTarget));

    el.querySelector('[data-act="export-merged"]')?.addEventListener('click', () => this._exportMerged());
    el.querySelector('[data-act="export-text"]')?.addEventListener('click', () => this._exportText());
  },

  _maxLen() {
    return (Store.currentProject && Store.currentProject.defaults && Store.currentProject.defaults.maxLineLen) || 25;
  },

  _rerender() {
    this._save({ silent: true }).then(() => App.go('quick'));
  },

  /** 只刷新台词区（不整页重渲染，避免把文本区光标顶掉） */
  _patchLines() {
    const box = document.getElementById('q-linesbox');
    const head = document.getElementById('q-linehead');
    const cnt = document.getElementById('q-linecount');
    const lines = (this._draft && this._draft.lines) || [];
    const done = lines.filter(l => l.audio).length;
    if (head) head.textContent = lines.length + ' 句 · 已生成 ' + done;
    if (cnt) cnt.textContent = String(lines.length);
    const vlabel = document.querySelector('#page-quick [data-act="voice-all"]');
    if (vlabel) vlabel.textContent = '统一音色：' + (this._lastVoice || '默认（音色设计）') + ' ▾';
    if (!box) return;
    box.innerHTML = lines.length
      ? '<div class="qlist">' + lines.map((l, i) => this._row(l, i)).join('') + '</div>'
      : '<p class="text-sm text-muted" style="margin:0">还没有可生成的文本。上面粘贴内容即可，'
        + '会<b>自动切句</b>；也可以直接点下面的「生成全部」—— 未切句时会自动按标点切开再生成。</p>';
    this._bindRows(box);
  },

  /** 绑定台词行内的交互（整页 mount 与局部刷新共用） */
  _bindRows(scope) {
    const el = scope || document.getElementById('page-quick');
    if (!el) return;
    el.querySelectorAll('[data-act="q-text"]').forEach(t => {
      t.addEventListener('input', () => {
        const i = Number(t.dataset.i);
        if (this._draft.lines[i]) this._draft.lines[i].text = t.value;
      });
      t.addEventListener('blur', () => this._save({ silent: true }));
    });
    el.querySelectorAll('[data-act="q-gen"]').forEach(b =>
      b.addEventListener('click', () => this._generate([Number(b.dataset.i)])));
    el.querySelectorAll('[data-act="q-play"]').forEach(b =>
      b.addEventListener('click', () => this._play(Number(b.dataset.i))));
    el.querySelectorAll('[data-act="q-del"]').forEach(b =>
      b.addEventListener('click', () => {
        this._draft.lines.splice(Number(b.dataset.i), 1);
        this._patchLines();
        this._save({ silent: true });
      }));
    el.querySelectorAll('[data-act="q-voice"]').forEach(b =>
      b.addEventListener('click', (e) => { e.stopPropagation(); this._pickVoice(Number(b.dataset.i), b); }));
  },

  /* ── 文本处理 ───────────────────────────── */

  /** 当前文本：优先取文本区里的实时值 */
  _src(ta) {
    const el = ta || document.getElementById('q-src');
    if (el && typeof el.value === 'string' && el.value.trim()) return el.value;
    const d = this._draft || {};
    return d.original || d.processed || '';
  },

  /** 文本改动后的自动分句（防抖）。文本没变就什么都不做，避免白重算 */
  _scheduleAutoSplit(text) {
    clearTimeout(this._splitTimer);
    this._splitTimer = setTimeout(() => {
      if (this._busy) return;                      // 生成中不重建行，免得下标错位
      const src = String(text || '').trim();
      if (src === this._srcParsed) return;
      if (!src) {
        this._srcParsed = '';
        this._draft.lines = [];
        this._patchLines();
        this._save({ silent: true });
        return;
      }
      this._parseFromText(src);
      this._patchLines();                          // 局部刷新：不整页重渲染，光标不跳
      this._save({ silent: true });
    }, 300);
  },

  /** 把文本切成一句一行；文本为空则清空。返回行数组 */
  _parseFromText(src, opts = {}) {
    const text = String(src || '').trim();
    if (!text) {
      this._draft.original = '';
      this._draft.processed = '';
      this._draft.lines = [];
      this._srcParsed = '';
      return [];
    }
    const parsed = TextTools.parseScript(text, this._maxLen(), { strict: false });
    this._applyParsed(parsed, text, null);
    this._srcParsed = text;
    if (opts.announce) Toast.success('已切成 ' + this._draft.lines.length + ' 句');
    return this._draft.lines;
  },

  /**
   * 应用解析结果。
   * 音色承接规则（用户明确要求：音色固定后不要每次被刷回默认）：
   *   ① 同一位置的台词文本没变 → 音色、已生成音频全部保留，不重做；
   *   ② 台词变了 → 先按上次整批音色 _lastVoice；
   *   ③ 都没有 → 空（默认音色设计）。
   */
  _applyParsed(parsed, src, processed) {
    const d = this._draft;
    const prev = d.lines || [];
    const prevByText = new Map();
    for (const l of prev) {
      if (l && l.text && !prevByText.has(l.text)) prevByText.set(l.text, l);
    }
    if (src != null) d.original = src;      // 只有本地处理才改写原文；AI 结果不改
    d.processed = processed || TextTools.renderScript(parsed);
    d.lines = parsed.lines.map((l, i) => {
      const old = prev[i];
      if (old && old.text === l.text) {
        return {
          ...old,
          role: l.role || old.role || '旁白',
          emotion: l.emotion || old.emotion || '',
          voice: old.voice || this._lastVoice || ''
        };
      }
      const same = prevByText.get(l.text);
      if (same) {
        return {
          ...same,
          role: l.role || same.role || '旁白',
          emotion: l.emotion || same.emotion || ''
        };
      }
      return {
        text: l.text,
        role: l.role || '旁白',
        emotion: l.emotion || '',
        voice: this._lastVoice || '',
        audio: '', error: '', durationMs: 0
      };
    });
  },

  async _clear() {
    const ok = await Modal.confirm({
      title: '清空快速工作区', okText: '清空', danger: true,
      message: '会清空快速配音的文本、台词与音频。<br><b>不影响任何项目</b>，项目文件一个都不会动。'
    });
    if (!ok) return;
    if (this._playing()) this._stop();
    this._draft = null;
    this._srcParsed = '';
    this._lastVoice = '';
    await window.electronAPI.quick.clear();
    await App.go('quick');
    Toast.success('已清空快速工作区');
  },

  /** AI 整理 / 断句：有 Key 走 AI，没 Key 退回本地规则 */
  async _aiRun(task, ta) {
    const src = this._src(ta).trim();
    if (!src) { Toast.error('先粘点文本', true); return; }
    const label = task === 'script' ? '整理成剧本' : '智能断句';
    const maxLen = this._maxLen();

    if (!Store.hasKey()) {
      if (task === 'script') {
        this._applyParsed(TextTools.parseScript(src, maxLen), null);
        Toast.show('已用本地规则分句（未配置 AI）· ' + this._draft.lines.length + ' 句');
      } else {
        const parsed = TextTools.parseScript(src, maxLen, { strict: false });
        this._applyParsed(parsed, null);
        Toast.show('已用本地标点断句 · ' + this._draft.lines.length + ' 句');
      }
      this._srcParsed = src;
      this._rerender();
      return;
    }

    const btn = document.querySelector('[data-act="' + (task === 'script' ? 'script' : 'split-ai') + '"]');
    const restore = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = label + '中…'; }
    const t0 = Date.now();
    try {
      const r = await window.electronAPI.ai.process(task, src, {
        maxLen,
        projectPrompt: '',
        dict: []
      });
      if (!r.ok) throw new Error(r.message);
      if (task === 'script') {
        this._applyParsed(TextTools.parseScript(r.text, maxLen), null);
      } else {
        const texts = String(r.text || '').split('\n').map(s => s.trim()).filter(Boolean);
        const parsed = TextTools.parseScript(texts.join('\n'), maxLen, { strict: false });
        this._applyParsed(parsed, null, texts.join('\n'));
      }
      this._srcParsed = src;   // 文本没变，别再自动重切覆盖 AI 结果
      Toast.success('已' + label + ' · ' + this._draft.lines.length + ' 句 · 用时 '
        + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      this._rerender();
    } catch (e) {
      Toast.error(label + '失败：' + (e.message || e), true);
      if (btn) { btn.disabled = false; btn.innerHTML = restore; }
    }
  },

  /* ── 音色 ───────────────────────────────── */

  async _loadVoices() {
    if (this._voices.length) return this._voices;
    try { this._voices = await API.getPresets(); } catch (e) { this._voices = []; }
    return this._voices;
  },

  /** 单句音色。选了就记成整批音色 —— 之后新加的台词自动沿用，不必重选 */
  async _pickVoice(i, btn) {
    const line = this._draft.lines[i];
    if (!line) return;
    const vs = await this._loadVoices();
    const items = [{ label: '默认（音色设计）', value: '__none__', active: !line.voice }]
      .concat(vs.map(v => ({ label: v.name, value: v.name, sub: v.desc || '', active: v.name === line.voice })));
    App._menu(btn || document.body, items, async (v) => {
      line.voice = v === '__none__' ? '' : v;
      if (line.voice) this._lastVoice = line.voice;
      this._srcParsed = this._src().trim();     // 别被自动重切覆盖
      await this._save({ silent: true });
      this._patchLines();                       // 局部刷新，不打断输入
      Toast.success('第 ' + (i + 1) + ' 句音色：' + (line.voice || '默认')
        + (line.voice ? '（已记为整批音色，新台词自动沿用）' : ''));
    }, { minWidth: 240 });
  },

  /** 整批音色：一次指定，全部台词跟着走；后续新增的台词也沿用 */
  async _pickVoiceForAll(btn) {
    const vs = await this._loadVoices();
    const cur = this._lastVoice || '';
    const items = [{ label: '默认（音色设计）', value: '__none__', active: !cur }]
      .concat(vs.map(v => ({ label: v.name, value: v.name, sub: v.desc || '', active: v.name === cur })));
    App._menu(btn || document.body, items, async (v) => {
      this._lastVoice = v === '__none__' ? '' : v;
      const lines = this._draft.lines || [];
      for (const l of lines) l.voice = this._lastVoice;
      this._srcParsed = this._src().trim();   // 别被自动重切覆盖
      await this._save({ silent: true });
      this._patchLines();                     // 局部刷新，不打断输入
      Toast.success(lines.length
        ? '全部 ' + lines.length + ' 句音色：' + (this._lastVoice || '默认') + '（新台词也会自动沿用）'
        : '整批音色：' + (this._lastVoice || '默认') + '（新台词会自动沿用）');
    }, { minWidth: 240 });
  },

  /* ── 生成 ───────────────────────────────── */

  async _generate(indexes) {
    if (this._busy) { Toast.error('正在生成中，等这一批跑完', true); return; }
    /* 关键：撤销还挂着的自动重切（"粘完立刻点生成"时防抖还没触发）。
       若让它留在队列里，它会在生成过程中按当时的快照重建 lines，
       把刚生成的音频整批清掉。 */
    clearTimeout(this._splitTimer);

    /* 生成前保证"文本 → 台词"是同步的：
       文本为空 → 没有可生成的；文本变了（或还没切过）→ 现切现配。 */
    const src = this._src().trim();
    if (src !== this._srcParsed) {
      this._parseFromText(src);                 // 长度 0 时为空文本 → 清空台词
      await this._save({ silent: true });
      this._patchLines();
    } else if (!(this._draft.lines || []).length) {
      Toast.error('还没有可生成的文本', true);
      return;
    }
    const lines = this._draft.lines;
    if (!lines.length) { Toast.error('没有可生成的台词', true); return; }
    if (indexes === 'all' || !indexes.length) indexes = lines.map((_, i) => i);
    indexes = indexes.filter(i => lines[i]);
    if (!indexes.length) return;

    const cfg = parseInt(document.getElementById('q-cfg')?.value || '20', 10) / 10;
    const steps = parseInt(document.getElementById('q-steps')?.value || '10', 10);
    const qbar = document.getElementById('q-qbar');
    const qlabel = document.getElementById('q-queue');

    this._busy = true;
    const total = indexes.length;
    let doneN = 0, failN = 0;
    try {
      for (let k = 0; k < indexes.length; k++) {
        const i = indexes[k];
        const line = lines[i];
        if (!line) continue;
        if (qlabel) qlabel.textContent = (k + 1) + ' / ' + total + ' · 第 ' + (i + 1) + ' 句';
        if (qbar) qbar.style.width = Math.round((k / total) * 100) + '%';
        App._syncStatus('生成中', '快速配音 · 第 ' + (i + 1) + ' / ' + total + ' 句');
        try {
          const r = line.voice
            ? await API.generateClone(line.text, line.voice, cfg, steps, null, line.voice)
            : await API.generateDesign(line.text, '无', cfg, steps);
          if (!r.blob) throw new Error('后端没有返回音频');
          const buf = await r.blob.arrayBuffer();
          const b64 = Util.ab2b64(buf);
          const idx = String(i + 1).padStart(3, '0');
          const snippet = String(line.text || '')
            .replace(/\[[^\]]*\]/g, '')
            .replace(/[\\/:*?"<>|\r\n]/g, '')
            .replace(/\s+/g, '')
            .slice(0, 6) || '未命名';
          const filename = idx + '_quick_' + snippet + '.wav';
          const w = await window.electronAPI.audio.save(Store.currentProjectId, Store.currentEpisodeNo, filename, b64);
          if (w && w.ok === false) throw new Error(w.message || '保存音频失败');

          let ms = 0;
          try {
            const ctx = AudioPlayer._getAudioContext();
            const ab = await ctx.decodeAudioData(buf.slice(0));
            ms = Math.round(ab.duration * 1000);
          } catch (e) { /* 解码失败不影响保存 */ }

          Object.assign(line, { audio: filename, error: '', durationMs: ms });
          doneN++;
        } catch (e) {
          line.audio = '';
          line.error = e.message || '生成失败';
          failN++;
        }
        // 每句落盘：中断也能续，不必从头再来
        await this._save({ silent: true });
      }
    } finally {
      this._busy = false;
      if (qbar) qbar.style.width = '100%';
      if (qlabel) qlabel.textContent = '完成 ' + doneN + ' 句' + (failN ? ' · 失败 ' + failN : '');
      App._syncStatus('就绪');
    }

    if (failN) { Toast.error('完成 ' + doneN + ' 句，失败 ' + failN + ' 句', true); Notify.onFail(); }
    else { Toast.success('已生成 ' + doneN + ' 句'); Notify.onDone(); }
    App.go('quick');
  },

  /* ── 试听 ───────────────────────────────── */

  _playing() { return !!(this._player && !this._player.paused); },

  _stop() {
    try { this._player && this._player.pause(); } catch (e) { /* 忽略 */ }
    this._player = null;
    if (this._playUrl) { URL.revokeObjectURL(this._playUrl); this._playUrl = ''; }
  },

  async _play(i) {
    const line = this._draft.lines[i];
    if (!line || !line.audio) return;
    try {
      const r = await window.electronAPI.audio.read(Store.currentProjectId, Store.currentEpisodeNo, line.audio);
      if (!r || !r.ok) throw new Error((r && r.message) || '读取音频失败');
      this._stop();
      const el = document.getElementById('q-audio');
      const blob = Util.b64ToBlob(r.base64, 'audio/wav');
      this._playUrl = URL.createObjectURL(blob);
      if (el) {
        el.style.display = '';
        el.src = this._playUrl;
        this._player = el;
        await el.play().catch(() => { /* 自动播放被拦，用户可手动点 */ });
      }
      const now = document.getElementById('q-now');
      if (now) now.textContent = '第 ' + (i + 1) + ' 句 · ' + (line.voice || '默认音色');
      const hint = document.getElementById('q-audio-hint');
      if (hint) hint.textContent = line.audio + ' · ' + Util.fmtDuration(line.durationMs || 0);
    } catch (e) { Toast.error('试听失败：' + (e.message || e), true); }
  },

  /* ── 导出 ───────────────────────────────── */

  async _exportMerged() {
    const done = this._draft.lines.filter(l => l.audio);
    if (!done.length) { Toast.error('还没有生成任何音频', true); return; }
    App._syncStatus('导出中', '合并 ' + done.length + ' 段音频');
    try {
      const files = [];
      for (const l of done) {
        const r = await window.electronAPI.audio.read(Store.currentProjectId, Store.currentEpisodeNo, l.audio);
        if (r && r.ok) {
          files.push(new File([Util.b64ToBlob(r.base64, 'audio/wav')], l.audio.trim(), { type: 'audio/wav' }));
        }
      }
      if (!files.length) throw new Error('没有可合并的音频');
      const res = await API.mergeAudio(files);
      if (!res.blob) throw new Error('后端没有返回音频');
      const buf = await res.blob.arrayBuffer();
      const name = '快速配音_整轨_' + this._stamp() + '.wav';
      const w = await window.electronAPI.audio.save(Store.currentProjectId, Store.currentEpisodeNo,
        '../output/' + name, Util.ab2b64(buf));
      if (w && w.ok === false) throw new Error(w.message || '保存失败');
      await window.electronAPI.episodes.logExport(Store.currentProjectId, Store.currentEpisodeNo, {
        what: '整轨 WAV（' + files.length + ' 句 · ' + Util.fmtDuration(done.reduce((a, l) => a + (l.durationMs || 0), 0)) + '）',
        path: (w && w.path) || ''
      });
      Notify.onDone();
      Toast.success('已导出：' + name);
    } catch (e) {
      Toast.error('导出失败：' + (e.message || e), true);
    }
    App._syncStatus('就绪');
  },

  async _exportText() {
    const lines = this._draft.lines;
    if (!lines.length) { Toast.error('还没有台词', true); return; }
    const withRole = lines.some(l => l.role && l.role !== '旁白');
    const body = lines.map(l => (withRole && l.role && l.role !== '旁白'
        ? l.role + (l.emotion ? '（' + l.emotion + '）' : '') + '+' : '') + (l.text || '')).join('\n');
    const name = '快速配音_台词_' + this._stamp() + '.txt';
    try {
      const blob = new Blob(['\ufeff' + body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      Toast.success('已导出台词：' + name);
    } catch (e) { Toast.error('导出失败：' + (e.message || e), true); }
  },

  _stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
};
