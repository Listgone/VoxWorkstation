/* ══════════════════════════════════════════
   设置 —— 软件层面的配置（11 个分组）
   ══════════════════════════════════════════ */

/* OpenAI 兼容服务商预设 —— 换服务商只改这里的 baseURL 与模型 */
const AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek',    sub: '中文最准 · 便宜 · 国内直连',
    base: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'qwen',     name: '通义千问',    sub: '阿里云 DashScope',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'] },
  { id: 'kimi',     name: 'Kimi',        sub: '超长上下文 · 长剧本',
    base: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'] },
  { id: 'zhipu',    name: '智谱 GLM',    sub: '清华系',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'] },
  { id: 'silicon',  name: '硅基流动',    sub: '聚合多家开源模型',
    base: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'] },
  { id: 'openai',   name: 'OpenAI',      sub: '需要能访问境外',
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'] },
  { id: 'ollama',   name: '本地 Ollama', sub: '数据不出网 · 需先 ollama pull',
    base: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b'] },
  { id: 'custom',   name: '自定义',      sub: '任意 OpenAI 兼容端点',
    base: '', models: [] }
];

const SettingsPage = {
  _sec: 'appearance',

  _SECTIONS: [
    ['appearance', '外观与主题'],
    ['ai',         'AI 服务'],
    ['tts',        'TTS 引擎'],
    ['output',     '音频输出'],
    ['dict',       '发音词典'],
    ['project',    '项目与存储'],
    ['shortcut',   '快捷键'],
    ['notify',     '通知'],
    ['privacy',    '数据与隐私'],
    ['about',      '诊断与关于']
  ],

  render() {
    const s = Store.settings;
    return App.head('设置', '外观 · AI 服务 · 引擎 · 输出 · 隐私…',
        '<span class="pill pill-ok">已保存</span>')
      + '<div class="setwrap">'
      + '<nav class="subnav">' + this._SECTIONS.map(([id, label]) =>
          '<a data-sec="' + id + '"' + (id === this._sec ? ' class="on"' : '') + '>' + label + '</a>').join('')
      + '</nav><div>' + this._section(s) + '</div></div>';
  },

  _section(s) {
    switch (this._sec) {
      case 'appearance': return this._appearance(s);
      case 'ai':         return this._ai(s);
      case 'tts':        return this._tts(s);
      case 'output':     return this._output(s);
      case 'dict':       return this._dict();
      case 'project':    return this._project(s);
      case 'shortcut':   return this._shortcut();
      case 'notify':     return this._notify(s);
      case 'privacy':    return this._privacy(s);
      case 'about':      return this._about(s);
    }
    return '';
  },

  _row(label, hint, control) {
    return '<div class="srow"><div class="l"><b>' + label + '</b><span>' + hint + '</span></div>' + control + '</div>';
  },

  _sw(on, act) { return '<label class="sw' + (on ? '' : ' off') + '" data-act="' + act + '"></label>'; },

  _appearance(s) {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const TH = [
      ['light', '明亮现代', '默认 · 干净 · 无动效', 'thprev-a'],
      ['bento', 'Bento 看板', '深色 + 柠檬绿 · 跨格便当盒', 'thprev-b2'],
      ['glass', '液态玻璃', '毛玻璃 + 彩色光斑', 'thprev-g'],
      ['construct', '构成主义', '粗边分格 + 苏式红', 'thprev-c']
    ];
    const mono = App.monoInfo || { ok: false, fallback: '检测中…' };
    const isMono = (s.font === 'mono' || s.font === 'monovar');
    return '<div class="card"><h2>外观与主题</h2>'
      + '<div class="themes">'
      + TH.map(([id, name, sub, prev]) =>
          '<div class="th' + (theme === id ? ' on' : '') + '" data-theme-pick="' + id + '">'
          + '<div class="thprev ' + prev + '"></div><b>' + name + '</b><span>' + sub + '</span></div>').join('')
      + '</div>'
      + this._row('字体', '两个 JetBrains Mono 都已内置（随应用分发，无需系统安装）',
          '<div class="model-chips" id="font-chips">'
          + '<button type="button" class="mchip' + (!isMono ? ' on' : '') + '" data-font="system">系统默认</button>'
          + '<button type="button" class="mchip' + (s.font === 'mono' ? ' on' : '') + '" data-font="mono">JetBrains Mono 特粗斜体</button>'
          + '<button type="button" class="mchip' + (s.font === 'monovar' ? ' on' : '') + '" data-font="monovar">JetBrains Mono 常规</button>'
          + '</div>'
          + (isMono ? '<span class="text-sm text-muted" style="margin-left:10px">'
              + (mono.ok ? '✓ 已加载' : '✕ 加载失败，回退到 ' + Util.escapeHtml(mono.fallback))
              + '</span>' : ''))
      + this._row('界面缩放', '高分屏可调大（立即生效）',
          '<select id="s-scale" style="width:120px">'
          + [1, 1.1, 1.25].map(v => '<option value="' + v + '"' + (Number(s.uiScale) === v ? ' selected' : '') + '>'
              + Math.round(v * 100) + '%</option>').join('') + '</select>')
      + this._row('界面语言', '目前仅简体中文',
          '<select style="width:150px"><option>简体中文</option></select>')
      + this._row('减少动效', '关闭光斑游动与卡片入场动画，省电',
          this._sw(!s.reduceMotion, 'toggle-motion'))
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-appearance">保存</button></div>'
      + '</div>';
  },

  _ai(s) {
    const ai = s.ai || {};
    const cur = AI_PROVIDERS.find(x => x.id === ai.provider) || AI_PROVIDERS[0];
    const models = cur.models || [];
    const isCustomModel = !!ai.model && models.length > 0 && !models.includes(ai.model);
    return '<div class="card"><h2>AI 服务 <span class="n">'
      + (Store.hasApiKey ? '已配置 Key' + (Store.keyEncrypted ? '（加密存储）' : '（未加密）') : '未配置 Key')
      + '</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-6px 0 10px">'
      + '所有服务商都走 OpenAI 兼容接口。选一个会自动填好地址与模型，也可以手改。</p>'
      + '<div class="themes" style="flex-wrap:wrap;margin-bottom:6px">'
      + AI_PROVIDERS.map(p =>
          '<div class="th' + (ai.provider === p.id ? ' on' : '') + '" data-provider="' + p.id + '" style="width:164px">'
          + '<b>' + p.name + '</b><span>' + p.sub + '</span></div>').join('')
      + '</div>'
      + this._row('接口地址', 'OpenAI 兼容 baseURL，末尾不用带 /chat/completions',
          '<input type="text" id="ai-base" value="' + Util.escapeAttr(ai.baseURL || cur.base) + '" style="width:340px">')
      + this._row('模型', '点选即用，也可以选「自定义」手填',
          '<div class="model-chips" id="ai-models">'
          + models.map(m => '<button type="button" class="mchip' + (ai.model === m ? ' on' : '')
              + '" data-model="' + Util.escapeAttr(m) + '">' + Util.escapeHtml(m) + '</button>').join('')
          + '<button type="button" class="mchip' + (isCustomModel || !models.length ? ' on' : '')
          + '" data-model="__custom__">自定义…</button>'
          + '</div>'
          + '<input type="text" id="ai-model" value="' + Util.escapeAttr(ai.model || '') + '" style="width:230px;'
          + (isCustomModel || !models.length ? '' : 'display:none') + '" placeholder="手填模型名">')
      + this._row('视觉模型（OCR）', '图片取字用，留空则关闭该功能',
          '<input type="text" id="ai-vision" value="' + Util.escapeAttr(ai.visionModel || '') + '" placeholder="如 qwen-vl-max" style="width:220px">')
      + this._row('API Key', '用系统凭据加密存储，不落明文',
          '<input type="password" id="ai-key" placeholder="' + (Store.hasApiKey ? '已保存（留空则不修改）' : 'sk-…') + '" style="width:240px">'
          + '<button class="btn btn-sm" data-act="test">测试连接</button>')
      + this._row('超时 / 重试', '长文本处理建议调大超时',
          '<input type="number" id="ai-timeout" value="' + (ai.timeoutSec || 60) + '" style="width:74px"><span class="text-sm text-muted">秒</span>'
          + '<input type="number" id="ai-retries" value="' + (ai.retries || 2) + '" style="width:66px"><span class="text-sm text-muted">次</span>')
      + this._row('单次处理上限', '超长文本自动分段调用，避免超上下文',
          '<input type="number" id="ai-max" value="' + (ai.maxCharsPerCall || 4000) + '" style="width:96px"><span class="text-sm text-muted">字</span>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-ai">保存</button>'
      + '<button class="btn" data-act="test2">测试连接</button>'
      + '<span class="text-sm text-muted" id="ai-test-result"></span></div>'
      + '</div>';
  },

  _tts(s) {
    const t = s.tts || {};
    const cfg = window.__voxConfig || {};
    return '<div class="card"><h2>TTS 引擎</h2>'
      + this._row('自动启动后端', '打开软件时自动拉起 VoxCPM2', this._sw(t.autoStart !== false, 'toggle-tts'))
      + this._row('服务地址', '由主进程按端口配置生成', '<input type="text" value="' + Util.escapeHtml(API.baseUrl) + '" readonly style="width:280px">')
      + this._row('后端目录 / Python', Util.escapeHtml((cfg.serverDir || '—') + ' · ' + (cfg.pythonPath || '—')),
          '<button class="btn btn-sm" data-act="reveal-config">打开配置目录</button>')
      + this._row('默认稳定性 / 质量', '新建集时的初始值（项目设置里可覆盖）',
          '<span class="text-sm text-muted">在「项目设置 → 默认参数」里配置</span>')
      + this._row('显存告警阈值', '超过时在状态栏变黄提醒',
          '<input type="number" id="tts-vram" value="' + (t.vramWarnPct || 90) + '" style="width:80px"><span class="text-sm text-muted">%</span>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-tts">保存</button></div>'
      + '</div>';
  },

  _output(s) {
    const o = s.output || {};
    return '<div class="card"><h2>音频输出</h2>'
      + this._row('输出根目录', Util.escapeHtml(o.root || ''), '<button class="btn btn-sm" data-act="pick-root">更改</button>')
      + this._row('默认格式 / 采样率', '整轨导出用',
          '<select id="o-fmt" style="width:160px">'
          + [['wav', 'WAV（无损）'], ['mp3', 'MP3 192k'], ['flac', 'FLAC']]
              .map(([v, t]) => '<option value="' + v + '"' + (o.format === v ? ' selected' : '') + '>' + t + '</option>').join('')
          + '</select>'
          + '<select id="o-sr" style="width:130px">'
          + [44100, 22050, 48000].map(v => '<option value="' + v + '"' + (Number(o.sampleRate) === v ? ' selected' : '') + '>' + v + ' Hz</option>').join('')
          + '</select>')
      + this._row('默认句间停顿', '逐句拼接时的静音长度',
          '<input type="number" id="o-pause" value="' + (o.pauseMs || 300) + '" style="width:90px"><span class="text-sm text-muted">ms</span>')
      + this._row('文件命名规则', '可用占位符：{no} 序号 {role} 角色 {text} 台词前几字 {ep} 集号 {voice} 音色',
          '<input type="text" id="o-naming" value="' + Util.escapeAttr(o.naming || '{no}_{role}_{text}') + '" style="width:250px">')
      + this._row('导出时同时生成 SRT', '按真实时长生成时间轴', this._sw(o.exportSrt !== false, 'toggle-srt'))
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-output">保存</button></div>'
      + '</div>';
  },

  _dict() {
    const p = Store.currentProject;
    if (!p) {
      return '<div class="card"><h2>发音词典</h2>'
        + '<p class="text-sm text-muted" style="margin:0">词典是<b>项目级</b>的，先选一个项目。'
        + '全局词典以后再加。</p></div>';
    }
    return '<div class="card"><h2>发音词典 <span class="n">项目：' + Util.escapeHtml(p.name) + '</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-6px 0 12px">某个词永远读对。在「项目设置 → 项目词典」里维护。</p>'
      + ((p.dict || []).length
        ? '<table><tr><th style="width:150px">词</th><th>读法</th></tr>'
          + p.dict.map(d => '<tr><td>' + Util.escapeHtml(d.word) + '</td><td>' + Util.escapeHtml(d.reading) + '</td></tr>').join('')
          + '</table>'
        : '<p class="text-sm text-muted">还没有词条。</p>')
      + '<button class="btn btn-sm mt-12" data-act="goto-dict">去项目设置维护 →</button>'
      + '</div>';
  },

  _project(s) {
    const pr = s.project || {};
    return '<div class="card"><h2>项目与存储</h2>'
      + this._row('默认项目位置', '新建项目放这里', '<span class="text-sm text-muted">' + Util.escapeHtml(s.output.root) + '</span>')
      + this._row('自动保存间隔', '编辑台词时的落盘频率（当前为手动保存 + 生成时落盘）',
          '<input type="number" id="p-auto" value="' + (pr.autoSaveSec || 30) + '" style="width:80px"><span class="text-sm text-muted">秒</span>')
      + this._row('崩溃恢复', '重开软件时自动回到上次编辑的项目与集', '<span class="pill pill-ok">已开启</span>')
      + this._row('回收站', '删除的项目/集进 .trash，可手动恢复',
          '<button class="btn btn-sm" data-act="open-trash">打开回收站</button>')
      + '<div class="action-row mt-12"><button class="btn btn-primary" data-act="save-project">保存</button></div>'
      + '</div>';
  },

  _shortcut() {
    const keys = Shortcuts.LIST;
    return '<div class="card"><h2>快捷键 <span class="n">全局生效</span></h2>'
      + '<table><tr><th style="width:190px">按键</th><th>功能</th></tr>'
      + keys.map(([k, v]) => '<tr><td><code>' + Util.escapeHtml(k) + '</code></td><td>' + Util.escapeHtml(v) + '</td></tr>').join('')
      + '</table></div>';
  },

  _notify(s) {
    const n = s.notify || {};
    return '<div class="card"><h2>通知</h2>'
      + this._row('生成完成时提醒', '批量生成耗时较长', this._sw(n.onDone !== false, 'toggle-done'))
      + this._row('生成失败时提醒', '失败句子会在集管理里标红', this._sw(n.onFail !== false, 'toggle-fail'))
      + '</div>';
  },

  _privacy(s) {
    const p = s.privacy || {};
    return '<div class="card"><h2>数据与隐私</h2>'
      + this._row('AI 请求前脱敏', '发送前替换人名 / 电话 / 地址等敏感信息', this._sw(p.redact, 'toggle-redact'))
      + this._row('仅发送当前段落', '关闭后整篇发送，上下文更准但更贵', this._sw(p.onlyCurrentParagraph !== false, 'toggle-onlycur'))
      + this._row('本地保存处理记录', '保存 AI 处理的 diff 历史，便于回溯', this._sw(p.keepDiffHistory !== false, 'toggle-diff'))
      + '<p class="text-sm text-muted mt-12">所有音频、文本、音色都保存在本机项目文件夹，不会上传到任何服务器。'
      + '只有你主动点「AI 处理」时，文本才会发给你配置的服务商。</p>'
      + '</div>';
  },

  _about(s) {
    const cfg = window.__voxConfig || {};
    return '<div class="card"><h2>诊断与关于</h2>'
      + this._row('后端服务', Util.escapeHtml(API.baseUrl) + ' · ' + Util.escapeHtml(cfg.serverDir || ''), '')
      + this._row('配置目录', Util.escapeHtml(Store.userData || ''),
          '<button class="btn btn-sm" data-act="open-userdata">打开</button>')
      + this._row('查看后端日志', '最近 200 行，排查生成失败用',
          '<button class="btn btn-sm" data-act="show-log">查看</button>')
      + this._row('VoxWorkstation v1.0.0', 'VoxCPM2 引擎 · Electron', '')
      + '</div>';
  },

  async mount(el) {
    el.querySelectorAll('[data-sec]').forEach(a =>
      a.addEventListener('click', () => { this._sec = a.dataset.sec; App.go('settings'); }));

    const s = Store.settings;
    const save = async (patch, msg) => {
      const r = await Store.saveSettings(patch);
      if (r && r.ok) { Toast.success(msg || '已保存'); App.go('settings'); }
      else Toast.error(r && r.message || '保存失败', true);
    };

    /* 主题 */
    el.querySelectorAll('[data-theme-pick]').forEach(t =>
      t.addEventListener('click', () => {
        App.applyTheme(t.dataset.themePick);
        App.go('settings');
      }));

    /* 字体 */
    el.querySelectorAll('#font-chips [data-font]').forEach(c =>
      c.addEventListener('click', async () => {
        App.applyFont(c.dataset.font);
        if (c.dataset.font === 'mono') await App.detectMonoFont();
        App.go('settings');
      }));

    el.querySelector('[data-act="save-appearance"]')?.addEventListener('click', async () => {
      const scale = Number(el.querySelector('#s-scale').value);
      document.body.style.zoom = scale === 1 ? '' : String(scale);
      await save({ uiScale: scale }, '外观已保存');
    });

    /* 开关类 */
    const toggle = (act, apply) => {
      el.querySelector('[data-act="' + act + '"]')?.addEventListener('click', (e) => {
        const on = e.currentTarget.classList.contains('off');   // 当前是 off → 点后为 on
        e.currentTarget.classList.toggle('off', !on);
        apply(on);
      });
    };
    toggle('toggle-motion',   v => save({ reduceMotion: !v }));
    toggle('toggle-tts',      v => save({ tts: { ...s.tts, autoStart: v } }));
    toggle('toggle-srt',      v => save({ output: { ...s.output, exportSrt: v } }));
    toggle('toggle-done',     v => save({ notify: { ...s.notify, onDone: v } }));
    toggle('toggle-fail',     v => save({ notify: { ...s.notify, onFail: v } }));
    toggle('toggle-redact',   v => save({ privacy: { ...s.privacy, redact: v } }));
    toggle('toggle-onlycur',  v => save({ privacy: { ...s.privacy, onlyCurrentParagraph: v } }));
    toggle('toggle-diff',     v => save({ privacy: { ...s.privacy, keepDiffHistory: v } }));

    /* 服务商选择 → 自动填地址，模型变成可点的 chips */
    let pickedProvider = (s.ai || {}).provider || 'deepseek';
    const fillProvider = (id) => {
      const p = AI_PROVIDERS.find(x => x.id === id) || AI_PROVIDERS[0];
      const baseEl = el.querySelector('#ai-base');
      if (baseEl && p.base) baseEl.value = p.base;
      const wrap = el.querySelector('#ai-models');
      const inp = el.querySelector('#ai-model');
      if (!wrap || !inp) return;
      wrap.innerHTML = (p.models || []).map(m =>
          '<button type="button" class="mchip" data-model="' + Util.escapeAttr(m) + '">' + Util.escapeHtml(m) + '</button>').join('')
        + '<button type="button" class="mchip on" data-model="__custom__">自定义…</button>';
      if ((p.models || []).length) {
        wrap.querySelector('.mchip').classList.add('on');
        wrap.querySelector('[data-model="__custom__"]').classList.remove('on');
        inp.value = p.models[0];
        inp.style.display = 'none';
      } else {
        inp.style.display = '';
        inp.value = '';
        inp.focus();
      }
      bindChips();
    };
    const bindChips = () => {
      const wrap = el.querySelector('#ai-models');
      const inp = el.querySelector('#ai-model');
      wrap?.querySelectorAll('.mchip').forEach(c =>
        c.addEventListener('click', () => {
          wrap.querySelectorAll('.mchip').forEach(x => x.classList.toggle('on', x === c));
          if (c.dataset.model === '__custom__') { inp.style.display = ''; inp.focus(); }
          else { inp.style.display = 'none'; inp.value = c.dataset.model; }
        }));
    };
    bindChips();
    el.querySelectorAll('[data-provider]').forEach(b =>
      b.addEventListener('click', () => {
        pickedProvider = b.dataset.provider;
        el.querySelectorAll('[data-provider]').forEach(x => x.classList.toggle('on', x === b));
        fillProvider(pickedProvider);
      }));
    el.querySelector('#ai-model')?.addEventListener('input', (e) => {
      const wrap = el.querySelector('#ai-models');
      wrap?.querySelectorAll('.mchip').forEach(x =>
        x.classList.toggle('on', x.dataset.model === '__custom__'
          || (![...(wrap.querySelectorAll('.mchip'))].some(c => c.dataset.model === e.target.value))));
    });

    const doTest = async (btn) => {
      const out = el.querySelector('#ai-test-result');
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '测试中…';
      if (out) out.textContent = '';
      try {
        const r = await window.electronAPI.ai.test();
        if (out) out.textContent = (r.ok ? '✓ ' : '✕ ') + r.message + (r.reply ? '（' + r.reply + '）' : '');
        if (r.ok) Toast.success('AI 连接正常'); else Toast.error('连接失败：' + r.message, true);
      } catch (e) {
        if (out) out.textContent = '✕ ' + e.message;
        Toast.error('连接失败：' + e.message, true);
      } finally { btn.disabled = false; btn.textContent = old; }
    };
    el.querySelector('[data-act="test"]')?.addEventListener('click', (e) => doTest(e.currentTarget));
    el.querySelector('[data-act="test2"]')?.addEventListener('click', (e) => doTest(e.currentTarget));

    el.querySelector('[data-act="save-ai"]')?.addEventListener('click', async () => {
      const key = el.querySelector('#ai-key').value.trim();
      if (key) {
        const r = await window.electronAPI.settings.setApiKey(key);
        if (r && r.ok) {
          Store.hasApiKey = true; Store.keyEncrypted = r.encrypted;
          el.querySelector('#ai-key').value = '';
        }
      }
      await save({
        ai: {
          provider: pickedProvider,
          baseURL: el.querySelector('#ai-base').value.trim(),
          model: el.querySelector('#ai-model').value.trim(),
          visionModel: el.querySelector('#ai-vision').value.trim(),
          timeoutSec: parseInt(el.querySelector('#ai-timeout').value, 10) || 60,
          retries: parseInt(el.querySelector('#ai-retries').value, 10) || 2,
          maxCharsPerCall: parseInt(el.querySelector('#ai-max').value, 10) || 4000
        }
      }, 'AI 设置已保存');
    });

    el.querySelector('[data-act="test-old"]')?.addEventListener('click', async (e) => {
      const out = el.querySelector('#ai-test-result');
      e.currentTarget.disabled = true;
      if (out) out.textContent = '正在测试…';
      const r = await window.electronAPI.ai.test();
      e.currentTarget.disabled = false;
      if (out) out.textContent = (r.ok ? '✓ ' : '✕ ') + r.message + (r.reply ? '（' + r.reply + '）' : '');
      if (r.ok) Toast.success('AI 连接正常'); else Toast.error('连接失败：' + r.message, true);
    });

    el.querySelector('[data-act="save-tts"]')?.addEventListener('click', () => save({
      tts: { ...s.tts, vramWarnPct: parseInt(el.querySelector('#tts-vram').value, 10) || 90 }
    }, 'TTS 设置已保存'));

    el.querySelector('[data-act="save-output"]')?.addEventListener('click', () => save({
      output: {
        ...s.output,
        format: el.querySelector('#o-fmt').value,
        sampleRate: parseInt(el.querySelector('#o-sr').value, 10),
        pauseMs: parseInt(el.querySelector('#o-pause').value, 10) || 300,
        naming: el.querySelector('#o-naming').value.trim()
      }
    }, '输出设置已保存'));

    el.querySelector('[data-act="save-project"]')?.addEventListener('click', () => save({
      project: { ...s.project, autoSaveSec: parseInt(el.querySelector('#p-auto').value, 10) || 30 }
    }, '已保存'));

    el.querySelector('[data-act="pick-root"]')?.addEventListener('click', async () => {
      const r = await window.electronAPI.path.pick({ title: '选择输出根目录', defaultPath: s.output.root });
      if (r && r.ok) {
        await save({ output: { ...s.output, root: r.path } }, '输出目录已更新');
        await Store.reloadProjects();
      }
    });

    el.querySelector('[data-act="goto-dict"]')?.addEventListener('click', () => {
      ProjectSettingsPage._sec = 'dict'; App.go('project-settings');
    });
    el.querySelector('[data-act="open-trash"]')?.addEventListener('click', () =>
      window.electronAPI.path.reveal(s.output.root + '\\.trash'));
    el.querySelector('[data-act="open-userdata"]')?.addEventListener('click', () =>
      window.electronAPI.path.reveal(Store.userData));
    el.querySelector('[data-act="reveal-config"]')?.addEventListener('click', () =>
      window.electronAPI.path.reveal(Store.userData));
    el.querySelector('[data-act="show-log"]')?.addEventListener('click', () => {
      Modal.open({ title: '后端状态', width: 520,
        body: '<p class="text-sm" style="line-height:1.9">服务地址：<code>' + Util.escapeHtml(API.baseUrl) + '</code><br>'
            + '引擎状态：<code>' + Util.escapeHtml(document.getElementById('side-status').textContent) + '</code><br>'
            + 'GPU：<code>' + Util.escapeHtml(document.getElementById('gpu-text').textContent) + '</code></p>'
            + '<p class="text-sm text-muted" style="margin-bottom:0">完整后端日志在启动加载页会实时显示；'
            + '运行中的日志由 server.py 输出到它自己的控制台。</p>',
        footer: '<button class="btn" data-act="close">关闭</button>' });
      document.querySelector('[data-act="close"]')?.addEventListener('click', () => Modal.close());
    });
  }
};
