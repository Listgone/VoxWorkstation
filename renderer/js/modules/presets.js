/* ══════════════════════════════════════════
   Presets Module — Manage voice presets
   ══════════════════════════════════════════ */

const PresetsModule = {
  _presets: [],

  async init(container) {
    container.innerHTML = this._html();
    this._bindEvents(container);
    await this._load(container);
  },

  _html() {
    return `
      <div class="card">
        <div class="section-title">添加新预设</div>
        <div class="form-row end">
          <div class="form-group grow">
            <span class="form-label">预设名称</span>
            <input type="text" id="preset-add-name" placeholder="例如：温柔女声">
          </div>
          <div class="form-group grow">
            <span class="form-label">音色描述（用于音色设计）</span>
            <input type="text" id="preset-add-desc" placeholder="例如：(温柔女声，清澈)">
          </div>
          <div class="form-group grow">
            <span class="form-label">声纹音频（可选，用于克隆）</span>
            <input type="file" id="preset-add-voice" accept="audio/*">
          </div>
          <button class="btn btn-primary" id="preset-add-btn" style="align-self:flex-end">添加</button>
        </div>
      </div>
      <div class="card">
        <div class="section-title">已保存的预设</div>
        <div class="preset-grid" id="preset-grid"></div>
      </div>

      <!-- Edit Modal -->
      <div class="modal-overlay" id="preset-edit-modal" style="display:none">
        <div class="modal-box">
          <h3>编辑预设</h3>
          <input type="hidden" id="preset-edit-old-name">
          <div class="form-group mb-12">
            <span class="form-label">预设名称</span>
            <input type="text" id="preset-edit-name">
          </div>
          <div class="form-group mb-12">
            <span class="form-label">音色描述</span>
            <input type="text" id="preset-edit-desc">
          </div>
          <div class="form-group mb-12">
            <span class="form-label">替换声纹音频（可选）</span>
            <input type="file" id="preset-edit-voice" accept="audio/*">
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="preset-edit-cancel">取消</button>
            <button class="btn btn-primary" id="preset-edit-save">保存</button>
          </div>
        </div>
      </div>
    `;
  },

  _bindEvents(container) {
    container.querySelector('#preset-add-btn')?.addEventListener('click', () => this._addPreset(container));
    container.querySelector('#preset-edit-cancel')?.addEventListener('click', () => {
      container.querySelector('#preset-edit-modal').style.display = 'none';
    });
    container.querySelector('#preset-edit-save')?.addEventListener('click', () => this._saveEdit(container));

    // Close modal on overlay click
    container.querySelector('#preset-edit-modal')?.addEventListener('click', (e) => {
      if (e.target === container.querySelector('#preset-edit-modal')) {
        container.querySelector('#preset-edit-modal').style.display = 'none';
      }
    });
  },

  async _load(container) {
    try {
      this._presets = await API.getPresets();
      this._render(container);
    } catch (e) {
      console.error('Failed to load presets:', e);
    }
  },

  _render(container) {
    const grid = container.querySelector('#preset-grid');
    if (!grid) return;
    grid.innerHTML = this._presets.map(p => `
      <div class="preset-card">
        <div class="pc-name">
          ${p.name}
          ${p.voice_file ? '<span class="pc-badge">有声纹</span>' : ''}
        </div>
        <div class="pc-desc">${p.desc || '—'}</div>
        <div class="pc-actions">
          <button class="btn btn-sm btn-ghost" data-action="edit" data-name="${p.name}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-action="delete" data-name="${p.name}" style="color:var(--danger)">删除</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => this._openEdit(container, btn.dataset.name));
    });
    grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => this._deletePreset(container, btn.dataset.name));
    });
  },

  _openEdit(container, name) {
    const preset = this._presets.find(p => p.name === name);
    if (!preset) return;
    container.querySelector('#preset-edit-old-name').value = name;
    container.querySelector('#preset-edit-name').value = name;
    container.querySelector('#preset-edit-desc').value = preset.desc || '';
    container.querySelector('#preset-edit-voice').value = '';
    container.querySelector('#preset-edit-modal').style.display = '';
  },

  async _saveEdit(container) {
    const oldName = container.querySelector('#preset-edit-old-name').value;
    const newName = container.querySelector('#preset-edit-name').value.trim();
    const desc = container.querySelector('#preset-edit-desc').value.trim();
    const voiceFile = container.querySelector('#preset-edit-voice').files[0];

    if (!newName) return alert('名称不能为空');
    try {
      await API.updatePreset(oldName, newName, desc, voiceFile || undefined);
      container.querySelector('#preset-edit-modal').style.display = 'none';
      await this._load(container);
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  },

  async _addPreset(container) {
    const name = container.querySelector('#preset-add-name').value.trim();
    const desc = container.querySelector('#preset-add-desc').value.trim();
    const voiceFile = container.querySelector('#preset-add-voice').files[0];

    if (!name) return alert('请输入预设名称');
    try {
      await API.addPreset(name, desc, voiceFile || undefined);
      container.querySelector('#preset-add-name').value = '';
      container.querySelector('#preset-add-desc').value = '';
      container.querySelector('#preset-add-voice').value = '';
      await this._load(container);
    } catch (e) {
      alert('添加失败: ' + e.message);
    }
  },

  async _deletePreset(container, name) {
    if (!confirm(`确定删除预设 "${name}"？`)) return;
    try {
      await API.deletePreset(name);
      await this._load(container);
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }
};
