/* ══════════════════════════════════════════
   工具箱 —— 不离开软件就能处理媒体文件
   目前只有「音频转格式」：选文件 → 选目标格式 → 转换 → 另存
   ══════════════════════════════════════════ */

const ToolsPage = {
  _file: null,
  _busy: false,

  render() {
    return App.head('工具箱', '不离开软件，直接把文件转成需要的格式')
      + '<div class="wrap">'

      + '<div class="card"><h2>音频转格式 <span class="n">另存成新文件，原文件不动</span></h2>'
      + '<div class="form-group"><label class="form-label">音频文件</label>'
      + '<input type="file" id="tl-file" accept="audio/*">'
      + '<p class="text-sm text-muted" id="tl-fileinfo" style="margin:8px 0 0">还没选文件</p>'
      + '</div>'

      + '<div class="toolrow" style="margin-top:14px;gap:18px;flex-wrap:wrap">'
      + '<div><label class="form-label">目标格式</label>'
      + '<select id="tl-fmt" data-sel-center>'
      + ['mp3', 'wav', 'flac', 'm4a'].map(f =>
          '<option value="' + f + '">' + f.toUpperCase() + (f === 'wav' ? '（无损）' : '') + '</option>').join('')
      + '</select></div>'
      + '<div><label class="form-label">码率 <span class="text-sm text-muted">（WAV / FLAC 不适用）</span></label>'
      + '<select id="tl-br" data-sel-center>'
      + [['128k', '128 kbps（小）'], ['192k', '192 kbps（推荐）'], ['256k', '256 kbps'], ['320k', '320 kbps（大）']]
          .map(([v, t]) => '<option value="' + v + '"' + (v === '192k' ? ' selected' : '') + '>' + t + '</option>').join('')
      + '</select></div>'
      + '<div><label class="form-label">采样率</label>'
      + '<select id="tl-sr" data-sel-center>'
      + [['44100', '44100 Hz'], ['48000', '48000 Hz'], ['22050', '22050 Hz'], ['16000', '16000 Hz']]
          .map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('')
      + '</select></div>'
      + '</div>'

      + '<div class="action-row" style="margin-top:18px">'
      + '<button class="btn btn-primary" data-act="convert">开始转换</button>'
      + '<span class="text-sm text-muted" id="tl-state"></span>'
      + '</div>'
      + '<div id="tl-result"></div>'
      + '</div>';
  },

  mount(el) {
    const file = el.querySelector('#tl-file');
    const info = el.querySelector('#tl-fileinfo');
    const state = el.querySelector('#tl-state');
    const btn = el.querySelector('[data-act="convert"]');
    const fmt = el.querySelector('#tl-fmt');
    const br = el.querySelector('#tl-br');
    const result = el.querySelector('#tl-result');

    const syncBr = () => {
      const lossless = fmt.value === 'wav' || fmt.value === 'flac';
      br.disabled = lossless;
      br.parentElement.style.opacity = lossless ? '.45' : '1';
    };
    fmt.addEventListener('change', syncBr);
    syncBr();

    file.addEventListener('change', () => {
      this._file = file.files && file.files[0] ? file.files[0] : null;
      result.innerHTML = '';
      state.textContent = '';
      if (!this._file) { info.textContent = '还没选文件'; return; }
      info.textContent = this._file.name + ' · ' + Util.fmtSize(this._file.size)
        + (this._file.path ? ' · ' + this._file.path : '');
    });

    const setBusy = (b, text) => {
      this._busy = b;
      btn.disabled = b;
      btn.textContent = b ? '转换中…' : '开始转换';
      state.textContent = text || '';
    };

    btn.addEventListener('click', async () => {
      if (this._busy) return;
      if (!this._file) { Toast.error('先选一个音频文件', true); return; }
      const target = fmt.value;
      const bitrate = br.value;
      const sampleRate = Number(el.querySelector('#tl-sr').value) || 44100;
      const sizeBefore = this._file.size;
      setBusy(true, '正在转换…');
      try {
        const res = await API.convertAudio(this._file, target, sampleRate, bitrate);
        if (!res || !res.blob) throw new Error('后端没有返回文件');
        const buf = await res.blob.arrayBuffer();
        const sizeAfter = buf.byteLength;
        const base = this._file.name.replace(/\.[^.]+$/, '');
        const dir = this._file.path ? this._file.path.replace(/[\\/][^\\/]+$/, '') : '';
        const saved = await window.electronAPI.file.save({
          title: '保存转换后的音频',
          defaultName: base + '.' + target,
          dir: dir || '',
          base64: Util.ab2b64(buf)
        });
        if (!saved || !saved.ok) {
          setBusy(false, saved && saved.canceled ? '已取消保存' : ('保存失败：' + ((saved && saved.message) || '未知原因')));
          return;
        }
        setBusy(false, '完成');
        result.innerHTML = '<p class="text-sm" style="margin:12px 0 0">'
          + '已保存：<b>' + Util.escapeHtml(saved.path) + '</b><br>'
          + '体积：' + Util.fmtSize(sizeBefore) + ' → ' + Util.fmtSize(sizeAfter)
          + '　<button class="btn btn-sm" data-act="reveal">打开所在文件夹</button></p>';
        result.querySelector('[data-act="reveal"]')?.addEventListener('click', () => {
          window.electronAPI.path.reveal(saved.path);
        });
        Toast.success('转换完成：' + target.toUpperCase());
      } catch (e) {
        setBusy(false, '失败：' + (e.message || e));
        Toast.error('转换失败：' + (e.message || e), true);
      }
    });
  }
};

