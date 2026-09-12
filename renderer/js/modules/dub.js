/* ========================================
   DubModule — Voice Workstation
   ======================================== */

const DubModule = {
  _presets: [],
  _selectedPreset: null,
  _player: null,
  _history: [],
  _presetsLoaded: false,
  _presetsLoadedAt: 0,
  _stats: { chars: 0, gens: 0, dls: 0 },

  async init(ct) {
    ct.innerHTML = this._html();
    this._bindEvents(ct);
    this._player = AudioPlayer.create('dub-player');
    this._renderSidePanel();
    this._bindSidePanel();
    await this._loadPresets();
    await this._loadHistory();
  },

  _html() {
    return '<div class="card"><div class="section-title">音色选择</div>'
      + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">'
      + '<input type="text" id="dub-voice-search" placeholder="搜索音色..." style="max-width:220px">'
      + '<button class="btn btn-sm btn-ghost" id="dub-refresh-presets" title="刷新"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button></div>'
      + '<div class="voice-selector" id="dub-voice-cards"><span class="text-muted text-sm" style="padding:12px">加载音色中...</span></div></div>'
      + '<div class="card" style="flex:1;display:flex;flex-direction:column">'
      + '<div class="section-title">文本输入</div>'
      + '<textarea id="dub-text" rows="6" placeholder="输入要配音的文本..." style="flex:1;min-height:120px"></textarea>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">'
      + '<span class="text-sm text-muted" id="dub-char-count">0 字</span>'
      + '<div class="tone-chips" id="dub-tone-chips"></div></div></div>'
      + '<div class="card" id="dub-result-card" style="display:none"><div class="section-title">生成结果</div><div id="dub-player"></div></div>'
      + '<div class="card"><div class="section-title">生成历史</div><div class="history-list" id="dub-history"></div></div>';
  },

  _tonemap() {
    return {'[laughing]':'笑','[sigh]':'叹息','[Uhm]':'思考','[Question-ah]':'疑问','[Question-en]':'嗯?','[Surprise-wa]':'惊讶','[Dissatisfaction-hnn]':'不满','[Shh]':'安静'};
  },

  _renderToneChips(ct) {
    const chips = ct.querySelector('#dub-tone-chips');
    if (!chips) return;
    const L = this._tonemap();
    chips.innerHTML = '<span class="text-muted text-sm" style="margin-right:4px">语气:</span>'
      + Object.keys(L).map(k => '<button class="btn btn-xs btn-ghost tone-chip" data-marker="' + Util.escapeAttr(k) + '">' + Util.escapeHtml(L[k]) + '</button>').join('');
  },

  _renderSidePanel() {
    const p = document.getElementById('side-panel');
    if (!p) return;
    p.innerHTML = '<div class="card"><div class="section-title">音色信息</div>'
      + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
      + '<div style="width:48px;height:48px;border-radius:12px;background:var(--accent-muted);display:flex;align-items:center;justify-content:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></div>'
      + '<div><div style="font-weight:600;font-size:14px" id="side-voice-name">未选择</div><div style="font-size:11px;color:var(--text-muted)" id="side-voice-meta">请从上方选择音色</div></div></div>'
      + '<div style="font-size:11px;color:var(--text-muted)" id="side-voice-desc"></div></div>'
      + '<div class="card"><div class="section-title">参数调节</div>'
      + '<div class="param-group"><label>音量</label><input type="range" id="dub-param-volume" min="0" max="200" value="100"><span class="param-val" id="dub-param-volume-val">100%</span></div>'
      + '<div class="param-group"><label>语速</label><input type="range" id="dub-param-speed" min="50" max="200" value="100"><span class="param-val" id="dub-param-speed-val">1.0x</span></div>'
      + '<div class="param-group"><label>音调</label><input type="range" id="dub-param-pitch" min="-12" max="12" value="0"><span class="param-val" id="dub-param-pitch-val">0</span></div>'
      + '<div class="param-group"><label>稳定性</label><input type="range" id="dub-param-cfg" min="10" max="30" value="20"><span class="param-val" id="dub-param-cfg-val">2.0</span></div>'
      + '<div class="param-group"><label>质量</label><input type="range" id="dub-param-steps" min="5" max="30" value="10"><span class="param-val" id="dub-param-steps-val">10</span></div></div>'
      + '<button class="btn btn-sm btn-secondary" id="dub-reset-params" style="width:100%;margin-bottom:4px">恢复默认</button>'
      + '<button class="btn btn-primary" id="dub-generate-btn" style="width:100%;padding:12px;font-size:14px;margin-bottom:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> 生成配音</button>'
      + '<button class="btn btn-secondary" id="dub-export-btn" style="width:100%;margin-bottom:12px" disabled><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 导出 WAV</button>'
      + '<div class="error-msg" id="dub-error"></div>'
      + '';
  },

  _bindSidePanel() {
    const keys = [
      { id: 'volume', unit: '%', div: 1, apply: (v) => { if (this._player) this._player.vol = v; } },
      { id: 'speed', unit: 'x', div: 100, apply: (v) => { if (this._player) this._player.spd = v; } },
      { id: 'pitch', unit: '', div: 1, apply: (v) => { if (this._player) this._player.pch = v; } },
      { id: 'cfg', unit: '', div: 10, apply: null },
      { id: 'steps', unit: '', div: 1, apply: null }
    ];
    keys.forEach(k => {
      const sl = document.getElementById('dub-param-' + k.id);
      if (!sl) return;
      sl.addEventListener('input', () => {
        const ve = document.getElementById('dub-param-' + k.id + '-val');
        if (!ve) return;
        const raw = parseInt(sl.value);
        const val = raw / k.div;
        if (k.unit === '%') ve.textContent = raw + '%';
        else if (k.unit === 'x') ve.textContent = val.toFixed(1) + 'x';
        else ve.textContent = k.div === 10 ? val.toFixed(1) : raw;
        if (k.apply) k.apply(raw / k.div);
      });
    });
    document.getElementById('dub-reset-params')?.addEventListener('click', () => {
      const defaults = { volume: 100, speed: 100, pitch: 0, cfg: 20, steps: 10 };
      Object.entries(defaults).forEach(([k, v]) => {
        const sl = document.getElementById('dub-param-' + k);
        if (!sl) return;
        sl.value = v;
        sl.dispatchEvent(new Event('input'));
      });
    });
    document.getElementById('dub-generate-btn')?.addEventListener('click', () => this._generate());
    // 直接用播放器实例的 download()，不再靠 DOM 类名去戳按钮
    document.getElementById('dub-export-btn')?.addEventListener('click', () => {
      if (!this._player || !this._player.hasAudio) return;
      this._stats.dls++;
      this._updateStats();
      this._player.download();
    });
  },

  _bindEvents(ct) {
    this._renderToneChips(ct);
    ct.querySelectorAll('.tone-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const ta = ct.querySelector('#dub-text');
        if (!ta) return;
        const m = chip.dataset.marker;
        ta.value = ta.value.substring(0, ta.selectionStart) + m + ta.value.substring(ta.selectionEnd);
        ta.focus();
        this._updateCharCount();
      });
    });
    ct.querySelector('#dub-text')?.addEventListener('input', () => this._updateCharCount());
    ct.querySelector('#dub-voice-search')?.addEventListener('input', (e) => this._filterCards(e.target.value));
    ct.querySelector('#dub-refresh-presets')?.addEventListener('click', () => this._loadPresets(true));
  },

  _updateCharCount() {
    const ta = document.getElementById('dub-text');
    if (!ta) return;
    const el = document.getElementById('dub-char-count');
    if (el) el.textContent = ta.value.length + ' 字';
  },

  _updateStats() {
    const el = document.getElementById('char-count');
    if (el) el.textContent = this._stats.chars + '字 | ' + this._stats.gens + '次生成 | ' + this._stats.dls + '次下载';
  },

  async _loadPresets(force) {
    // 30s 内已加载过就不重复请求
    if (!force && this._presetsLoaded && Date.now() - this._presetsLoadedAt < 30000) return;
    const ctr = document.getElementById('dub-voice-cards');
    if (ctr && !this._presetsLoaded) ctr.innerHTML = '<span class="text-muted text-sm" style="padding:12px">加载音色中...</span>';
    try {
      this._presets = await API.getPresets();
      this._presetsLoaded = true;
      this._presetsLoadedAt = Date.now();
      this._renderVoiceCards();
    } catch (e) {
      if (ctr) ctr.innerHTML = '<span class="text-muted text-sm" style="padding:12px">加载失败 <a href="#" id="dub-retry-link" style="color:var(--accent)">重试</a></span>';
      document.getElementById('dub-retry-link')?.addEventListener('click', (ev) => { ev.preventDefault(); this._loadPresets(true); });
    }
  },

  _renderVoiceCards() {
    const ctr = document.getElementById('dub-voice-cards');
    if (!ctr) return;
    if (!this._presets.length) { ctr.innerHTML = '<div class="text-muted text-sm" style="padding:12px">暂无音色</div>'; return; }
    ctr.innerHTML = this._presets.map(p => {
      const name = Util.escapeAttr(p.name);
      return '<div class="voice-card' + (this._selectedPreset && this._selectedPreset.name === p.name ? ' selected' : '') + '" data-name="' + name + '">'
        + '<div class="vc-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></div>'
        + '<div class="vc-name">' + Util.escapeHtml(p.name) + '</div><div class="vc-tag">' + Util.escapeHtml(p.desc ? p.desc.substring(0, 12) : '—') + '</div>'
        + (p.voice_file ? '<span class="vc-badge">有声纹</span>' : '')
        + '</div>';
    }).join('');
    ctr.querySelectorAll('.voice-card').forEach(card => {
      card.addEventListener('click', () => {
        const p = this._presets.find(x => x.name === card.dataset.name);
        if (p) this._selectPreset(p);
      });
    });
  },

  _selectPreset(p) {
    this._selectedPreset = p;
    document.querySelectorAll('#dub-voice-cards .voice-card').forEach(c => c.classList.toggle('selected', c.dataset.name === p.name));
    const nameEl = document.getElementById('side-voice-name');
    const metaEl = document.getElementById('side-voice-meta');
    const descEl = document.getElementById('side-voice-desc');
    if (nameEl) nameEl.textContent = p.name;
    if (metaEl) metaEl.textContent = (p.voice_file ? '有声纹 · ' : '无参考 · ') + (p.desc ? p.desc.substring(0, 20) : '标准音色');
    if (descEl) descEl.textContent = p.desc || '';
  },

  _filterCards(q) {
    const query = (q || '').toLowerCase();
    document.querySelectorAll('#dub-voice-cards .voice-card').forEach(c => {
      c.style.display = !query || c.dataset.name.toLowerCase().includes(query) ? '' : 'none';
    });
  },

  async _generate() {
    const text = document.getElementById('dub-text')?.value?.trim();
    if (!text) return this._showError('请输入文本');
    const cfg = parseInt(document.getElementById('dub-param-cfg')?.value || '20') / 10;
    const steps = parseInt(document.getElementById('dub-param-steps')?.value || '10');
    const btn = document.getElementById('dub-generate-btn');
    const restore = btn.innerHTML;
    btn.disabled = true; btn.textContent = '生成中...';
    this._hideError();
    try {
      let result;
      if (this._selectedPreset && this._selectedPreset.voice_file) {
        result = await API.generateClone(text, this._selectedPreset.name, cfg, steps, null, this._selectedPreset.name);
      } else {
        result = await API.generateDesign(text, this._selectedPreset ? this._selectedPreset.name : '无', cfg, steps);
      }
      if (result.blob) {
        await this._player.load(result.blob, null, text.substring(0, 12).replace(/[\\/:*?"<>|]/g, '') + '.wav');
        document.getElementById('dub-result-card').style.display = '';
        document.getElementById('dub-export-btn').disabled = false;
        this._stats.chars += text.length;
        this._stats.gens++;
        this._updateStats();
        // 后端已把这次结果写入历史文件，直接重新拉取即可（单一数据源）
        await this._loadHistory();
      }
    } catch (e) {
      this._showError(e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = restore;
    }
  },

  /* 历史记录：数据源是后端 /api/history/{mode}，前端不再缓存 blob（避免内存泄漏） */
  async _loadHistory() {
    const ctr = document.getElementById('dub-history');
    if (ctr) ctr.innerHTML = '<div class="text-muted text-sm" style="padding:8px">加载中...</div>';
    try {
      const [design, clone] = await Promise.all([
        API.getHistory('design').catch(() => []),
        API.getHistory('clone').catch(() => [])
      ]);
      const merged = []
        .concat((design || []).map(h => ({ ...h, mode: 'design' })))
        .concat((clone || []).map(h => ({ ...h, mode: 'clone' })))
        .filter(h => h && h.audio && h.file_exists !== false)
        .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
        .slice(0, 20);
      this._history = merged;
      this._renderHistory();
    } catch (e) {
      if (ctr) ctr.innerHTML = '<div class="text-muted text-sm" style="padding:8px">历史加载失败</div>';
    }
    this._updateCharCount();
    this._updateStats();
  },

  _renderHistory() {
    const ctr = document.getElementById('dub-history');
    if (!ctr) return;
    if (!this._history.length) { ctr.innerHTML = '<div class="text-muted text-sm" style="padding:8px">暂无记录</div>'; return; }
    ctr.innerHTML = this._history.map((h, i) =>
      '<div class="history-item" data-idx="' + i + '">'
      + '<span class="hi-time">' + Util.escapeHtml(h.time || '--:--:--') + '</span>'
      + '<span class="hi-text" title="' + Util.escapeAttr(h.text || '') + '">' + Util.escapeHtml(h.text || '') + '</span>'
      + '<div class="hi-actions">'
      + '<button class="btn-icon btn-icon-sm hi-play-btn" title="试听"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>'
      + '<button class="btn-icon btn-icon-sm hi-dl-btn" title="下载"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>'
      + '</div></div>'
    ).join('');

    ctr.querySelectorAll('.history-item').forEach(item => {
      const h = this._history[Number(item.dataset.idx)];
      if (!h) return;
      item.querySelector('.hi-play-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this._player.loadUrl(API.getAudioUrl(h.audio), (h.text || 'audio').substring(0, 12) + '.wav');
        document.getElementById('dub-result-card').style.display = '';
        document.getElementById('dub-export-btn').disabled = false;
        this._player.play();
      });
      item.querySelector('.hi-dl-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = API.getDownloadUrl(h.audio);
        a.download = (h.text || 'audio').substring(0, 12) + '.wav';
        document.body.appendChild(a); a.click(); a.remove();
        this._stats.dls++;
        this._updateStats();
      });
    });
  },

  _showError(msg) { const el = document.getElementById('dub-error'); if (el) { el.textContent = msg; el.classList.add('show'); } },
  _hideError() { const el = document.getElementById('dub-error'); if (el) el.classList.remove('show'); },

  onActivate() {
    if (!this._presetsLoaded) this._loadPresets();
    this._updateCharCount();
    this._updateStats();
    setTimeout(() => document.getElementById('dub-text')?.focus(), 100);
  }
};

Object.assign(DubModule, ToastMixin);
