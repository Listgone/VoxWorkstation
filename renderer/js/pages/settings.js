/* ══════════════════════════════════════════
   设置 —— 软件层面的配置（11 个分组）
   ══════════════════════════════════════════ */

/* OpenAI 兼容服务商预设
   注意：模型清单只是「起步参考」，各家的模型迭代很快，随时可能过期。
   设置页有「拉取服务商模型」按钮，直接问服务商要真实列表，以那个为准。
   free 里列的是已知有免费额度的模型，界面上会打「免费」标。 */
const AI_PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek',    sub: '自研 · 国内直连', own: '^deepseek',
    base: 'https://api.deepseek.com/v1',
    models: ['deepseek-flash', 'deepseek-v4-pro'], free: [] },
  { id: 'zhipu',    name: '智谱 GLM',    sub: '自研 · 有免费模型', own: '^(glm|charglm|embedding-)',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-ocr'],
    free: ['glm-5.3-flash'] },



  { id: 'openai',   name: 'OpenAI',      sub: '自研 · 需要能访问境外', own: '^(gpt|o[1-9]|chatgpt)',
    base: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'], free: [] },
  { id: 'ollama',   name: '本地 Ollama', sub: '本地部署 · 数据不出网', own: null,
    base: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b'], free: ['*'] },
  { id: 'custom',   name: '自定义',      sub: '任意 OpenAI 兼容端点',
    base: '', models: [], free: [] }
];

/* 拉取回来的模型往往几十上百个，夹杂大量历史版本。
   只保留「免费」与「每个家族里版本号最高的那个」——
   老模型首先不如新模型，列出来只是干扰。 */
function filterLatestModels(list, freeSet) {
  const arr = (list || []).filter(Boolean);
  const free = freeSet instanceof Set ? freeSet : new Set(freeSet || []);
  const allFree = free.has('*');
  // 取「第一个版本号」，而不是最大数字 ——
  // 否则日期后缀（2025-09-01 → 2025）和参数量（110b → 110）
  // 会被当成版本，把真正的最新模型挤下去
  const verOf = (id) => {
    const s = String(id).toLowerCase()
      .replace(/[-_]?\d{4}[-_]?\d{2}[-_]?\d{2}(?=$|[-_])/g, '')   // 2025-09-01
      .replace(/[-_]?\d{6}(?=$|[-_])/g, '')                        // 20250901
      .replace(/[-_]?\d{4}(?=$|[-_])/g, '');                       // 0912 / 2025
    const m = s.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)(?![\d.]*\s*b(?![a-z]))/);
    return m ? parseFloat(m[1]) : -1;
  };
  const famOf = (id) => String(id).toLowerCase()
    .replace(/\d+(\.\d+)?/g, '')                 // 去掉版本号与参数量
    .replace(/[-_.]?(latest|chat|instruct|preview|beta|exp|stable|v\d+)\b/g, '')
    .replace(/[^a-z\u4e00-\u9fa5]+/g, '')
    .slice(0, 12);
  const best = new Map();
  for (const id of arr) {
    const f = famOf(id) || id;
    const v = verOf(id);
    const cur = best.get(f);
    if (!cur || v > cur.v || (v === cur.v && String(id).length < String(cur.id).length)) {
      best.set(f, { id, v });
    }
  }
  const keep = new Set();
  for (const x of best.values()) keep.add(x.id);
  if (allFree) return arr;                       // 全免费就不用筛了
  for (const id of arr) if (free.has(id)) keep.add(id);   // 免费的一律保留
  const out = arr.filter(id => keep.has(id));
  // 封顶：即使每个家族只留最新，千问这类仍会剩下十几二十个，
  // 按版本号从新到旧截断，只留最能用的几个
  const CAP = 8;
  if (out.length <= CAP) return out;
  const ver = new Map(out.map(id => [id, verOf(id)]));
  return out.slice().sort((a, b) => (ver.get(b) - ver.get(a)) || a.localeCompare(b)).slice(0, CAP);
}
const SettingsPage = {
  _sec: 'appearance',

  _SECTIONS: [
    ['guide',      '使用说明'],
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
      case 'guide':      return this._guide();
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

  _guide() {
    const box = (t, items) => '<div class="gsec"><b>' + t + '</b><ol>'
      + items.map(x => '<li>' + x + '</li>').join('') + '</ol></div>';
    return '<div class="card"><h2>使用说明 <span class="n">从零到出成品</span></h2>'
      + '<div class="gflow">'
      + ['① 建项目', '② 建集', '③ 文本处理', '④ 配音', '⑤ 导出']
          .map((x, i) => '<span class="gstep">' + x + '</span>'
            + (i < 4 ? '<i class="garrow">→</i>' : '')).join('')
      + '</div>'

      + box('日常流程', [
          '<b>项目管理</b>新建一个项目（一个项目 = 一部作品）。',
          '<b>集管理</b>新建集；集文件夹会建在项目目录下，形如 <code>第01集</code>。',
          '<b>文本处理</b>把小说/剧本原文粘进左上输入框 → 点「作为原文」→ 点 <b>✦ 整理成剧本</b>。',
          '整理结果分两段：<code>【背景介绍】</code>只供判断不配音；<code>【角色（情绪）+台词】</code>才是配音内容。',
          '核对分句表：角色、情绪分级（明确 / 推断 / 未标注）不对就手动改。',
          '<b>配音</b>先给每个角色绑定音色 → 点「生成全部」。每生成一句立刻落盘，中途关软件也不丢。',
          '<b>导出</b>整轨合并 / 生成 SRT / 逐句目录。'
        ])
      + box('AI 处理怎么选', [
          '<b>✦ 整理成剧本</b>：一键完成全流程（推荐，只想要剧本点这个就够）。',
          '<b>✦ AI 处理…</b>：分步用。只规范化数字 / 只补语气标记 / 只要台词 JSON 时用。',
          '本地处理（<b>本地规范化</b>、<b>按标点分句</b>）不联网、瞬间完成，但不懂语义。',
          'AI 需要先在「设置 → AI 服务」配置。DeepSeek 便宜且快，建议 <code>deepseek-flash</code>。'
        ])
      + box('文件都存哪', [
          '每个集一个文件夹，里面有 <code>script.original.txt</code>（原文）、<code>script.txt</code>（处理后）、'
            + '<code>lines.json</code>（分句与状态）、<code>audio\\</code>（逐句音频）、<code>output\\</code>（导出成品）。',
          '音频命名形如 <code>001_旁白_这是第2集的.wav</code>：序号 + 角色 + 台词前几字，方便辨认。',
          '删除的项目/集进同级的 <code>.trash</code> 文件夹，不会直接抹掉。'
        ])
      + box('常见问题', [
          '<b>界面卡在加载页</b>：模型在后台加载，服务一响应就能进主界面，生成按钮会自动解禁。'
            + '若超过 5 分钟没变化，去「诊断与关于」跑一次自检。',
          '<b>AI 报错或很慢</b>：先点「测试连接」。DeepSeek 的「深度思考」务必保持关闭，'
            + '开着会让简单任务慢几十倍。',
          '<b>生成的音频听不了</b>：确认状态栏引擎徽章是绿色「引擎就绪」；'
            + '加载中生成的请求会返回 503。',
          '<b>换个服务商 key 要重填吗</b>：不用。每个服务商的 Key 分开保存，切换时自动带出各自的。',
          '<b>整理结果里人名识别不出来</b>：多为模型能力问题，换更强的模型（如 DeepSeek）通常能解决。'
        ])
      + '</div>';
  },
  _appearance(s) {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const TH = [
      ['light', '明亮现代', '默认 · 干净 · 无动效', 'thprev-a'],
      ['minimal', '极简黑白', '深色 · 纯灰阶 · 无彩色', 'thprev-m'],
      ['glass', '液态玻璃', '毛玻璃 + 彩色光斑', 'thprev-g'],
      ['construct', '构成主义', '粗边分格 + 苏式红', 'thprev-c']
    ];
    const fi = App.fontInfo || {};
    const FONTS = [
      ['system', '系统默认', 'Segoe UI + 微软雅黑'],
      ['han', '思源黑体', fi.han ? '实际：' + fi.han : '屏幕阅读最舒服']
    ];
    const curFont = s.font || 'system';
    return '<div class="card"><h2>外观与主题</h2>'
      + '<div class="themes">'
      + TH.map(([id, name, sub, prev]) =>
          '<div class="th' + (theme === id ? ' on' : '') + '" data-theme-pick="' + id + '">'
          + '<div class="thprev ' + prev + '"></div><b>' + name + '</b><span>' + sub + '</span></div>').join('')
      + '</div>'
      + this._row('字体', '数字、时间码、代码块始终用等宽，与正文字体无关',
          '<div class="model-chips" id="font-chips">'
          + FONTS.map(([id, name, sub]) =>
              '<button type="button" class="mchip' + (curFont === id ? ' on' : '') + '" data-font="' + id + '"'
              + ' title="' + Util.escapeAttr(sub) + '">' + name + '</button>').join('')
          + '</div>')
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
    const prov = ai.provider || 'deepseek';
    const ks = (Store.keyStatus || {})[prov] || {};
    const hasKey = !!ks.has;
    const fetched = ((s.aiModels || {})[prov] || null);
    const showAll = !!(fetched && fetched.showAll);
    const models = fetched
      ? ((showAll && fetched.all && fetched.all.length) ? fetched.all : (fetched.list || []))
      : (cur.models || []);
    const freeSet = new Set(cur.free || []);
    const fetchedAt = fetched && fetched.at ? new Date(fetched.at) : null;
    const fetchedLabel = fetchedAt
      ? (showAll
          ? '显示全部 ' + models.length + ' 个（含历史版本）'
          : '✓ 最新/免费 ' + models.length + ' 个'
            + (fetched.all && fetched.all.length > models.length
                ? '（共拉到 ' + fetched.all.length + ' 个，已滤掉旧版本）' : ''))
        + ' · ' + fetchedAt.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    const allFree = freeSet.has('*');
    const isFree = (m) => allFree || freeSet.has(m);
    const isCustomModel = !!ai.model && models.length > 0 && !models.includes(ai.model);
    return '<div class="card"><h2>AI 服务 <span class="n">'
      + (hasKey
          ? '已配置 Key' + (Store.keyEncrypted ? '（加密存储）' : '（未加密）')
          : '<span style="color:var(--danger)">未配置 Key</span>')
      + '</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-6px 0 10px">'
      + '所有服务商都走 OpenAI 兼容接口。选一个会自动填好地址与模型，也可以手改。</p>'
      + '<div class="themes" style="flex-wrap:wrap;margin-bottom:6px">'
      + AI_PROVIDERS.map(p =>
          '<div class="th' + (ai.provider === p.id ? ' on' : '') + '" data-provider="' + p.id + '" style="width:164px">'
          + '<b>' + p.name + '</b><span>' + p.sub + '</span></div>').join('')
      + '</div>'
      + this._row('接口地址', 'OpenAI 兼容 baseURL，末尾不用带 /chat/completions',
          '<input type="text" id="ai-base" value="' + Util.escapeAttr(ai.baseURL || cur.base) + '" style="width:320px">')
      + this._row('模型', '标「免费」的是已知有免费额度的；模型多时自动改为下拉省地方',
          '<div class="ctrl-col">'
          + (models.length > 6
            // 模型多：用下拉（Select.enhance 会把它换成统一样式）
            ? '<div class="mrow">'
              + '<select id="ai-model-pick" style="width:240px">'
              + models.map(m => '<option value="' + Util.escapeAttr(m) + '"'
                  + (ai.model === m ? ' selected' : '') + '>' + Util.escapeHtml(m)
                  + (isFree(m) ? '　免费' : '') + '</option>').join('')
              + '<option value="__custom__"' + (isCustomModel ? ' selected' : '') + '>自定义…</option>'
              + '</select>'
              + '<button class="btn btn-sm" data-act="fetch-models" title="向服务商请求 /models">⟳ 拉取</button>'
              + '</div>'
            // 模型少：铺开成 chips，一眼看全
            : '<div class="mrow">'
              + '<div class="model-chips" id="ai-models">'
              + models.map(m => '<button type="button" class="mchip' + (ai.model === m ? ' on' : '')
                  + '" data-model="' + Util.escapeAttr(m) + '">' + Util.escapeHtml(m)
                  + (isFree(m) ? '<i class="free-tag">免费</i>' : '') + '</button>').join('')
              + '<button type="button" class="mchip' + (isCustomModel || !models.length ? ' on' : '')
              + '" data-model="__custom__">自定义…</button>'
              + '</div>'
              + '<button class="btn btn-sm" data-act="fetch-models" title="向服务商请求 /models，拿真实列表">⟳ 拉取</button>'
              + '</div>')
          + '<input type="text" id="ai-model" value="' + Util.escapeAttr(ai.model || '') + '" style="width:240px;'
          + (isCustomModel || !models.length ? '' : 'display:none') + '" placeholder="手填模型名">'
          + (fetchedLabel
              ? '<div class="text-sm" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;color:var(--ok)">'
                + Util.escapeHtml(fetchedLabel)
                + (fetched && fetched.all && fetched.all.length > (fetched.list || []).length
                    ? '<a data-act="toggle-all" style="cursor:pointer;text-decoration:underline">'
                      + (showAll ? '只看最新/免费' : '显示全部 ' + fetched.all.length + ' 个') + '</a>'
                    : '')
                + '<a data-act="reset-models" style="cursor:pointer;color:var(--text-mute);'
                + 'text-decoration:underline">恢复内置清单</a></div>'
              : '')
          + '</div>')
      + this._row('视觉模型（OCR）', '图片取字用，留空则关闭该功能。智谱可填 glm-ocr',
          '<input type="text" id="ai-vision" value="' + Util.escapeAttr(ai.visionModel || '') + '" placeholder="留空即关闭" style="width:220px">')
      + (prov === 'ollama'
          ? this._row('API Key', '本地部署不需要 Key，把服务跑起来就能用', '<span class="text-sm text-muted">无需配置</span>')
          : this._row('API Key', (hasKey
              ? '<b>' + Util.escapeHtml(cur.name) + '</b> 的 Key 已加密保存在本机。要换就直接输入新的，留空则不改动'
              : '每个服务商分开保存。「测试连接」会先自动保存'),
          '<input type="text" id="ai-key" class="key-input' + (hasKey ? ' is-set' : '') + '" '
          + 'value="' + Util.escapeAttr(hasKey ? (ks.hint || '已保存') : '') + '" '
          + 'placeholder="粘贴 API Key" style="width:230px" autocomplete="off" spellcheck="false">'
          + '<button class="btn btn-sm" data-act="test">测试连接</button>'
          + (hasKey ? '<button class="btn btn-sm btn-ghost btn-danger" data-act="clear-key">清除</button>' : '')))
      + (prov !== 'deepseek' ? '' : this._row('深度思考', 'DeepSeek 默认开启且强度为 high，回答前先写一大段推理，很慢。'
            + '文本整理不需要，默认关闭；只有任务特别复杂时才值得打开',
          '<div class="model-chips" id="think-chips">'
          + '<button type="button" class="mchip' + ((s.thinking || 'off') !== 'on' ? ' on' : '') + '" data-think="off">关闭（快）</button>'
          + '<button type="button" class="mchip' + ((s.thinking === 'on') ? ' on' : '') + '" data-think="on">开启（强）</button>'
          + '</div>'))
      + (prov !== 'ollama' ? '' : this._row('怎么用本地模型', '',
          '<div class="ollama-hint">'
          + '<b>1. 装 Ollama</b>（ollama.com）—— 装哪个目录都行，装完它在后台常驻，不依赖本软件。<br>'
          + '<b>2. 拉一个模型</b>：终端执行 <code>ollama pull qwen2.5:14b</code>，模型存在 Ollama 自己的目录（默认 <code>%USERPROFILE%\.ollama\models</code>）。<br>'
          + '<b>3. 回到这里点「⟳ 拉取」</b>，本机装了哪些模型就会列出来，选一个即可。<br>'
          + '<b>4. 不需要 API Key</b>，服务跑着就能用。'
          + '<p style="margin:8px 0 0">本软件只通过 <code>http://127.0.0.1:11434</code> 调用它，不复制模型文件、不改动 Ollama 的目录。</p>'
          + '<p style="margin:6px 0 0"><b>模型选择建议</b>：剧本整理是结构化长输出任务，<code>qwen2.5:14b</code> 起步；显存紧张退到 <code>7b</code>，但人名与角色识别会明显变差（7b 常把叙述当成台词）。</p>'
          + '</div>'))
      + this._row('超时 / 重试', '长文本处理建议调大超时',
          '<input type="number" id="ai-timeout" value="' + (ai.timeoutSec || 60) + '" style="width:74px"><span class="text-sm text-muted">秒</span>'
          + '<input type="number" id="ai-retries" value="' + (ai.retries || 2) + '" style="width:66px"><span class="text-sm text-muted">次</span>')
      + this._row('单次处理上限', '超长文本自动分段并行调用。剧本整理不受此限制，整章一次做完',
          '<input type="number" id="ai-max" value="' + (ai.maxCharsPerCall || 12000) + '" style="width:96px"><span class="text-sm text-muted">字</span>')
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
    const sound = n.sound || 'chime';
    const vol = n.volume ?? 70;
    return '<div class="card"><h2>通知</h2>'
      + this._row('生成完成时提醒', '批量生成耗时较长，完成后响一声', this._sw(n.soundEnabled !== false, 'toggle-sound'))
      + this._row('提醒内容', '不想要哪一种就关掉',
          '<div class="model-chips">'
          + '<button type="button" class="mchip' + (n.onDone !== false ? ' on' : '') + '" data-notify="onDone">成功时提醒</button>'
          + '<button type="button" class="mchip' + (n.onFail !== false ? ' on' : '') + '" data-notify="onFail">失败时提醒</button>'
          + '</div>')
      + this._row('提示音', '现场合成，不占体积',
          '<div class="model-chips" id="sound-chips">'
          + Notify.SOUNDS.map(([id, name]) =>
              '<button type="button" class="mchip' + (sound === id ? ' on' : '') + '" data-sound="' + id + '">'
              + name + '</button>').join('')
          + '</div>')
      + this._row('音量', '',
          '<input type="range" id="n-vol" min="0" max="100" value="' + vol + '" style="width:170px">'
          + '<b class="text-sm" id="n-vol-v" style="width:36px;text-align:right">' + vol + '%</b>'
          + '<button class="btn btn-sm" data-act="test-sound">试听</button>')
      + '<p class="text-sm text-muted mt-12" style="margin-bottom:0">'
      + '提示音在「生成全部台词」「AI 处理」「整轨导出」完成后播放。'
      + '失败时用下行音，和成功区分开。</p>'
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
    return '<div class="card"><h2>自检 <span class="n" id="diag-sum">点右侧按钮开始检测</span></h2>'
      + '<p class="text-sm text-muted" style="margin:-6px 0 10px">'
      + '逐项检查后端、引擎、目录与配置，发现问题会给出修复办法。</p>'
      + '<div class="action-row"><button class="btn btn-primary" data-act="run-diag">开始自检</button>'
      + '<span class="text-sm text-muted" id="diag-hint"></span></div>'
      + '<div id="diag-list" class="diag-list"></div>'
      + '</div>'

      + '<div class="card"><h2>诊断与关于</h2>'
      + this._row('后端服务', Util.escapeHtml(API.baseUrl) + ' · ' + Util.escapeHtml(cfg.serverDir || ''), '')
      + this._row('配置目录', Util.escapeHtml(Store.userData || ''),
          '<button class="btn btn-sm" data-act="open-userdata">打开</button>')
      + this._row('查看后端日志', '最近 200 行，排查生成失败用',
          '<button class="btn btn-sm" data-act="show-log">查看</button>')
      + this._row('VoxWorkstation v1.0.0', 'VoxCPM2 引擎 · Electron', '')
      + '</div>';
  },

  _diagHtml(res) {
    if (!res || !res.ok) return '<p class="text-sm text-muted">自检失败：' + Util.escapeHtml((res && res.message) || '未知错误') + '</p>';
    const ICON = { ok: '✓', warn: '!', fail: '✕' };
    const rows = res.checks.map(c =>
      '<div class="diag-item diag-' + c.level + '">'
      + '<span class="diag-ico">' + ICON[c.level] + '</span>'
      + '<div class="diag-body"><b>' + Util.escapeHtml(c.name) + '</b>'
      + '<span class="diag-detail">' + Util.escapeHtml(c.detail || '') + '</span>'
      + (c.fix ? '<div class="diag-fix"><b>修复：</b>' + Util.escapeHtml(c.fix) + '</div>' : '')
      + '</div></div>').join('');
    const e = res.env;
    const env = '<div class="diag-env">'
      + ['Electron ' + e.electron, 'Chromium ' + e.chrome, 'Node ' + e.node,
         e.platform, '后端 ' + e.serverDir, 'Python ' + e.pythonPath,
         '端口 ' + e.serverPort, '输出 ' + (e.outputRoot || '(未设置)')]
        .map(x => '<code>' + Util.escapeHtml(x) + '</code>').join('')
      + '</div>';
    return rows + env;
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
      c.addEventListener('click', () => {
        App.applyFont(c.dataset.font);
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
    toggle('toggle-sound',    v => save({ notify: { ...s.notify, soundEnabled: v } }));

    /* 通知：内容开关 / 提示音 / 音量 */
    el.querySelectorAll('[data-notify]').forEach(b =>
      b.addEventListener('click', () => {
        const key = b.dataset.notify;
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        save({ notify: { ...s.notify, [key]: on } });
      }));
    el.querySelectorAll('#sound-chips [data-sound]').forEach(b =>
      b.addEventListener('click', () => {
        el.querySelectorAll('#sound-chips .mchip').forEach(x => x.classList.toggle('on', x === b));
        save({ notify: { ...s.notify, sound: b.dataset.sound } });
        if (b.dataset.sound !== 'none') setTimeout(() => Notify.play(b.dataset.sound), 120);
      }));
    const volEl = el.querySelector('#n-vol');
    volEl?.addEventListener('input', () => {
      const v = Number(volEl.value);
      const lbl = el.querySelector('#n-vol-v');
      if (lbl) lbl.textContent = v + '%';
      s.notify = { ...s.notify, volume: v };   // 拖动时先改内存，松手再落盘
    });
    volEl?.addEventListener('change', () => save({ notify: { ...s.notify, volume: Number(volEl.value) } }));
    el.querySelector('[data-act="test-sound"]')?.addEventListener('click', () => Notify.play());
    toggle('toggle-redact',   v => save({ privacy: { ...s.privacy, redact: v } }));
    toggle('toggle-onlycur',  v => save({ privacy: { ...s.privacy, onlyCurrentParagraph: v } }));
    toggle('toggle-diff',     v => save({ privacy: { ...s.privacy, keepDiffHistory: v } }));

    /* 重新问主进程要 key 的状态（永远不拿明文，只要掩码） */
    const refreshKeyState = async () => {
      try {
        const r = await window.electronAPI.settings.get();
        Store.keyStatus = r.keyStatus || {};
        Store.keyEncrypted = r.keyEncrypted;
      } catch (e) { /* 忽略 */ }
    };

    /* key 输入框：有 key 时显示掩码；内容是掩码就说明用户没动过。
       只比对值本身，不依赖任何状态标记 —— 标记一旦和真实内容不同步就会误判 */
    const curKey = () => ((Store.keyStatus || {})[pickedProvider] || {});
    const isMask = (v) => curKey().has && String(v).trim() === (curKey().hint || '');
    const keyInp = el.querySelector('#ai-key');
    const enterEdit = () => {
      if (keyInp && isMask(keyInp.value)) {
        keyInp.value = '';
        keyInp.classList.remove('is-set');
      }
    };
    keyInp?.addEventListener('focus', enterEdit);
    keyInp?.addEventListener('mousedown', enterEdit);
    keyInp?.addEventListener('blur', () => {
      // 没输入任何东西就离开 → 恢复掩码，免得看起来像被清空了
      if (keyInp && !keyInp.value.trim() && curKey().has) {
        keyInp.value = curKey().hint || '已保存';
        keyInp.classList.add('is-set');
      }
    });

    /* 把输入框里的 key 存下来；留空或仍是掩码都视为「不改动」 */
    const persistKey = async () => {
      const inp = el.querySelector('#ai-key');
      if (!inp) return { ok: true, skipped: true };
      if (pickedProvider === 'ollama') return { ok: true, skipped: true };   // 本地不需要 Key
      const key = inp.value.trim();
      if (!key || isMask(key)) return { ok: true, skipped: true };
      const r = await window.electronAPI.settings.setApiKey(pickedProvider, key);
      if (r && r.ok) {
        await refreshKeyState();     // 掩码由主进程算，渲染层不重复实现
        return { ok: true, saved: true };
      }
      return { ok: false, message: (r && r.message) || '未知错误' };
    };

    /* 清除已保存的 key */
    el.querySelector('[data-act="clear-key"]')?.addEventListener('click', async () => {
      const ok = await Modal.confirm({
        title: '清除 API Key', okText: '清除', danger: true,
        message: '只清除<b>当前服务商</b>的 Key，其它服务商的 Key 保留。<br>清除后这家就不能用了，需要重新填写。'
      });
      if (!ok) return;
      const r = await window.electronAPI.settings.clearApiKey(pickedProvider);
      if (r && r.ok) {
        await refreshKeyState();
        Toast.success('已清除 API Key');
        App.go('settings');
      } else Toast.error('清除失败：' + ((r && r.message) || '未知错误'), true);
    });

    /* 模型区：≤6 个铺 chips，>6 个自动变下拉省地方 */
    let pickedProvider = (s.ai || {}).provider || 'deepseek';
    const buildModelRow = (list, freeList, keep) => {
      const arr = list || [];
      const freeSet = new Set(freeList || []);
      const allFree = freeSet.has('*');
      const isFree = (m) => allFree || freeSet.has(m);
      const pull = '<button class="btn btn-sm" data-act="fetch-models" '
        + 'title="向服务商请求 /models，拿真实可用列表">⟳ 拉取</button>';
      if (arr.length > 6) {
        const sel = arr.includes(keep) ? keep : '__custom__';
        return '<div class="mrow"><select id="ai-model-pick" style="width:240px">'
          + arr.map(m => '<option value="' + Util.escapeAttr(m) + '"'
              + (sel === m ? ' selected' : '') + '>' + Util.escapeHtml(m)
              + (isFree(m) ? '　免费' : '') + '</option>').join('')
          + '<option value="__custom__"' + (sel === '__custom__' ? ' selected' : '') + '>自定义…</option>'
          + '</select>' + pull + '</div>';
      }
      return '<div class="mrow"><div class="model-chips" id="ai-models">'
        + arr.map(m => '<button type="button" class="mchip' + (keep === m ? ' on' : '')
            + '" data-model="' + Util.escapeAttr(m) + '">' + Util.escapeHtml(m)
            + (isFree(m) ? '<i class="free-tag">免费</i>' : '') + '</button>').join('')
        + '<button type="button" class="mchip' + (arr.includes(keep) ? '' : ' on')
        + '" data-model="__custom__">自定义…</button></div>' + pull + '</div>';
    };

    const bindModelRow = () => {
      const inp = el.querySelector('#ai-model');
      if (!inp) return;

      // 下拉形态的 change 监听必须单独打标记：
      // App.go() 会先跑 Select.enhance(el)，那时 select 已被打上
      // data-sel-ready，用那个标记做判断会导致监听器永远绑不上
      const onPick = (s) => () => {
        if (s.value === '__custom__') { inp.style.display = ''; inp.focus(); }
        else { inp.style.display = 'none'; inp.value = s.value; }
      };
      let sel = el.querySelector('#ai-model-pick');
      if (sel && !sel.dataset.bound) {
        if (!sel.dataset.selReady) {
          Select.enhance(el.querySelector('.ctrl-col'));
          sel = el.querySelector('#ai-model-pick');       // enhance 会替换节点，重新取
        }
        if (sel && !sel.dataset.bound) {
          sel.dataset.bound = '1';
          sel.addEventListener('change', onPick(sel));
        }
      }

      el.querySelectorAll('#ai-models .mchip').forEach(c =>
        c.addEventListener('click', () => {
          el.querySelectorAll('#ai-models .mchip').forEach(x => x.classList.toggle('on', x === c));
          if (c.dataset.model === '__custom__') { inp.style.display = ''; inp.focus(); }
          else { inp.style.display = 'none'; inp.value = c.dataset.model; }
        }));
    };

    const renderModels = (list, freeList, keep) => {
      const inp = el.querySelector('#ai-model');
      const mrow = el.querySelector('.ctrl-col .mrow');
      if (!inp || !mrow) return;
      mrow.outerHTML = buildModelRow(list, freeList, keep);
      const arr = list || [];
      if (arr.length) { inp.value = arr.includes(keep) ? keep : arr[0]; inp.style.display = 'none'; }
      else { inp.style.display = ''; }
      bindModelRow();
    };

    const fillProvider = (id) => {
      const p = AI_PROVIDERS.find(x => x.id === id) || AI_PROVIDERS[0];
      const baseEl = el.querySelector('#ai-base');
      if (baseEl && p.base) baseEl.value = p.base;
      renderModels(p.models || [], p.free || [], '');
    };

    bindModelRow();
    el.querySelectorAll('[data-provider]').forEach(b =>
      b.addEventListener('click', async () => {
        pickedProvider = b.dataset.provider;
        el.querySelectorAll('[data-provider]').forEach(x => x.classList.toggle('on', x === b));
        fillProvider(pickedProvider);
        // 立刻记下这家的地址与模型并重渲染 —— 关键是让 API Key 栏
        // 切到这家自己的 key，否则会拿着上一家的 key 去测，报「令牌无效」
        await Store.saveSettings({ ai: {
          ...(Store.settings.ai || {}),
          provider: pickedProvider,
          baseURL: el.querySelector('#ai-base').value.trim(),
          model: el.querySelector('#ai-model').value.trim(),
          visionModel: el.querySelector('#ai-vision').value.trim()
        }});
        App.go('settings');
      }));
    el.querySelector('#ai-model')?.addEventListener('input', (e) => {
      el.querySelectorAll('#ai-models .mchip').forEach(x =>
        x.classList.toggle('on', x.dataset.model === '__custom__'
          || (![...el.querySelectorAll('#ai-models .mchip')].some(c => c.dataset.model === e.target.value))));
      const sel = el.querySelector('#ai-model-pick');
      if (sel && ![...sel.options].some(o => o.value === e.target.value)) sel.value = '__custom__';
    });

    /* 拉取服务商真实模型列表 */
    el.querySelector('[data-act="fetch-models"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '拉取中…';
      const out = el.querySelector('#ai-test-result');
      try {
        const kr = await persistKey();            // 先存 key，否则拉不动
        if (!kr.ok) throw new Error('API Key 保存失败：' + kr.message);
        const r = await window.electronAPI.ai.models({
          provider: pickedProvider,
          baseURL: el.querySelector('#ai-base').value.trim()
        });
        if (!r.ok) throw new Error(r.message);
        const p = AI_PROVIDERS.find(x => x.id === pickedProvider) || {};
        const freeSet = new Set(p.free || []);
        // 只保留这家自己的模型 —— 聚合平台会把别家的也列出来，
        // 既看不过来，也没必要在这里配（跨平台价格只会更贵）
        const ownRe = p.own ? new RegExp(p.own, 'i') : null;
        const mine = ownRe ? r.models.filter(m => ownRe.test(m)) : r.models;
        const kept = filterLatestModels(mine, freeSet);
        const dropped = r.models.length - mine.length;
        // 关键：把结果存进设置，否则一切页面就回到内置清单，看起来像没刷新
        const aiModels = { ...(Store.settings.aiModels || {}) };
        aiModels[pickedProvider] = { list: kept, all: mine, raw: r.models.length, showAll: false, at: Date.now() };
        await Store.saveSettings({ aiModels });
        renderModels(kept, p.free || [], el.querySelector('#ai-model').value.trim());
        const msg = '✓ 保留 ' + kept.length + ' 个自家模型'
          + (dropped > 0 ? '（忽略 ' + dropped + ' 个第三方模型）' : '');
        if (out) out.textContent = msg;
        Toast.success(msg.replace('✓ ', ''));
        setTimeout(() => App.go('settings'), 800);
      } catch (err) {
        if (out) out.textContent = '✕ ' + err.message;
        Toast.error('拉取失败：' + err.message, true);
      } finally { btn.disabled = false; btn.textContent = old; }
    });

    el.querySelectorAll('#think-chips [data-think]').forEach(b =>
      b.addEventListener('click', () => {
        el.querySelectorAll('#think-chips .mchip').forEach(x => x.classList.toggle('on', x === b));
        save({ thinking: b.dataset.think }, b.dataset.think === 'on' ? '已开启深度思考（会慢很多）' : '已关闭深度思考');
      }));

    el.querySelector('[data-act="toggle-all"]')?.addEventListener('click', async () => {
      const aiModels = { ...(Store.settings.aiModels || {}) };
      const cur2 = aiModels[pickedProvider];
      if (cur2) { aiModels[pickedProvider] = { ...cur2, showAll: !cur2.showAll }; }
      await Store.saveSettings({ aiModels });
      App.go('settings');
    });

    el.querySelector('[data-act="reset-models"]')?.addEventListener('click', async () => {
      const aiModels = { ...(Store.settings.aiModels || {}) };
      delete aiModels[pickedProvider];
      await Store.saveSettings({ aiModels });
      Toast.success('已恢复内置清单');
      App.go('settings');
    });

    const doTest = async (btn) => {
      const out = el.querySelector('#ai-test-result');
      const old = btn.textContent;
      btn.disabled = true; btn.textContent = '测试中…';
      if (out) out.textContent = '';
      try {
        // 关键：先把输入框里的 key 存下来，否则测的是磁盘上的旧 key
        const kr = await persistKey();
        if (!kr.ok) throw new Error('API Key 保存失败：' + kr.message);
        const r = await window.electronAPI.ai.test(pickedProvider);
        if (out) out.textContent = (r.ok ? '✓ ' : '✕ ') + r.message + (r.reply ? '（' + r.reply + '）' : '');
        if (r.ok) {
          Toast.success('AI 连接正常');
          // 重新渲染前先把当前选择落盘，否则会退回上次保存的模型
          await Store.saveSettings({ ai: {
            ...(Store.settings.ai || {}),
            provider: pickedProvider,
            baseURL: el.querySelector('#ai-base').value.trim(),
            model: el.querySelector('#ai-model').value.trim(),
            visionModel: el.querySelector('#ai-vision').value.trim()
          }});
          App.go('settings');
        }
        else Toast.error('连接失败：' + r.message, true);
      } catch (err) {
        if (out) out.textContent = '✕ ' + err.message;
        Toast.error('连接失败：' + err.message, true);
      } finally { btn.disabled = false; btn.textContent = old; }
    };
    el.querySelector('[data-act="test"]')?.addEventListener('click', (e) => doTest(e.currentTarget));
    el.querySelector('[data-act="test2"]')?.addEventListener('click', (e) => doTest(e.currentTarget));

    el.querySelector('[data-act="save-ai"]')?.addEventListener('click', async () => {
      const kr = await persistKey();
      if (!kr.ok) { Toast.error('API Key 保存失败：' + kr.message, true); return; }
      await save({
        ai: {
          provider: pickedProvider,
          baseURL: el.querySelector('#ai-base').value.trim(),
          model: el.querySelector('#ai-model').value.trim(),
          visionModel: el.querySelector('#ai-vision').value.trim(),
          timeoutSec: parseInt(el.querySelector('#ai-timeout').value, 10) || 60,
          retries: parseInt(el.querySelector('#ai-retries').value, 10) || 2,
          maxCharsPerCall: parseInt(el.querySelector('#ai-max').value, 10) || 12000
        }
      }, kr.skipped ? 'AI 设置已保存' : 'AI 设置与 API Key 已保存');
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
    el.querySelector('[data-act="run-diag"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const list = el.querySelector('#diag-list');
      btn.disabled = true; btn.textContent = '检测中…';
      if (list) list.innerHTML = '<p class="text-sm text-muted">正在检测…</p>';
      try {
        const r = await window.electronAPI.diag.run();
        if (list) list.innerHTML = this._diagHtml(r);
        const sum = el.querySelector('#diag-sum');
        if (sum && r && r.summary) {
          sum.textContent = '通过 ' + r.summary.ok + ' · 提醒 ' + r.summary.warn + ' · 异常 ' + r.summary.fail;
          sum.style.color = r.summary.fail ? 'var(--danger)' : (r.summary.warn ? 'var(--warn)' : 'var(--ok)');
        }
        const hint = el.querySelector('#diag-hint');
        if (hint) hint.textContent = (r && r.summary && r.summary.fail) ? '有异常项，按下方「修复」提示处理' : '';
      } catch (err) {
        if (list) list.innerHTML = '<p class="text-sm">自检失败：' + Util.escapeHtml(err.message) + '</p>';
      } finally { btn.disabled = false; btn.textContent = '开始自检'; }
    });

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
