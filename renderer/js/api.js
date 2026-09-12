/* ══════════════════════════════════════════
   API Client — communicates with backend
   ══════════════════════════════════════════ */

const API = (() => {
  let baseUrl = 'http://127.0.0.1:8000';

  // 快速请求（读配置/状态）的超时；生成类请求不设超时（可能跑几分钟）
  const QUICK_TIMEOUT = 15000;

  async function init() {
    if (window.electronAPI) {
      baseUrl = await window.electronAPI.getServerUrl();
    }
  }

  async function request(path, options = {}) {
    const { timeoutMs = 0, ...init } = options;
    const url = `${baseUrl}${path}`;

    let timer = null;
    if (timeoutMs > 0) {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      init.signal = controller.signal;
    }

    let resp;
    try {
      resp = await fetch(url, init);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('请求超时，后端无响应');
      if (e instanceof TypeError) throw new Error('无法连接后端服务');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const err = await resp.json();
        msg = err.error || err.detail || msg;   // 后端两种错误体：{"error":..} / {"detail":..}
      } catch {}
      throw new Error(msg);
    }

    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    if (ct.includes('audio/') || ct.includes('application/zip') || ct.includes('video/')) {
      return { blob: await resp.blob(), type: ct };
    }
    return resp;
  }

  return {
    init,
    get baseUrl() { return baseUrl; },

    // ── Presets ──
    async getPresets() {
      const data = await request('/api/presets', { method: 'POST', timeoutMs: QUICK_TIMEOUT });
      return data.presets || [];
    },
    async addPreset(name, desc, voiceFile) {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('desc', desc || '');
      if (voiceFile) fd.append('voice', voiceFile);
      return request('/api/add_preset', { method: 'POST', body: fd });
    },
    async updatePreset(oldName, newName, desc, voiceFile) {
      const fd = new FormData();
      fd.append('old_name', oldName);
      fd.append('new_name', newName);
      fd.append('desc', desc || '');
      if (voiceFile) fd.append('voice', voiceFile);
      return request('/api/update_preset', { method: 'POST', body: fd });
    },
    async deletePreset(name) {
      const fd = new FormData();
      fd.append('name', name);
      return request('/api/delete_preset', { method: 'POST', body: fd });
    },
    getPresetVoiceUrl(name) {
      return `${baseUrl}/api/preset/voice/${encodeURIComponent(name)}`;
    },

    // ── Generate ──
    async generateDesign(text, style, cfg, steps) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('style', style);
      fd.append('cfg', cfg);
      fd.append('steps', steps);
      return request('/api/generate/design', { method: 'POST', body: fd });
    },
    async generateClone(text, style, cfg, steps, refAudio, voiceProfile) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('style', style);
      fd.append('cfg', cfg);
      fd.append('steps', steps);
      if (refAudio) fd.append('ref_audio', refAudio);
      if (voiceProfile) fd.append('voice_profile', voiceProfile);
      return request('/api/generate/clone', { method: 'POST', body: fd });
    },
    async generateHifi(text, promptAudio, promptText, refAudio, cfg, steps) {
      const fd = new FormData();
      fd.append('text', text);
      fd.append('prompt_audio', promptAudio);
      fd.append('prompt_text', promptText);
      if (refAudio) fd.append('ref_audio', refAudio);
      fd.append('cfg', cfg);
      fd.append('steps', steps);
      return request('/api/generate/hifi', { method: 'POST', body: fd });
    },
    async generateBatch(lines, style, cfg, steps, voiceProfile, refAudio) {
      const fd = new FormData();
      fd.append('lines', lines);
      fd.append('style', style);
      fd.append('cfg', cfg);
      fd.append('steps', steps);
      if (voiceProfile) fd.append('voice_profile', voiceProfile);
      if (refAudio) fd.append('ref_audio', refAudio);
      return request('/api/generate/batch', { method: 'POST', body: fd });
    },
    async generateBatchFile(file, style, cfg, steps, voiceProfile, refAudio) {
      const fd = new FormData();
      fd.append('txt_file', file);
      fd.append('style', style);
      fd.append('cfg', cfg);
      fd.append('steps', steps);
      if (voiceProfile) fd.append('voice_profile', voiceProfile);
      if (refAudio) fd.append('ref_audio', refAudio);
      return request('/api/generate/batch', { method: 'POST', body: fd });
    },

    // ── History（后端已持久化，前端不再自己存 blob）──
    async getHistory(mode) {
      return request(`/api/history/${mode}`, { timeoutMs: QUICK_TIMEOUT });
    },
    getAudioUrl(filename) {
      return `${baseUrl}/api/audio/${encodeURIComponent(filename)}`;
    },
    getDownloadUrl(filename) {
      return `${baseUrl}/api/download/${encodeURIComponent(filename)}`;
    },

    // ── GPU ──
    async getGpuMemory() {
      return request('/api/gpu/memory', { timeoutMs: 5000 });
    },

    // ── Tools（后端已就绪，暂未接入 UI，保留接口）──
    async convertAudio(file, format, sampleRate, bitrate) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target_format', format);
      fd.append('sample_rate', sampleRate);
      fd.append('bitrate', bitrate);
      return request('/api/tools/audio/convert', { method: 'POST', body: fd });
    },
    async convertVideo(file, format, bitrate) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target_format', format);
      fd.append('video_bitrate', bitrate);
      return request('/api/tools/video/convert', { method: 'POST', body: fd });
    },
    async trimAudio(file, start, end) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('start', start);
      fd.append('end', end);
      return request('/api/tools/audio/trim', { method: 'POST', body: fd });
    },
    async mergeAudio(files) {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      return request('/api/tools/audio/merge', { method: 'POST', body: fd });
    },
    async extractAudio(file, format) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target_format', format);
      return request('/api/tools/audio/extract', { method: 'POST', body: fd });
    },
    async adjustVolume(file, db) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('db', db);
      return request('/api/tools/audio/volume', { method: 'POST', body: fd });
    }
  };
})();
