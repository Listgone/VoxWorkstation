/* ========================================
   LibraryModule - Voice Library Management
   ======================================== */

const LibraryModule = {
  _presets: [],

  async init(ct) {
    ct.innerHTML = '<div class="card"><div class="section-title">音色库</div>'
      + '<div class="library-toolbar">'
      + '<input type="text" class="search-input" id="library-search" placeholder="搜索音色或标签...">'
      + '<button class="btn btn-sm btn-secondary" id="library-refresh"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> 刷新</button>'
      + '<button class="btn btn-sm btn-primary" id="library-goto-studio"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 新建音色</button></div>'
      + '<div class="voice-grid" id="library-grid"></div></div>';
    this._bindEvents(ct);
    await this._loadPresets();
  },

  _bindEvents(ct) {
    ct.querySelector('#library-search')?.addEventListener('input', (e) => this._filterCards(e.target.value));
    ct.querySelector('#library-refresh')?.addEventListener('click', () => this._loadPresets());
    ct.querySelector('#library-goto-studio')?.addEventListener('click', () => { App._switchModule('studio'); });
  },

  async _loadPresets() {
    try { this._presets = await API.getPresets(); this._renderCards(); }
    catch (e) { console.error(e); }
  },

  _renderCards() {
    const grid = document.getElementById('library-grid');
    if (!grid) return;
    if (!this._presets.length) {
      grid.innerHTML = '<div class="text-muted text-sm" style="padding:24px;text-align:center">暂无音色，点击"新建音色"前往创建</div>';
      return;
    }
    grid.innerHTML = this._presets.map(p =>
      '<div class="voice-library-card" data-name="' + p.name + '">'
      + '<div class="vlc-header"><div class="vlc-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></div>'
      + '<div><div class="vlc-name">' + p.name + '</div><div class="vlc-desc">' + (p.desc || '无描述') + '</div></div></div>'
      + '<div class="vlc-tags"><span class="vlc-tag">' + (p.voice_file ? '有声纹' : '无参考') + '</span></div>'
      + '<div class="vlc-actions">'
      + '<button class="btn btn-sm btn-ghost vl-edit-btn" data-name="' + p.name + '">编辑</button>'
      + '<button class="btn btn-sm btn-ghost vl-del-btn" data-name="' + p.name + '">删除</button></div></div>'
    ).join('');
    grid.querySelectorAll('.vl-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._editPreset(btn.dataset.name); });
    });
    grid.querySelectorAll('.vl-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._confirmDelete(btn.dataset.name); });
    });
  },

  _confirmDelete(name) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-box"><h3>确认删除</h3>'
      + '<p style="color:var(--text-secondary);margin-bottom:4px">确定要删除音色 <strong>' + name + '</strong> 吗？</p>'
      + '<p class="text-sm text-muted">此操作不可撤销，声纹文件也将一并删除。</p>'
      + '<div class="modal-actions"><button class="btn btn-secondary md-cancel">取消</button><button class="btn btn-danger md-confirm">删除</button></div></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.md-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.md-confirm').addEventListener('click', async () => {
      try { await API.deletePreset(name); close(); await this._loadPresets(); }
      catch (e) { this._toast('删除失败: ' + e.message, true); }
    });
  },

  _editPreset(name) {
    const preset = this._presets.find(p => p.name === name);
    if (!preset) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-box"><h3>编辑音色</h3>'
      + '<div class="form-group"><label class="form-label">音色名称</label><input type="text" id="me-name" value="' + name + '"></div>'
      + '<div class="form-group mt-8"><label class="form-label">音色描述</label><input type="text" id="me-desc" value="' + (preset.desc || '') + '"></div>'
      + '<div class="form-group mt-8"><label class="form-label">替换声纹音频（可选）</label><input type="file" id="me-voice" accept="audio/*"></div>'
      + '<div class="modal-actions"><button class="btn btn-secondary me-cancel">取消</button><button class="btn btn-primary me-save">保存</button></div></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.me-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.me-save').addEventListener('click', async () => {
      const nn = document.getElementById('me-name').value.trim();
      const nd = document.getElementById('me-desc').value.trim();
      const vf = document.getElementById('me-voice').files[0];
      if (!nn) return this._toast('名称不能为空', true);
      try { await API.updatePreset(name, nn, nd, vf); close(); await this._loadPresets(); }
      catch (e) { this._toast('更新失败: ' + e.message, true); }
    });
  },

  _filterCards(query) {
    document.querySelectorAll('#library-grid .voice-library-card').forEach(c => {
      c.style.display = !query || c.dataset.name.toLowerCase().includes(query.toLowerCase()) ? '' : 'none';
    });
  },

  onActivate() { this._loadPresets(); }
};
