/* ========================================
   StudioModule — Voice Design, Clone, HiFi Clone
   ======================================== */

const StudioModule = {
  _presets: [],
  _players: {},
  _blobs: {},
  _presetsLoadedAt: 0,

  async init(ct) {
    ct.innerHTML = this._html();
    this._bindEvents(ct);
    this._players.design = AudioPlayer.create('studio-design-player');
    this._players.clone = AudioPlayer.create('studio-clone-player');
    this._players.hifi = AudioPlayer.create('studio-hifi-player');
    await this._loadPresets(true);
  },

  _html() {
    return '<div class="tabs" id="studio-tabs">'
      + '<button class="tab-btn active" data-mode="design">音色设计</button>'
      + '<button class="tab-btn" data-mode="clone">可控克隆</button>'
      + '<button class="tab-btn" data-mode="hifi">极致克隆</button></div>'
      + '<div id="studio-panel-design">'
      + '<div class="card"><div class="section-title">描述音色</div>'
      + '<textarea id="studio-design-text" rows="2" placeholder="描述你想要的音色，如：温柔的女声，语速中等"></textarea>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">风格预设</label><select id="studio-design-style"></select></div></div></div>'
      + '<div class="card"><div class="section-title">参数</div><div class="param-grid">'
      + '<div class="param-group"><label>稳定性</label><input type="range" id="studio-design-cfg" min="10" max="30" value="20"><span class="param-val" id="studio-design-cfg-val">2.0</span></div>'
      + '<div class="param-group"><label>质量</label><input type="range" id="studio-design-steps" min="5" max="30" value="10"><span class="param-val" id="studio-design-steps-val">10</span></div></div>'
      + '<div class="mt-12" style="display:flex;gap:8px">'
      + '<button class="btn btn-primary" id="studio-design-generate">生成试听</button>'
      + '<button class="btn btn-secondary" id="studio-design-save" disabled>保存到音色库</button></div>'
      + '<div class="error-msg" id="studio-design-error"></div>'
      + '<div class="card mt-8" id="studio-design-result" style="display:none"><div class="section-title">试听结果</div><div id="studio-design-player"></div></div></div></div>'
      + '<div id="studio-panel-clone" style="display:none">'
      + '<div class="card"><div class="section-title">可控克隆</div>'
      + '<textarea id="studio-clone-text" rows="2" placeholder="输入测试文本，如：你好，这是我的声音克隆测试。"></textarea>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">参考音频</label><input type="file" id="studio-clone-ref" accept="audio/*"></div></div>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">风格预设</label><select id="studio-clone-style"></select></div></div></div>'
      + '<div class="card"><div class="section-title">参数</div><div class="param-grid">'
      + '<div class="param-group"><label>稳定性</label><input type="range" id="studio-clone-cfg" min="10" max="30" value="20"><span class="param-val" id="studio-clone-cfg-val">2.0</span></div>'
      + '<div class="param-group"><label>质量</label><input type="range" id="studio-clone-steps" min="5" max="30" value="10"><span class="param-val" id="studio-clone-steps-val">10</span></div></div>'
      + '<div class="mt-12" style="display:flex;gap:8px">'
      + '<button class="btn btn-primary" id="studio-clone-generate">生成试听</button>'
      + '<button class="btn btn-secondary" id="studio-clone-save" disabled>保存到音色库</button></div>'
      + '<div class="error-msg" id="studio-clone-error"></div>'
      + '<div class="card mt-8" id="studio-clone-result" style="display:none"><div class="section-title">试听结果</div><div id="studio-clone-player"></div></div></div></div>'
      + '<div id="studio-panel-hifi" style="display:none">'
      + '<div class="card"><div class="section-title">极致克隆</div>'
      + '<textarea id="studio-hifi-text" rows="2" placeholder="输入要合成的文本..."></textarea>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">Prompt 音频（必须）</label><input type="file" id="studio-hifi-prompt-audio" accept="audio/*"></div></div>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">Prompt 文本（必须）</label><input type="text" id="studio-hifi-prompt-text" placeholder="音频对应的文本内容"></div></div>'
      + '<div class="form-row mt-8"><div class="form-group grow"><label class="form-label">Reference 音频（可选）</label><input type="file" id="studio-hifi-ref-audio" accept="audio/*"></div></div></div>'
      + '<div class="card"><div class="section-title">参数</div><div class="param-grid">'
      + '<div class="param-group"><label>稳定性</label><input type="range" id="studio-hifi-cfg" min="10" max="30" value="20"><span class="param-val" id="studio-hifi-cfg-val">2.0</span></div>'
      + '<div class="param-group"><label>质量</label><input type="range" id="studio-hifi-steps" min="5" max="30" value="10"><span class="param-val" id="studio-hifi-steps-val">10</span></div></div>'
      + '<div class="mt-12" style="display:flex;gap:8px">'
      + '<button class="btn btn-primary" id="studio-hifi-generate">生成试听</button>'
      + '<button class="btn btn-secondary" id="studio-hifi-save" disabled>保存到音色库</button></div>'
      + '<div class="error-msg" id="studio-hifi-error"></div>'
      + '<div class="card mt-8" id="studio-hifi-result" style="display:none"><div class="section-title">试听结果</div><div id="studio-hifi-player"></div></div></div></div>';
  },

  _bindEvents(ct) {
    ct.querySelectorAll('#studio-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ct.querySelectorAll('#studio-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ['design', 'clone', 'hifi'].forEach(m => {
          const panel = document.getElementById('studio-panel-' + m);
          if (panel) panel.style.display = btn.dataset.mode === m ? '' : 'none';
        });
      });
    });
    ['design', 'clone', 'hifi'].forEach(m => {
      ['cfg', 'steps'].forEach(k => {
        const el = document.getElementById('studio-' + m + '-' + k);
        el?.addEventListener('input', () => {
          const v = document.getElementById('studio-' + m + '-' + k + '-val');
          if (v) v.textContent = k === 'cfg' ? (parseInt(el.value) / 10).toFixed(1) : el.value;
        });
      });
      document.getElementById('studio-' + m + '-generate')?.addEventListener('click', () => {
        if (m === 'design') this._generateDesign();
        else if (m === 'clone') this._generateClone();
        else this._generateHifi();
      });
      document.getElementById('studio-' + m + '-save')?.addEventListener('click', () => this._promptSave(m));
    });
  },

  _sErr(m, msg) { const el = document.getElementById('studio-' + m + '-error'); if (el) { el.textContent = msg; el.classList.add('show'); } },
  _hErr(m) { const el = document.getElementById('studio-' + m + '-error'); if (el) el.classList.remove('show'); },

  _promptSave(mode) {
    const blob = this._blobs[mode];
    if (!blob || blob.size === 0) { this._toast('请先生成音频', true); return; }
    const descText = document.getElementById('studio-' + mode + '-text')?.value?.trim() || '';
    const style = document.getElementById('studio-' + mode + '-style')?.value || '';
    const defDesc = (style && style !== '无' ? style + ': ' : '')
      + (descText || (mode === 'design' ? '音色设计' : (mode === 'clone' ? '可控克隆' : '极致克隆')));

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // 注意：这里必须转义，否则描述里出现一个 " 就会截断 value 属性
    overlay.innerHTML = '<div class="modal-box"><h3>保存到音色库</h3>'
      + '<div class="form-group"><label class="form-label">音色名称</label><input type="text" id="sv-name" placeholder="输入音色名称"></div>'
      + '<div class="form-group mt-8"><label class="form-label">音色描述</label><input type="text" id="sv-desc" value="' + Util.escapeAttr(defDesc) + '"></div>'
      + '<div class="modal-actions"><button class="btn btn-secondary sv-cancel">取消</button><button class="btn btn-primary sv-confirm">保存</button></div></div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.sv-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.sv-confirm').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const nameInput = document.getElementById('sv-name');
      const descInput = document.getElementById('sv-desc');
      const name = nameInput.value.trim();
      const desc = descInput.value.trim();
      if (!name) { this._toast('请输入音色名称', true); nameInput.focus(); return; }
      btn.disabled = true;
      btn.textContent = '保存中(' + Math.round(blob.size / 1024) + 'KB)...';
      const timer = setTimeout(() => { btn.textContent = '仍在保存...'; }, 5000);
      try {
        await API.addPreset(name, desc, new File([blob], name + '.wav', { type: 'audio/wav' }));
        clearTimeout(timer);
        close();
        this._toast('已保存到音色库：' + name);
        this._loadPresets(true);
      } catch (err) {
        clearTimeout(timer);
        btn.disabled = false;
        btn.textContent = '保存';
        this._toast('保存失败：' + (err.message || '未知错误'), true);
      }
    });
  },

  /** 生成结果统一处理：去掉多余的 Blob 拷贝，只改 MIME 类型 */
  _acceptResult(mode, blob) {
    this._blobs[mode] = blob.slice(0, blob.size, 'audio/wav');
    const panel = document.getElementById('studio-' + mode + '-result');
    const saveBtn = document.getElementById('studio-' + mode + '-save');
    if (panel) panel.style.display = '';
    if (saveBtn) saveBtn.disabled = false;
  },

  async _generateDesign() {
    const text = document.getElementById('studio-design-text').value.trim();
    if (!text) return this._sErr('design', '请输入音色描述');
    const style = document.getElementById('studio-design-style').value;
    const cfg = parseInt(document.getElementById('studio-design-cfg').value) / 10;
    const steps = parseInt(document.getElementById('studio-design-steps').value);
    const btn = document.getElementById('studio-design-generate');
    btn.disabled = true; btn.textContent = '生成中...';
    this._hErr('design');
    try {
      const r = await API.generateDesign(text, style, cfg, steps);
      if (r.blob) {
        this._acceptResult('design', r.blob);
        await this._players.design.load(r.blob);
      }
    } catch (e) { this._sErr('design', e.message); }
    finally { btn.disabled = false; btn.textContent = '生成试听'; }
  },

  async _generateClone() {
    const text = document.getElementById('studio-clone-text').value.trim();
    if (!text) return this._sErr('clone', '请输入测试文本');
    const refFile = document.getElementById('studio-clone-ref').files[0];
    if (!refFile) return this._sErr('clone', '请上传参考音频');
    const style = document.getElementById('studio-clone-style').value;
    const cfg = parseInt(document.getElementById('studio-clone-cfg').value) / 10;
    const steps = parseInt(document.getElementById('studio-clone-steps').value);
    const btn = document.getElementById('studio-clone-generate');
    btn.disabled = true; btn.textContent = '生成中...';
    this._hErr('clone');
    try {
      const r = await API.generateClone(text, style, cfg, steps, refFile, '');
      if (r.blob) {
        this._acceptResult('clone', r.blob);
        await this._players.clone.load(r.blob);
      }
    } catch (e) { this._sErr('clone', e.message); }
    finally { btn.disabled = false; btn.textContent = '生成试听'; }
  },

  async _generateHifi() {
    const text = document.getElementById('studio-hifi-text').value.trim();
    if (!text) return this._sErr('hifi', '请输入文本');
    const pf = document.getElementById('studio-hifi-prompt-audio').files[0];
    const pt = document.getElementById('studio-hifi-prompt-text').value.trim();
    if (!pf || !pt) return this._sErr('hifi', '请提供 Prompt 音频和文本');
    const ref = document.getElementById('studio-hifi-ref-audio').files[0];
    const cfg = parseInt(document.getElementById('studio-hifi-cfg').value) / 10;
    const steps = parseInt(document.getElementById('studio-hifi-steps').value);
    const btn = document.getElementById('studio-hifi-generate');
    btn.disabled = true; btn.textContent = '生成中...';
    this._hErr('hifi');
    try {
      const r = await API.generateHifi(text, pf, pt, ref || undefined, cfg, steps);
      if (r.blob) {
        this._acceptResult('hifi', r.blob);
        await this._players.hifi.load(r.blob);
      }
    } catch (e) { this._sErr('hifi', e.message); }
    finally { btn.disabled = false; btn.textContent = '生成试听'; }
  },

  async _loadPresets(force) {
    if (!force && this._presets.length && Date.now() - this._presetsLoadedAt < 30000) return;
    try {
      this._presets = await API.getPresets();
      this._presetsLoadedAt = Date.now();
      this._renderStyleOptions();
    } catch (e) { /* 下拉框留空即可，不打断主流程 */ }
  },

  _renderStyleOptions() {
    const opts = this._presets
      .map(p => '<option value="' + Util.escapeAttr(p.name) + '">' + Util.escapeHtml(p.name) + '</option>')
      .join('');
    ['studio-design-style', 'studio-clone-style'].forEach(id => {
      const sel = document.getElementById(id);
      if (sel) sel.innerHTML = opts;
    });
  },

  onActivate() { this._loadPresets(false); }
};

Object.assign(StudioModule, ToastMixin);
