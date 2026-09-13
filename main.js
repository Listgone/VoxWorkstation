const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile, spawnSync } = require('child_process');
const { ProjectStore } = require('./project-store');

/* ══════════════════════════════════════════════════════════
   配置：环境变量 > vox.config.json > 内置默认值
   ══════════════════════════════════════════════════════════ */
const DEFAULTS = {
  // 相对路径按「应用目录」解析（见 resolveServerDir），
  // 这样开发时是 <项目>\engine，安装后是 <安装目录>\engine，
  // 不用把某台机器的绝对路径写死进配置
  serverDir: 'engine',
  serverScript: 'server.py',
  pythonPath: 'python',
  serverPort: 8000,
  autoStartServer: true,
  serverStartTimeoutMs: 180000
};

/** 相对路径 → 应用所在目录下的子目录；绝对路径原样返回。
    打包后 __dirname 在 asar 里，不能用，所以按 exe 所在目录取。 */
function appBaseDir() {
  return app.isPackaged ? path.dirname(process.execPath) : __dirname;
}
function resolveServerDir(dir) {
  if (!dir) return dir;
  return path.isAbsolute(dir) ? dir : path.join(appBaseDir(), dir);
}


/* ══════════════════════════════════════════════════════════
   崩溃兜底
   教训：一个「打开模型目录」按钮能把应用点闪退 —— 说明单点异常
   没有任何防护。以下三道防线，任何一道都不该让应用退出。
   ══════════════════════════════════════════════════════════ */
process.on('uncaughtException', (err) => {
  console.error('[guard] 未捕获异常（已拦截，应用继续运行）:', err && err.stack || err);
  try { pushLog('[guard] 未捕获异常：' + (err && err.message || err)); } catch (e) { /* 忽略 */ }
});
process.on('unhandledRejection', (reason) => {
  console.error('[guard] 未处理的 Promise 拒绝（已拦截）:', reason);
  try { pushLog('[guard] 未处理的拒绝：' + (reason && reason.message || reason)); } catch (e) { /* 忽略 */ }
});

/** 安全打开路径：失败时退回 explorer.exe，绝不抛错 */
function safeOpenPath(p) {
  const target = String(p || '').trim();
  if (!target) return { ok: false, message: '路径为空' };
  try {
    if (!fs.existsSync(target)) {
      try { fs.mkdirSync(target, { recursive: true }); } catch (e) { /* 建不了也试着打开父目录 */ }
    }
    const r = shell.openPath(target);
    if (r && typeof r.then === 'function') {
      r.then((err) => {
        if (err) {
          console.warn('[guard] shell.openPath 失败，改用 explorer:', err);
          try { spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { /* 放弃 */ }
        }
      }).catch((e) => console.warn('[guard] openPath 异常:', e));
    }
    return { ok: true };
  } catch (e) {
    console.error('[guard] 打开路径异常:', e);
    try { spawn('explorer', [target], { detached: true, stdio: 'ignore' }).unref(); } catch (e2) { /* 放弃 */ }
    return { ok: false, message: String(e && e.message || e) };
  }
}

function loadConfig() {
  const cfg = { ...DEFAULTS };

  const candidates = [
    path.join(__dirname, 'vox.config.json'),                 // 随应用分发
    path.join(app.getPath('userData'), 'vox.config.json')    // 用户级覆盖
  ];
  for (const file of candidates) {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('[config] 解析失败:', file, e.message);
    }
  }

  if (process.env.VOX_SERVER_DIR) cfg.serverDir = process.env.VOX_SERVER_DIR;
  if (process.env.VOX_PYTHON) cfg.pythonPath = process.env.VOX_PYTHON;
  if (process.env.VOX_SERVER_PORT) cfg.serverPort = Number(process.env.VOX_SERVER_PORT);

  cfg.serverPort = Number(cfg.serverPort) || DEFAULTS.serverPort;
  cfg.serverDir = resolveServerDir(cfg.serverDir);
  cfg.serverScriptPath = path.isAbsolute(cfg.serverScript)
    ? cfg.serverScript
    : path.join(cfg.serverDir, cfg.serverScript);
  return cfg;
}

let CONFIG = { ...DEFAULTS };
let mainWindow = null;
let serverProcess = null;
let serverState = 'idle';                 // idle | starting | ready | error
let lastStatus = { status: 'starting', message: '正在启动 VoxCPM2 引擎...' };

const logBuffer = [];

/* ══════════════════════════════════════════════════════════
   应用设置（主题 / AI 服务 / 输出 / 隐私 …）
   API Key 用 safeStorage 加密，不落明文
   ══════════════════════════════════════════════════════════ */
const APP_SETTINGS_DEFAULTS = {
  theme: 'light',
  font: 'system',              // system | han（都用系统已装字体，不内置字体文件）
  reduceMotion: false,
  uiScale: 1,
  language: 'zh-CN',
  thinking: 'off',               // DeepSeek 思考模式：off 快，on 强（默认关，小任务白等）
  aiModels: {},                // { providerId: { list: [...], at: 时间戳 } } —— 拉取到的真实模型
  ai: {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    timeoutSec: 60,
    retries: 2,
    maxCharsPerCall: 12000
  },
  tts: { autoStart: true, cfg: 2.0, steps: 10, vramWarnPct: 90 },
  output: {
    root: 'D:\\VoxOutput',
    format: 'wav',
    sampleRate: 44100,
    pauseMs: 300,
    naming: '{no}_{role}_{text}',
    exportSrt: true
  },
  project: { autoSaveSec: 30, crashRecovery: true, trashKeepDays: 30 },
  privacy: { redact: false, onlyCurrentParagraph: true, keepDiffHistory: true },
  notify: { soundEnabled: true, sound: 'chime', volume: 70, onDone: true, onFail: true }
};

let appSettings = null;

function settingsFile() { return path.join(app.getPath('userData'), 'app-settings.json'); }
/* API Key 按「服务商」分别存储 —— 各家的 key 互不相同，
   全局存一份会导致切服务商后拿错 key 去请求，报「令牌无效/过期」 */
function keysFile() { return path.join(app.getPath('userData'), 'ai-keys.json'); }
function legacyKeyFile() { return path.join(app.getPath('userData'), 'ai-key.bin'); }

function loadKeys() {
  try {
    const raw = JSON.parse(fs.readFileSync(keysFile(), 'utf8'));
    return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch (e) { return {}; }
}
function writeKeys(map) {
  try { fs.writeFileSync(keysFile(), JSON.stringify(map), 'utf8'); return true; }
  catch (e) { return false; }
}
function encKey(plain) {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(String(plain)).toString('base64')
    : Buffer.from(String(plain), 'utf8').toString('base64');
}
function decKey(b64) {
  try {
    const buf = Buffer.from(String(b64), 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch (e) { return ''; }
}

/** 老版本只存了一份全局 key，迁移到当前服务商名下 */
function migrateLegacyKey() {
  try {
    if (!fs.existsSync(legacyKeyFile())) return;
    let plain = '';
    try {
      const buf = fs.readFileSync(legacyKeyFile());
      plain = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    } catch (e) { plain = ''; }
    if (plain && plain.trim()) {
      const map = loadKeys();
      const p = (appSettings && appSettings.ai && appSettings.ai.provider) || 'deepseek';
      if (!map[p]) { map[p] = encKey(plain.trim()); writeKeys(map); }
    }
    fs.renameSync(legacyKeyFile(), legacyKeyFile() + '.migrated');
  } catch (e) { /* 迁移失败不阻塞启动 */ }
}

function saveApiKey(provider, key) {
  const p = String(provider || 'deepseek');
  // undefined 说明调用链传参丢了，绝不能当成「清空」——直接拒绝，避免静默删库
  if (key === undefined) return { ok: false, message: '未收到 API Key（内部传参错误）' };
  const map = loadKeys();
  const v = String(key).trim();
  if (!v) delete map[p]; else map[p] = encKey(v);
  return writeKeys(map)
    ? { ok: true, encrypted: safeStorage.isEncryptionAvailable() }
    : { ok: false, message: '密钥文件写入失败' };
}
function readApiKey(provider) {
  const map = loadKeys();
  const v = map[String(provider || 'deepseek')];
  return v ? decKey(v) : '';
}
function clearApiKey(provider) {
  const p = String(provider || 'deepseek');
  const map = loadKeys();
  delete map[p];
  return writeKeys(map) ? { ok: true } : { ok: false, message: '密钥文件写入失败' };
}

/** 只给渲染层看「有没有、大概长什么样」，永远不返回明文 */
function maskApiKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '•'.repeat(k.length);
  return k.slice(0, 3) + '•'.repeat(Math.min(24, k.length - 7)) + k.slice(-4);
}

/** 所有服务商的 key 状态（只有掩码与布尔值，没有明文） */
function keyStatus() {
  const map = loadKeys();
  const out = {};
  for (const p of Object.keys(map)) {
    const plain = decKey(map[p]);
    out[p] = { has: !!plain, hint: maskApiKey(plain) };
  }
  return out;
}

function loadAppSettings() {
  const s = JSON.parse(JSON.stringify(APP_SETTINGS_DEFAULTS));
  const saved = (() => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return null; } })();
  if (saved) {
    for (const k of Object.keys(s)) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) Object.assign(s[k], saved[k]);
      else if (saved[k] !== undefined) s[k] = saved[k];
    }
  }
  return s;
}

function saveAppSettings(patch) {
  appSettings = appSettings || loadAppSettings();
  for (const k of Object.keys(patch || {})) {
    if (appSettings[k] && typeof appSettings[k] === 'object' && !Array.isArray(appSettings[k])) {
      Object.assign(appSettings[k], patch[k]);
    } else {
      appSettings[k] = patch[k];
    }
  }
  try { fs.writeFileSync(settingsFile(), JSON.stringify(appSettings, null, 2), 'utf8'); }
  catch (e) { return { ok: false, message: e.message }; }
  if (appSettings.output && appSettings.output.root && store) store.setRoot(appSettings.output.root);
  return { ok: true, settings: appSettings };
}



/* 拉取模型时按用途过滤：本应用只用得上
   · 文本处理（对话 / 推理类语言模型）
   · 配音（语音合成 / 识别，为将来接本地 Vox 预留）
   · 视觉（图片取字 OCR）
   3D / 图像 / 视频 / 向量 / 重排 / 翻译等一律不拉，免得清单里全是没用的 */
const MODEL_UNUSABLE = new RegExp([
  '3d', 'tripo', 'hunyuan3d',
  'text-to-image', 't2i', 'i2i', 'wanx', 'wan2', 'cogview', 'cogvideo',
  'kolors', 'flux', 'diffusion', 'sd3', 'seedream', 'seedance',
  'text-to-video', 't2v', 'i2v', 'kling', 'vidu', 'pixverse', 'image',
  'embedding', 'embed-', 'rerank', 'gme-', 'bge-', 'm3e',
  'translat', 'moderation', 'guard'
].join('|'), 'i');

function isUsableModel(id) {
  const s = String(id || '');
  if (!s) return false;
  return !MODEL_UNUSABLE.test(s);
}

/* ══════════════════════════════════════════════════════════
   项目存储
   ══════════════════════════════════════════════════════════ */
let store = null;

/* ══════════════════════════════════════════════════════════
   AI 服务调用（OpenAI 兼容）—— 统一走这里
   ══════════════════════════════════════════════════════════ */
function aiRequest(baseURL, key, bodyObj, timeoutMs) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(String(baseURL).replace(/\/+$/, '') + '/chat/completions'); }
    catch (e) { return resolve({ ok: false, message: '接口地址格式不对：' + baseURL }); }

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? require('https') : require('http');
    const payload = JSON.stringify(bodyObj);

    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      // 必须 setEncoding：直接 data += c 是每块单独 toString('utf8')，
      // 一个汉字跨块就会被劈成两个 U+FFFD（表现为随机乱码）
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let msg = 'HTTP ' + res.statusCode;
          try { const j = JSON.parse(data); msg = (j.error && j.error.message) || j.message || msg; } catch (e) {}
          return resolve({ ok: false, message: msg, status: res.statusCode });
        }
        try {
          const j = JSON.parse(data);
          const content = j.choices && j.choices[0] && j.choices[0].message
            ? String(j.choices[0].message.content || '') : '';
          resolve({ ok: true, content, usage: j.usage || null });
        } catch (e) { resolve({ ok: false, message: '返回不是合法 JSON：' + data.slice(0, 160) }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: '请求超时' }); });
    req.write(payload);
    req.end();
  });
}

/* 组装请求体。
   DeepSeek 的思考模式默认开启且 effort=high —— 模型会先写一大段思维链
   再作答，200 字的整理任务白等一分钟。默认关掉，需要时可在设置里打开。 */
/** 指向本机的端点不需要鉴权（Ollama / LM Studio 等） */
function isLocalEndpoint(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(String(url || ''));
}

function aiBody(cfg, system, userText, task, options) {
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userText }],
    temperature: task === 'roles' ? 0 : 0.2,
    max_tokens: (options && options.maxTokens) || 8192,
    stream: false
  };
  const isDeepSeek = /deepseek/i.test(cfg.baseURL || '');
  if (isDeepSeek) {
    const mode = (appSettings.ai && appSettings.ai.thinking) || 'off';
    body.thinking = { type: mode === 'on' ? 'enabled' : 'disabled' };
    if (mode === 'on') {
      body.reasoning_effort = (appSettings.ai && appSettings.ai.reasoningEffort) || 'low';
      delete body.temperature;     // 思考模式下该参数不生效
    }
  }
  return body;
}
function currentAI(providerOverride) {
  appSettings = appSettings || loadAppSettings();
  const ai = appSettings.ai || {};
  const prov = providerOverride || ai.provider || 'deepseek';
  return {
    provider: prov,
    baseURL: ai.baseURL || '',
    model: ai.model || 'deepseek-chat',
    timeoutSec: ai.timeoutSec || 60,
    retries: Math.max(0, ai.retries || 0),
    maxChars: ai.maxCharsPerCall || 4000,
    key: readApiKey(prov)
  };
}

/* 每个任务一套 system prompt —— 都强调"只输出结果，不要解释" */
const AI_TASKS = {
  script: {
    label: '整理成剧本',
    system: [
      '你是小说改编配音的剧本整理引擎。请阅读用户提供的小说章节，严格按以下规则整理输出。',
      '',
      '一、输出结构（两段，顺序固定，标题照抄）',
      '【背景介绍（仅供判断，不配音）】',
      '【角色（情绪）+台词（用于配音）】',
      '',
      '二、背景介绍（仅供判断，不配音）',
      '整合以下内容，写成连贯段落：',
      '1. 故事综述；',
      '2. 地点、时间、环境；',
      '3. 关键设定、伏笔、冲突、人物关系；',
      '4. 角色形象描写；',
      '5. 当前场景中谁在对谁说话、各自动机与情绪依据。',
      '注意：背景介绍不参与配音，不要写成台词格式。原文没有的对应内容可省略。',
      '',
      '三、角色（情绪）+台词（用于配音）',
      '1. 只提取明确说出口的对白、引号内台词。',
      '2. 旁白、动作、环境、心理描写不配音，归入背景介绍。',
      '3. 按原文出现顺序输出。',
      '4. 格式固定为：角色名（情绪）+台词',
      '5. 情绪简洁，如：平和、振奋、愁闷、吃惊、从容、愤怒、冷漠、无表情。',
      '6. 角色名和情绪只是标注，不配音；真正配音内容仅为台词本身。',
      '7. 保留台词原文，不改写、不删减、不编造，保留标点和语气词。',
      '8. 不合并不同角色台词；同一角色连续台词逐条保留。',
      '9. 无名角色用稳定代称，如“兽皮中年”“黑衣人”。',
      '10. 若原文有旁白且需要配音，另起「旁白（情绪）+台词」；若不需要，则全部归入背景介绍。',
      '',
      '四、情绪与语气缺失处理',
      '1. 情绪来源分三级：',
      '   A. 原文明确：如“怒道”“笑道”“叹道”“冷冷地说”，直接采用。',
      '   B. 原文可推断：根据动作、神态、上下文判断，但必须标注“推断：××”。',
      '   C. 原文无信息：标注“未标明”或“中性”，不得编造情绪。',
      '2. 输出格式兼容：',
      '   - 有明确情绪：角色（愤怒）+台词',
      '   - 可推断情绪：角色（推断：无奈）+台词',
      '   - 无信息：角色（未标明）+台词，或 角色（中性）+台词',
      '3. 配音处理：',
      '   - “未标明/中性” → TTS 默认中性、平和语气。',
      '   - “推断：××” → 仅作配音参考，不强制。',
      '   - 标点可辅助语气：问号→疑问，感叹号→感叹，省略号→迟疑/低沉。',
      '   - 角色名、情绪、语气标注都不配音，只读台词本身。',
      '4. 背景介绍中可注明：“原文未提供明确情绪/语气，建议按中性处理。”',
      '',
      '五、约束',
      '1. 只依据原文整理。',
      '2. 原文没有的内容不编造。',
      '3. 若没有角色形象或关键补充，可省略对应内容。',
      '4. 背景介绍仅用于判断，不进入配音文本。',
      '',
      '只输出这两段，不要解释，不要编号，不要用 markdown，不要用代码块包裹。',
      '台词过长时在语义完整处断成多行，角色名与括号里的情绪照抄。'
    ].join('\n')
  },
  normalize: {
    label: '文本规范化',
    system: '你是中文 TTS 文本规范化引擎。把输入文本里的阿拉伯数字、日期、百分比、单位、'
      + '英文缩写改写成适合朗读的中文口语形式。规则：2024年→二零二四年；3.14%→百分之三点一四；'
      + 'IDC→I D C（缩写逐字母，字母间加空格）；km→公里；$→美元。'
      + '除上述改写外，一个字都不要动，不要增删标点，不要换行。只输出改写后的文本，不要任何解释。'
  },
  split: {
    label: '智能断句',
    system: '你是中文配音断句引擎。把输入文本按语义切分成适合 TTS 朗读的短句。'
      + '要求：每句不超过指定字数；在语义完整处断开，不要把一个词组拆开；'
      + '保留原文用词，不改写、不增删内容；每句占一行。只输出句子，不要编号，不要解释。'
  },
  tone: {
    label: '语气标注',
    system: '你是 VoxCPM2 语气标注引擎。通读台词，在情绪明显的位置插入语气标记。'
      + '可用标记：[laughing] 笑 [sigh] 叹息 [Uhm] 思考 [Question-ah] 疑问 [Question-en] 反问 '
      + '[Surprise-wa] 惊讶 [Dissatisfaction-hnn] 不满 [Shh] 安静。'
      + '标记放在情绪发生的句子开头或对应词之前。标记要克制，全篇不超过总句数的三分之一。'
      + '不要改写文字，只在合适位置插入标记。只输出标注后的文本，不要解释。'
  },
  roles: {
    label: '角色分离',
    system: '你是剧本角色识别引擎。识别输入文本里「角色名：台词」这种格式，'
      + '拆成角色与台词。如果原文没有角色标记，把整段归给「旁白」。'
      + '严格输出 JSON 数组，形如 [{"role":"旁白","text":"..."}]，不要输出任何其他内容，不要用 markdown 代码块包裹。'
  }
};

function aiChunks(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const out = [];
  let buf = '';
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const p of paras) {
    if (p.length > maxChars) {
      push();
      for (let i = 0; i < p.length; i += maxChars) out.push(p.slice(i, i + maxChars));
    } else if ((buf + '\n\n' + p).length > maxChars) { push(); buf = p; }
    else buf = buf ? buf + '\n\n' + p : p;
  }
  push();
  return out.length ? out : [text];
}

async function aiRun(task, text, options = {}) {
  const cfg = currentAI();
  // 本地部署（Ollama / LM Studio 等）不需要 API Key
  if (!cfg.key && !isLocalEndpoint(cfg.baseURL)) {
    return { ok: false, message: '未配置 API Key（设置 → AI 服务）' };
  }
  if (!cfg.baseURL) return { ok: false, message: '未配置接口地址（设置 → AI 服务）' };
  const spec = AI_TASKS[task];
  if (!spec) return { ok: false, message: '未知任务：' + task };

  let system = spec.system;
  if (task === 'split' || task === 'script') system += '\n每句台词不超过 ' + (options.maxLen || 25) + ' 字。';
  if (options.projectPrompt) system += '\n项目背景：' + options.projectPrompt;
  if (options.dict && options.dict.length) {
    system += '\n必须遵守的读音约定：' + options.dict.map(d => d.word + ' 读作 ' + d.reading).join('；') + '。';
  }

  // 剧本整理必须整章一次做完：
  // 分段会让每段各自输出一遍【背景介绍】+【角色…】，结构就烂了，
  // 而且串行多次调用非常慢。1M 上下文的模型完全吃得下整章。
  const noChunk = (task === 'script' || task === 'roles');
  const parts = noChunk ? [text] : aiChunks(text, cfg.maxChars);
  const outs = new Array(parts.length).fill('');
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  const runOne = async (i) => {
    let r = null;
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      r = await aiRequest(cfg.baseURL, cfg.key, aiBody(cfg, system, parts[i], task, options),
        Math.min(300000, cfg.timeoutSec * 1000));
      if (r.ok) break;
      if (attempt < cfg.retries) await new Promise(res => setTimeout(res, 500));
    }
    return r;
  };

  // 分段任务并行跑（各段互相独立，顺序由下标保证），
  // 串行是最主要的耗时来源：5 段就是 5 倍等待
  const started = Date.now();
  const CONC = Math.max(1, Math.min(4, parts.length));
  if (parts.length === 1) {
    const r = await runOne(0);
    if (!r || !r.ok) return { ok: false, message: (r && r.message) || '调用失败', done: 0, total: 1 };
    outs[0] = String(r.content || '').trim();
    if (r.usage) {
      usage.prompt_tokens += r.usage.prompt_tokens || 0;
      usage.completion_tokens += r.usage.completion_tokens || 0;
    }
    if (send && mainWindow) send('vox:ai-progress', { task, done: 1, total: 1 });
  } else {
    let next = 0, finished = 0, firstErr = null;
    await Promise.all(new Array(CONC).fill(0).map(async () => {
      while (true) {
        const i = next++;
        if (i >= parts.length || firstErr) return;
        const r = await runOne(i);
        if (!r || !r.ok) { firstErr = firstErr || { i, r }; return; }
        outs[i] = String(r.content || '').trim();
        if (r.usage) {
          usage.prompt_tokens += r.usage.prompt_tokens || 0;
          usage.completion_tokens += r.usage.completion_tokens || 0;
        }
        finished++;
        if (send && mainWindow) send('vox:ai-progress', { task, done: finished, total: parts.length });
      }
    }));
    if (firstErr) {
      return { ok: false, message: (firstErr.r && firstErr.r.message) || '调用失败',
               done: finished, total: parts.length };
    }
  }
  const elapsedMs = Date.now() - started;

  let content = outs.join('\n');
  if (task === 'roles') {
    // 容错：剥掉可能的 markdown 代码块
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr)) throw new Error('不是数组');
      return { ok: true, roles: arr, usage, chunks: parts.length, elapsedMs };
    } catch (e) {
      return { ok: false, message: '模型返回的角色 JSON 解析失败：' + content.slice(0, 120) };
    }
  }
  return { ok: true, text: content, usage, chunks: parts.length, elapsedMs };
}

/* ══════════════════════════════════════════════════════════
   与渲染进程通信
   ══════════════════════════════════════════════════════════ */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setStatus(status) {
  lastStatus = status;
  send('server-status', status);
}

function pushLog(chunk) {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    logBuffer.push(line);
    if (logBuffer.length > 200) logBuffer.shift();
    send('server-log', line);
  }
}

/* ══════════════════════════════════════════════════════════
   后端进程管理
   ══════════════════════════════════════════════════════════ */
function probe(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/gpu/memory', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** 结束整个后端进程树。
 *  Windows 上 child.kill() 只杀直接子进程，server.py 里再 spawn 的东西会变僵尸。*/
/**
 * 找一个能用的端口：先试配置里的，被占用就依次往后试。
 * 端口冲突是「后端进程启动后立即退出（code=3）」最常见的原因 ——
 * uvicorn 绑不上会直接退出，而客户端只看到一个没头没尾的退出码。
 */
function findFreePort(start, tries = 20) {
  return new Promise((resolve) => {
    let port = start;
    let n = 0;
    const attempt = () => {
      if (n++ >= tries) return resolve(start);   // 都占着就退回原端口，让错误显式暴露
      const srv = require('net').createServer();
      srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') { port++; attempt(); }
        else resolve(port);
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      try { srv.listen(port, '127.0.0.1'); } catch (e) { port++; attempt(); }
    };
    attempt();
  });
}

function killServerTree() {
  const child = serverProcess;
  serverProcess = null;
  if (!child || child.exitCode !== null || child.killed) return;

  pushLog(`[shell] 结束后端进程 (pid=${child.pid})`);
  if (process.platform === 'win32') {
    try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {}); } catch (e) {}
  } else {
    try { child.kill('SIGTERM'); } catch (e) {}
  }
}

function startServer() {
  return new Promise(async (resolve) => {
    const { serverScriptPath, serverDir, pythonPath } = CONFIG;
    const serverStartTimeoutMs = CONFIG.serverStartTimeoutMs;
    // 配置端口被别的程序占用时自动换一个，用户不必操心
    const usePort = await findFreePort(CONFIG.serverPort);
    if (usePort !== CONFIG.serverPort) {
      pushLog(`[shell] 端口 ${CONFIG.serverPort} 被占用，改用 ${usePort}`);
      CONFIG.serverPort = usePort;          // 让 getServerUrl / 自检都跟着走
    }
    const serverPort = usePort;

    if (!fs.existsSync(serverScriptPath)) {
      resolve({ ok: false, message: `找不到后端脚本：${serverScriptPath}（可在 vox.config.json 配置 serverDir）` });
      return;
    }

    serverState = 'starting';
    pushLog(`[shell] 启动后端：${pythonPath} "${serverScriptPath}"`);

    let child;
    try {
      child = spawn(pythonPath, [serverScriptPath], {
        cwd: serverDir,
      env: { ...process.env, VOX_PORT: String(serverPort), PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, message: '无法启动 Python：' + e.message });
      return;
    }
    serverProcess = child;

    // server.py 的 print/异常全部转发到加载页，不再"静默 180 秒然后超时"
    // 用 StringDecoder 级别的流式解码，避免中文日志被块边界劈开
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    // 后端在绑定成功后会打印 VOX_PORT_ACTUAL=<port>，
    // 用它同步真实端口 —— 比客户端预判可靠（Windows 端口排除段很宽）
    let _portScan = '';
    child.stdout?.on('data', (s) => {
      pushLog(s);
      if (!_portScan && s.indexOf('VOX_PORT_ACTUAL') < 0) return;
      _portScan += s;
      const mm = _portScan.match(/VOX_PORT_ACTUAL=(\d+)/);
      if (mm) {
        const actual = Number(mm[1]);
        _portScan = '!done';
        if (actual !== CONFIG.serverPort) {
          pushLog('[shell] 后端实际监听 ' + actual + '（配置为 ' + CONFIG.serverPort + '），已同步');
          CONFIG.serverPort = actual;
        }
      }
    });
    child.stderr?.on('data', (s) => pushLog(s));

    let settled = false;
    let poll = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (poll) clearInterval(poll);
      serverState = result.ok ? 'ready' : 'error';
      resolve(result);
    };

    child.on('error', (err) => {
      const message = err.code === 'ENOENT'
        ? `找不到 Python 可执行文件「${pythonPath}」，请在 vox.config.json 里配置 pythonPath`
        : err.message;
      pushLog('[shell] ' + message);
      finish({ ok: false, message });
    });

    child.on('exit', (code, signal) => {
      pushLog(`[shell] 后端进程退出 (code=${code}, signal=${signal})`);
      if (serverProcess === child) serverProcess = null;
      if (!settled) {
        finish({ ok: false, message: `后端进程启动后立即退出（code=${code}），请查看上方日志` });
      } else if (serverState === 'ready') {
        serverState = 'error';
        setStatus({ status: 'error', message: '后端进程意外退出' });
      }
    });

    const startedAt = Date.now();
    poll = setInterval(async () => {
      if (await probe(serverPort)) {
        // 端口通了不代表模型就绪：后端改成后台加载，模型可能还在读盘。
        // 先把界面放出来（状态标为 loading），后台继续等 /api/ready。
        pushLog('[shell] 后端服务已响应，模型仍在后台加载');
        finish({ ok: true, engineLoading: true });
        watchEngineReady();
        return;
      }
      if (Date.now() - startedAt > serverStartTimeoutMs) {
        finish({ ok: false, message: `等待后端超时（${Math.round(serverStartTimeoutMs / 1000)} 秒）` });
      }
    }, 1000);
  });
}

/** 轮询 /api/ready，模型加载完成后通知渲染层解除生成按钮的禁用 */
let enginePoll = null;
let _lastDlMb = -1;
let _stuckSec = 0;
function watchEngineReady() {
  if (enginePoll) return;
  let deadline = Date.now() + 15 * 60 * 1000;   // 加载模型可能很久
  enginePoll = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(enginePoll); enginePoll = null;
      setStatus({ status: 'error', message: '等待引擎就绪超时' });
      return;
    }
    const r = await getJson(`http://127.0.0.1:${CONFIG.serverPort}/api/ready`);
    if (!r) return;
    if (r.ready) {
      clearInterval(enginePoll); enginePoll = null;
      serverState = 'ready';
      pushLog(`[shell] 引擎就绪（耗时 ${(r.elapsed_ms / 1000).toFixed(1)}s）`);
      setStatus({ status: 'engine-ready' });
      return;
    }
    if (r.error) {
      clearInterval(enginePoll); enginePoll = null;
      serverState = 'error';
      pushLog(`[shell] 引擎加载失败：${r.error}`);
      setStatus({ status: 'error', message: '引擎加载失败：' + r.error });
      return;
    }
    // 正在下载模型：下载可能要几十分钟，不能按「加载超时」算，
    // 每次都把截止时间往后推，并把进度报给界面
    if (r.phase === 'downloading') {
      deadline = Math.max(deadline, Date.now() + 15 * 60 * 1000);
      // 卡住检测：进度长时间不动就提示，别让用户干等
      const mb = r.downloaded_mb || 0;
      if (mb === _lastDlMb) {
        _stuckSec += 1.2;
      } else {
        _stuckSec = 0;
        _lastDlMb = mb;
      }
      if (_stuckSec > 45) {
        setStatus({ status: 'engine-downloading', progress: r.progress || 0,
                    downloadedMb: mb, expectedMb: r.expected_mb || 0,
                    mbps: 0, stalled: true });
        return;
      }
      setStatus({
        status: 'engine-downloading',
        progress: r.progress || 0,
        downloadedMb: r.downloaded_mb || 0,
        expectedMb: r.expected_mb || 0
      });
    }
  }, 1200);
}

/** 轻量 GET JSON，失败返回 null（不抛） */
function getJson(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, { timeout: 4000 }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function ensureServer() {
  // 注意：凡是「服务已经在跑」的早退分支，都必须启动 watchEngineReady()。
  // 否则收不到 engine-downloading / engine-ready 事件 ——
  // 表现就是一键配置走到 58%（交接点）后进度再也不动。
  if (serverState === 'ready') { watchEngineReady(); return { ok: true }; }

  // 端口上已经有服务在跑（例如上次启动的后端还活着，或用户自己启动过）
  // → 直接复用，避免再拉一个绑不上端口的进程造成假象
  if (await probe(CONFIG.serverPort)) {
    pushLog(`[shell] 端口 ${CONFIG.serverPort} 已有后端在运行，直接复用`);
    serverState = 'ready';
    watchEngineReady();
    return { ok: true, reused: true };
  }

  if (!CONFIG.autoStartServer) {
    return { ok: false, message: `后端未运行，且 autoStartServer=false（端口 ${CONFIG.serverPort}）` };
  }
  return startServer();
}

/* ══════════════════════════════════════════════════════════
   窗口
   ══════════════════════════════════════════════════════════ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 680,
    frame: false,
    backgroundColor: '#0f1117',
    icon: path.join(__dirname, 'assets', 'icons', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 首屏渲染完成时补发一次当前状态。
  // 否则：后端早已在跑时 ensureServer() 会在渲染进程注册监听之前就返回，
  // ready 事件丢失 → 界面永远卡在加载页。
  mainWindow.webContents.once('did-finish-load', () => {
    logBuffer.slice(-4).forEach((line) => send('server-log', line));
    send('server-status', lastStatus);
  });

  // 安全兜底：外链交给系统浏览器，禁止应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ══════════════════════════════════════════════════════════
   IPC
   ══════════════════════════════════════════════════════════ */
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('get-server-url', () => `http://127.0.0.1:${CONFIG.serverPort}`);
ipcMain.handle('get-config', () => ({
  serverPort: CONFIG.serverPort,
  serverDir: CONFIG.serverDir,
  pythonPath: CONFIG.pythonPath
}));
ipcMain.handle('restart-server', async () => {
  killServerTree();
  serverState = 'idle';
  const res = await ensureServer();
  if (res.ok) setStatus({ status: 'ready' });
  return res;
});

/* ══════════════════════════════════════════════════════════
   自检 —— 逐项检测并给出可执行的修复建议
   ══════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════
   一键配置 —— 让用户不必自己找后端、装依赖
   ══════════════════════════════════════════════════════════ */

/** 默认安装位置：有 D 盘就放 D:\VoxWorkstation\engine，否则放用户目录 */
function defaultEngineDir() {
  const preferred = 'D:\\VoxWorkstation\\engine';
  try {
    if (fs.existsSync('D:\\')) return preferred;
  } catch (e) { /* 没有 D 盘 */ }
  return path.join(app.getPath('userData'), 'engine');
}

function pythonCandidates() {
  const list = [CONFIG.pythonPath || 'python', 'python3', 'py'];
  return [...new Set(list)];
}

/** 探测 Python 是否可用，并检查关键依赖装没装 */
ipcMain.handle('vox:setup:detect', async () => {
  const probe = `
import json,sys
out={"python":sys.version.split()[0],"exe":sys.executable}
try:
    import importlib.metadata as md
    out["voxcpm"]=md.version("voxcpm")
except Exception:
    out["voxcpm"]=""
try:
    import torch; out["torch"]=torch.__version__
    out["cuda"]=bool(torch.cuda.is_available())
    out["gpu"]=torch.cuda.get_device_name(0) if torch.cuda.is_available() else ""
except Exception:
    out["torch"]=""; out["cuda"]=False; out["gpu"]=""
print(json.dumps(out))
`;
  for (const py of pythonCandidates()) {
    const r = await new Promise((resolve) => {
      try {
        const c = spawn(py, ['-c', probe], { windowsHide: true });
        let o = '', e2 = '';
        c.stdout.on('data', d => o += d);
        c.stderr.on('data', d => e2 += d);
        c.on('error', () => resolve(null));
        c.on('close', () => {
          try { resolve(JSON.parse(o.trim().split('\n').pop())); }
          catch (err) { resolve({ error: (e2 || o || '').slice(0, 200) }); }
        });
      } catch (e) { resolve(null); }
    });
    if (r && !r.error) return { ok: true, ...r, exe: r.exe || py };
  }
  return { ok: false, message: '未检测到可用的 Python' };
});

/** 一键配置：建目录 → 放后端脚本 → 装依赖。模型由后端首次启动时自动下载。 */
/** 下载文件并报告进度 */
function downloadTo(url, dest, emit, label) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const f = fs.createWriteStream(dest);
    mod.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); fs.rmSync(dest, { force: true });
        return downloadTo(res.headers.location, dest, emit, label).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        f.close(); fs.rmSync(dest, { force: true });
        return reject(new Error('下载失败 HTTP ' + res.statusCode + '：' + url));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      res.on('data', (d) => {
        got += d.length; f.write(d);
        if (total) {
          const pct = Math.round(got / total * 100);
          emit('download',
               label + ' ' + (got / 1048576).toFixed(1) + ' / '
                 + (total / 1048576).toFixed(1) + ' MB（' + pct + '%）',
               got / total,                       // 真实进度，供上层映射
               '步骤 2/5 · Python 环境');
        }
      });
      res.on('end', () => f.end(() => resolve(dest)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** 便携版 Python：装在软件自己的目录里，不碰系统、不需要管理员权限 */
async function ensurePortablePython(engineDir, emit) {
  const PY_VER = '3.10.11';
  const PY_URL = `https://www.python.org/ftp/python/${PY_VER}/python-${PY_VER}-embed-amd64.zip`;
  const runtime = path.join(engineDir, 'runtime');
  const pyExe = path.join(runtime, 'python.exe');

  if (fs.existsSync(pyExe)) return pyExe;

  fs.mkdirSync(runtime, { recursive: true });
  const zip = path.join(runtime, 'py-embed.zip');
  const pyEmit = (stage, msg, frac) =>
    emit(stage, msg, frac == null ? null : 0.03 + frac * 0.09, '步骤 2/5 · Python 环境');
  emit('python', '正在下载 Python 运行环境（约 8 MB）…', 0.03, '步骤 2/5 · Python 环境');
  await downloadTo(PY_URL, zip, pyEmit, '正在下载 Python');

  emit('python', '正在解压…', 0.10, '步骤 2/5 · Python 环境');
  const r = spawnSync('tar', ['-xf', zip, '-C', runtime], { windowsHide: true });
  if (r.status !== 0) {
    // 兜底：用 PowerShell 解压
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${runtime}' -Force`], { windowsHide: true });
  }
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(pyExe)) throw new Error('Python 解压失败');

  // 启用 site-packages（嵌入版默认关掉，不开的话装不了任何包）
  const pth = fs.readdirSync(runtime).find(f => /^python\d+\._pth$/.test(f));
  if (pth) {
    const p = path.join(runtime, pth);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^#\s*import site/m, 'import site'), 'utf8');
  }

  // 装 pip
  emit('python', '正在准备 pip…', 0.11, '步骤 2/5 · Python 环境');
  const getpip = path.join(runtime, 'get-pip.py');
  await downloadTo('https://bootstrap.pypa.io/get-pip.py', getpip, pyEmit, '正在准备 pip');
  const pipR = spawnSync(pyExe, [getpip, '--no-warn-script-location'], { windowsHide: true, cwd: runtime, encoding: 'utf8' });
  fs.rmSync(getpip, { force: true });
  if (pipR.status !== 0) throw new Error('pip 安装失败：' + String(pipR.stderr || '').slice(-200));
  return pyExe;
}

ipcMain.handle('vox:setup:auto', async (_e, opts) => {
  const dir = (opts && opts.dir) || defaultEngineDir();
  const emit = (stage, message, progress, caption) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vox:setup-progress', { stage, message, progress, caption });
    }
  };
  try {
    /* 1) 目录 + 后端脚本（随安装包分发，无需联网） */
    emit('files', '正在创建后端目录…', 0.01, '步骤 1/5 · 创建后端目录');
    fs.mkdirSync(path.join(dir, 'pretrained_models'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'history'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'voice_profiles'), { recursive: true });
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'bootstrap')
      : path.join(__dirname, 'bootstrap');
    for (const f of ['server.py', 'requirements.txt']) {
      const s = path.join(srcDir, f);
      if (!fs.existsSync(s)) throw new Error('安装包缺少 ' + f);
      fs.copyFileSync(s, path.join(dir, f));
    }
    if (!fs.existsSync(path.join(dir, 'custom_presets.json'))) {
      fs.writeFileSync(path.join(dir, 'custom_presets.json'), '{}', 'utf8');
    }
    emit('files', '后端脚本已就位', 0.03, '步骤 1/5 · 创建后端目录');

    /* 2) 找 Python：先看系统里有没有能用的，没有就装便携版 */
    let py = null;
    for (const c of pythonCandidates()) {
      const ok = spawnSync(c, ['-c', 'import voxcpm'], { windowsHide: true }).status === 0;
      if (ok) { py = c; break; }
    }
    if (py) {
      emit('python', '使用系统已装好的 Python（' + py + '）', 0.12, '步骤 2/5 · Python 环境');
    } else {
      emit('python', '未检测到可用的 Python，正在安装便携版到软件目录…', 0.04, '步骤 2/5 · Python 环境');
      py = await ensurePortablePython(dir, emit);
      emit('python', 'Python 运行环境已就绪', 0.12, '步骤 2/5 · Python 环境');
    }

    /* 3) 依赖 */
    emit('pip', '正在安装依赖（首次约 2–3 GB，可以放着不管）…', 0.12, '步骤 3/5 · 安装依赖');
    const req = path.join(dir, 'requirements.txt');
    await new Promise((resolve, reject) => {
      const c = spawn(py, ['-m', 'pip', 'install', '-r', req,
                           '--extra-index-url', 'https://download.pytorch.org/whl/cu121',
                           '--disable-pip-version-check', '--no-warn-script-location'],
                      { windowsHide: true, cwd: dir });
      let buf = '';
      // 依赖总量约 2.5 GB；按 pip 输出的「已下载 MB」推进进度条，
      // 否则这一步几分钟内条子完全不动，看着像卡死
      const EST_MB = 2500;
      let gotMb = 0;
      const onData = (d) => {
        buf += String(d);
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const ln of lines) {
          const m = ln.match(/Downloading\s+\S+\s+\(([\d.]+)\s*([kMG])B\)/i);
          if (m) {
            const v = parseFloat(m[1]);
            const u = m[2].toUpperCase();
            gotMb += u === 'G' ? v * 1024 : (u === 'K' ? v / 1024 : v);
          }
        }
        const last = lines.filter(Boolean).pop();
        if (last) {
          const pct = Math.min(99, Math.round(Math.min(gotMb, EST_MB) / EST_MB * 100));
          emit('pip', last.trim().slice(0, 130), null,
               gotMb > 0 ? '依赖已下载 ' + Math.round(gotMb) + ' MB（' + pct + '%）' : '');
        }
        const frac = Math.min(0.99, gotMb / EST_MB);
        emit('pip', '', 0.12 + frac * 0.43);
      };
      c.stdout.on('data', onData);
      c.stderr.on('data', onData);
      c.on('error', reject);
      c.on('close', (code) => code === 0 ? resolve() : reject(new Error('依赖安装失败（退出码 ' + code + '）')));
    });
    emit('pip', '依赖安装完成', 0.55, '依赖已就绪');

    /* 4) 写配置并启动（模型由后端自动下载） */
    emit('config', '正在写入配置…', 0.56, '步骤 4/5 · 写入配置');
    const file = path.join(app.getPath('userData'), 'vox.config.json');
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { /* 首次 */ }
    cur.serverDir = dir;
    cur.pythonPath = py;
    fs.writeFileSync(file, JSON.stringify(cur, null, 2), 'utf8');
    CONFIG = loadConfig();
    killServerTree();
    serverState = 'idle';
    if (enginePoll) { clearInterval(enginePoll); enginePoll = null; }
    emit('start', '正在启动后端…', 0.58, '步骤 5/5 · 下载语音模型');
    const res = await ensureServer();
    return { ok: res.ok !== false, dir, python: py, message: res.message || '' };
  } catch (e) {
    return { ok: false, dir, message: e.message };
  }
});
/* ── 首次启动引导：后端目录设置 ────────────────────── */
ipcMain.handle('vox:setup:status', () => ({
  serverDir: CONFIG.serverDir,
  scriptPath: CONFIG.serverScriptPath,
  exists: fs.existsSync(CONFIG.serverScriptPath),
  pythonPath: CONFIG.pythonPath,
  userConfigFile: path.join(app.getPath('userData'), 'vox.config.json')
}));

/** 校验用户选的目录里有没有 server.py */
/** 返回模型应放的位置（顺带建好目录），供「打开模型目录」使用 */
ipcMain.handle('vox:setup:modelDir', () => {
  let dir = '';
  try {
    const base = CONFIG && CONFIG.serverDir ? String(CONFIG.serverDir) : '';
    dir = base ? path.join(base, 'pretrained_models', 'VoxCPM2') : '';
  } catch (e) { dir = ''; }
  if (!dir) return { ok: false, dir: '', message: '后端目录尚未确定' };
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 建不了也返回路径 */ }
  const weight = path.join(dir, 'model.safetensors');
  let mb = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) mb += st.size;
    }
  } catch (e) { /* 空目录 */ }
  return { ok: true, dir, hasModel: fs.existsSync(weight), sizeMb: Math.round(mb / 1048576) };
});

ipcMain.handle('vox:setup:validate', (_e, dir) => {
  if (!dir) return { ok: false, message: '未选择目录' };
  const sp = path.join(dir, String(CONFIG.serverScript || 'server.py'));
  if (!fs.existsSync(sp)) {
    return { ok: false, message: '该目录下没有找到 ' + path.basename(sp) };
  }
  const mdir = path.join(dir, 'pretrained_models', 'VoxCPM2');
  const weight = path.join(mdir, 'model.safetensors');
  const vae = path.join(mdir, 'audiovae.pth');
  const hasModel = fs.existsSync(weight) && fs.existsSync(vae);
  let sizeMb = 0;
  if (hasModel) {
    try {
      for (const f of fs.readdirSync(mdir)) {
        const st = fs.statSync(path.join(mdir, f));
        if (st.isFile()) sizeMb += st.size;
      }
      sizeMb = Math.round(sizeMb / 1048576);
    } catch (e) { /* 读不到就算了 */ }
  }
  return {
    ok: true,
    scriptPath: sp,
    modelDir: mdir,
    hasModel,
    sizeMb,
    // 这样用户自己下好模型后，指定目录就能直接用，不会重复下载
    message: hasModel
      ? '已识别到模型（' + sizeMb + ' MB），可直接使用，不会重复下载'
      : '找到后端，但还没有模型 —— 启动后会自动下载约 4.7 GB；' +
        '你也可以自己下好放进 ' + mdir
  };
});

/** 把后端目录写进用户级配置并重启后端 */
ipcMain.handle('vox:setup:apply', async (_e, dir) => {
  try {
    const file = path.join(app.getPath('userData'), 'vox.config.json');
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 首次 */ }
    cur.serverDir = dir;
    fs.writeFileSync(file, JSON.stringify(cur, null, 2), 'utf8');

    CONFIG = loadConfig();          // 重新读配置
    killServerTree();
    serverState = 'idle';
    if (enginePoll) { clearInterval(enginePoll); enginePoll = null; }
    const res = await ensureServer();
    return { ok: res.ok !== false, message: res.message || '', config: file };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('vox:diag:run', async () => {
  const checks = [];
  const add = (name, level, detail, fix) => checks.push({ name, level, detail, fix: fix || '' });
  const base = `http://127.0.0.1:${CONFIG.serverPort}`;

  const ready = await getJson(base + '/api/ready');
  if (!ready) {
    add('后端服务', 'fail', `端口 ${CONFIG.serverPort} 无响应`,
        '在「设置 → TTS 引擎」确认后端目录与 Python 路径；或手动运行 start_app.bat 看报错。'
      + '若端口被占用，改 vox.config.json 里的 serverPort。');
  } else {
    add('后端服务', 'ok', `已在 ${base} 响应`, '');
    if (ready.ready) {
      add('语音引擎', 'ok', `模型已就绪（加载耗时 ${(ready.elapsed_ms / 1000).toFixed(1)}s）`, '');
    } else if (ready.error) {
      add('语音引擎', 'fail', '模型加载失败：' + ready.error,
          '多为显存不足或模型文件损坏。关掉占显存的程序后重试；'
        + '仍失败可删除 pretrained_models/VoxCPM2 让它重新下载。');
    } else {
      add('语音引擎', 'warn', '模型仍在加载中',
          '首次加载需 1–3 分钟属正常。若超过 5 分钟无变化，查看后端日志。');
    }
  }

  const sp = CONFIG.serverScriptPath || path.join(CONFIG.serverDir, 'server.py');
  if (fs.existsSync(sp)) add('后端脚本', 'ok', sp, '');
  else add('后端脚本', 'fail', '找不到 ' + sp,
           '在 vox.config.json 里把 serverDir 指向 server.py 所在目录。');

  const py = await new Promise(res => {
    try {
      const c = spawn(CONFIG.pythonPath, ['--version'], { stdio: 'ignore', windowsHide: true });
      c.on('error', () => res(false));
      c.on('exit', code => res(code === 0));
    } catch (e) { res(false); }
  });
  if (py) add('Python', 'ok', CONFIG.pythonPath + ' 可执行', '');
  else add('Python', 'fail', '无法执行「' + CONFIG.pythonPath + '」',
           '确认 Python 已装并加入 PATH，或在 vox.config.json 里把 pythonPath 写成 python.exe 的完整路径。');

  const root = (appSettings.output && appSettings.output.root) || '';
  if (!root) {
    add('输出目录', 'warn', '未设置', '在「设置 → 音频输出」里选一个目录。');
  } else if (!fs.existsSync(root)) {
    try { fs.mkdirSync(root, { recursive: true }); add('输出目录', 'ok', '已创建 ' + root, ''); }
    catch (e) { add('输出目录', 'fail', '无法创建 ' + root + '：' + e.message, '换一个有写权限的目录。'); }
  } else {
    try {
      const probe = path.join(root, '.vox-write-test');
      fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true });
      add('输出目录', 'ok', root + ' 可写', '');
    } catch (e) { add('输出目录', 'fail', '不可写：' + e.message, '换目录，或给该目录写权限。'); }
  }

  try {
    const st = fs.statfsSync(root && fs.existsSync(root) ? root : app.getPath('userData'));
    const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
    add('磁盘空间', freeGb < 2 ? 'warn' : 'ok', `可用 ${freeGb.toFixed(1)} GB`,
        freeGb < 2 ? '音频文件很占地方，建议清理或换盘。' : '');
  } catch (e) { add('磁盘空间', 'warn', '无法读取', ''); }

  const prov = (appSettings.ai && appSettings.ai.provider) || 'deepseek';
  const ks = keyStatus()[prov] || {};
  if (prov === 'ollama') {
    const ol = await getJson('http://127.0.0.1:11434/api/tags');
    add('本地 Ollama', ol ? 'ok' : 'warn', ol ? '服务在线' : '127.0.0.1:11434 无响应',
        ol ? '' : '本地模型需要先启动 Ollama（装完它会常驻后台）。');
  } else if (ks.has) {
    add('AI 服务', 'ok', `${prov} 已配置 Key（${ks.hint}）`, '');
  } else {
    add('AI 服务', 'warn', `${prov} 未配置 Key`,
        '要用「整理成剧本」等 AI 功能需要配置；只在本地做规范化/分句则可以不配。');
  }

  /* 引擎版本 —— 与「本地模型是否需要更新」有关 */
  if (ready && ready.engine) {
    const e = ready.engine;
    add('引擎版本', 'ok',
        'voxcpm ' + e.voxcpm + ' · torch ' + e.torch + (e.gpu ? ' · ' + e.gpu : ''), '');
  } else if (ready) {
    add('引擎版本', 'warn', '后端未返回版本信息',
        '后端不是本次配套的 server.py，建议同步更新（见 README）。');
  }

  try { fs.accessSync(app.getPath('userData'), fs.constants.W_OK);
        add('配置目录', 'ok', app.getPath('userData'), ''); }
  catch (e) { add('配置目录', 'fail', '不可写：' + e.message, '检查该目录权限，或删除后重启软件。'); }

  return {
    ok: true, checks,
    summary: {
      ok: checks.filter(c => c.level === 'ok').length,
      warn: checks.filter(c => c.level === 'warn').length,
      fail: checks.filter(c => c.level === 'fail').length
    },
    env: {
      electron: process.versions.electron, chrome: process.versions.chrome,
      node: process.versions.node, platform: process.platform + ' ' + process.arch,
      serverDir: CONFIG.serverDir, pythonPath: CONFIG.pythonPath,
      serverPort: CONFIG.serverPort, outputRoot: root
    }
  };
});
/* ══════════════════════════════════════════════════════════
   项目 / 集 / 设置 IPC
   ══════════════════════════════════════════════════════════ */
const needStore = () => {
  if (!store) {
    appSettings = appSettings || loadAppSettings();
    store = new ProjectStore(appSettings.output.root);
  // 启动时清理回收站里超过保留天数的条目（默认 30 天）
  try {
    const keep = (appSettings.project && appSettings.project.trashKeepDays) || 30;
    const r = store.autoPurgeTrash(keep);
    if (r.removed) console.log('[shell] 回收站自动清理 ' + r.removed + ' 项（超过 ' + keep + ' 天）');
  } catch (e) { /* 不影响启动 */ }
  }
  return store;
};

ipcMain.handle('vox:settings:get', () => {
  appSettings = appSettings || loadAppSettings();
  return {
    settings: appSettings,
    keyStatus: keyStatus(),
    keyEncrypted: safeStorage.isEncryptionAvailable(),
    userData: app.getPath('userData')
  };
});
ipcMain.handle('vox:settings:save', (_e, patch) => saveAppSettings(patch || {}));
ipcMain.handle('vox:settings:setApiKey', (_e, provider, key) => saveApiKey(provider, key));
ipcMain.handle('vox:settings:getApiKey', (_e, provider) => readApiKey(provider));
ipcMain.handle('vox:settings:clearApiKey', (_e, provider) => clearApiKey(provider));

ipcMain.handle('vox:ai:test', async (_e, override) => {
  const cfg = currentAI(override && override.provider);
  if (!cfg.key && !isLocalEndpoint(cfg.baseURL)) return { ok: false, message: '未配置 API Key' };
  if (!cfg.baseURL) return { ok: false, message: '未配置接口地址' };
  const r = await aiRequest(cfg.baseURL, cfg.key, {
    model: cfg.model,
    messages: [{ role: 'user', content: '回复两个字：正常' }],
    max_tokens: 16, stream: false
  }, Math.min(30000, cfg.timeoutSec * 1000));
  return r.ok
    ? { ok: true, message: '连接正常', reply: String(r.content || '').trim() }
    : { ok: false, message: r.message };
});

ipcMain.handle('vox:ai:process', async (_e, { task, text, options }) => {
  if (!text || !String(text).trim()) return { ok: false, message: '没有可处理的文本' };
  return aiRun(task, String(text), options || {});
});

/** 拉取服务商真实可用的模型列表 —— 免得内置清单过期 */
ipcMain.handle('vox:ai:models', async (_e, override) => {
  const cfg = currentAI(override && override.provider);
  const base = (override && override.baseURL) || cfg.baseURL;
  const key = (override && override.key) || cfg.key;
  if (!base) return { ok: false, message: '未配置接口地址' };
  if (!key && !isLocalEndpoint(base)) return { ok: false, message: '未配置 API Key' };

  return new Promise((resolve) => {
    let url;
    try { url = new URL(String(base).replace(/\/+$/, '') + '/models'); }
    catch (e) { return resolve({ ok: false, message: '接口地址格式不对' }); }
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? require('https') : require('http');
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key },
      timeout: 20000
    }, (res) => {
      let data = '';
      // 必须 setEncoding：直接 data += c 是每块单独 toString('utf8')，
      // 一个汉字跨块就会被劈成两个 U+FFFD（表现为随机乱码）
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, message: 'HTTP ' + res.statusCode + '：' + data.slice(0, 120) });
        }
        try {
          const j = JSON.parse(data);
          const list = (j.data || j.models || [])
            .map(m => String(m.id || m.name || m.model || ''))
            .filter(Boolean)
            .filter(isUsableModel)      // 只留文本/语音/视觉，滤掉 3D 图像视频向量等
            .sort();
          if (!list.length) return resolve({ ok: false, message: '服务商没有返回模型列表' });
          resolve({ ok: true, models: list });
        } catch (e) { resolve({ ok: false, message: '返回不是合法 JSON' }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: '请求超时' }); });
    req.end();
  });
});

ipcMain.handle('vox:projects:list', () => needStore().listProjects());
ipcMain.handle('vox:project:create', (_e, args) => needStore().createProject(args || {}));
ipcMain.handle('vox:project:read', (_e, id) => needStore().readProject(id));
ipcMain.handle('vox:project:save', (_e, { id, patch }) => needStore().saveProject(id, patch || {}));
ipcMain.handle('vox:project:status', (_e, { id, status }) => needStore().setProjectStatus(id, status));
ipcMain.handle('vox:project:delete', (_e, { id, toRecycle }) => needStore().deleteProject(id, { toRecycle }));
ipcMain.handle('vox:project:reveal', (_e, id) => { shell.openPath(needStore().projectDir(id)); return { ok: true }; });

ipcMain.handle('vox:episodes:list', (_e, { projectId }) => {
  const st = needStore();
  const p = st.readProject(projectId);
  if (!p.ok) return [];
  return st.listEpisodes(projectId, p.project.padWidth);
});
ipcMain.handle('vox:episode:create', (_e, args) => needStore().createEpisode(args.projectId, args));
ipcMain.handle('vox:episode:read', (_e, { projectId, no }) => needStore().readEpisode(projectId, no));
ipcMain.handle('vox:episode:write', (_e, { projectId, no, payload }) => needStore().writeEpisode(projectId, no, payload || {}));
ipcMain.handle('vox:episode:delete', (_e, { projectId, no, toRecycle }) => needStore().deleteEpisode(projectId, no, { toRecycle }));
ipcMain.handle('vox:episode:saveAudio', (_e, args) => needStore().saveAudio(args.projectId, args.no, args.filename, args.base64));
ipcMain.handle('vox:episode:readAudio', (_e, args) => needStore().readAudio(args.projectId, args.no, args.filename));
ipcMain.handle('vox:episode:listAudio', (_e, args) => needStore().listAudio(args.projectId, args.no));
ipcMain.handle('vox:episode:listOutput', (_e, args) => needStore().listOutput(args.projectId, args.no));
ipcMain.handle('vox:episode:logExport', (_e, args) => needStore().appendExportLog(args.projectId, args.no, args.entry || {}));
ipcMain.handle('vox:episode:reveal', (_e, args) => { shell.openPath(needStore().episodePath(args.projectId, args.no)); return { ok: true }; });
ipcMain.handle('vox:trash:list', () => (store ? store.listTrash() : []));
ipcMain.handle('vox:trash:restore', (_e, p) => (store ? store.restoreTrash(p) : { ok: false }));
ipcMain.handle('vox:trash:purge', (_e, p) => (store ? store.purgeTrash(p) : { ok: false }));
ipcMain.handle('vox:trash:empty', (_e, projectId) => (store ? store.emptyTrash(projectId) : { ok: false }));
ipcMain.handle('vox:path:reveal', (_e, p) => safeOpenPath(p));
ipcMain.handle('vox:path:pick', async (_e, { title, defaultPath }) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: title || '选择目录', defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled ? { ok: false } : { ok: true, path: r.filePaths[0] };
});

/* ══════════════════════════════════════════════════════════
   生命周期（单实例：避免双击两次起两个后端抢端口）
   ══════════════════════════════════════════════════════════ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    CONFIG = loadConfig();
    appSettings = loadAppSettings();
  migrateLegacyKey();
    store = new ProjectStore(appSettings.output.root);
  // 启动时清理回收站里超过保留天数的条目（默认 30 天）
  try {
    const keep = (appSettings.project && appSettings.project.trashKeepDays) || 30;
    const r = store.autoPurgeTrash(keep);
    if (r.removed) console.log('[shell] 回收站自动清理 ' + r.removed + ' 项（超过 ' + keep + ' 天）');
  } catch (e) { /* 不影响启动 */ }
    console.log('[shell] 配置:', JSON.stringify({
      serverDir: CONFIG.serverDir,
      pythonPath: CONFIG.pythonPath,
      serverPort: CONFIG.serverPort,
      outputRoot: appSettings.output.root
    }));

    createWindow();
    setStatus({ status: 'starting', message: '正在启动 VoxCPM2 引擎...' });

    const res = await ensureServer();
    if (res.ok) setStatus({ status: 'ready' });
    else setStatus({ status: 'error', message: res.message });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 渲染进程崩溃时记录并尝试重载，而不是让整个应用退出
  app.on('render-process-gone', (_e, contents, details) => {
    console.error('[guard] 渲染进程异常退出:', details);
    try { pushLog('[guard] 界面进程异常：' + (details && details.reason)); } catch (e) { /* 忽略 */ }
    if (mainWindow && !mainWindow.isDestroyed() && details && details.reason !== 'clean-exit') {
      try { mainWindow.reload(); } catch (e) { /* 放弃 */ }
    }
  });

  app.on('window-all-closed', () => {
    killServerTree();
    app.quit();
  });

  app.on('before-quit', () => killServerTree());
}
