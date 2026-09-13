const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { ProjectStore } = require('./project-store');

/* ══════════════════════════════════════════════════════════
   配置：环境变量 > vox.config.json > 内置默认值
   ══════════════════════════════════════════════════════════ */
const DEFAULTS = {
  serverDir: 'D:\\Voxcpm2',
  serverScript: 'server.py',
  pythonPath: 'python',
  serverPort: 8000,
  autoStartServer: true,
  serverStartTimeoutMs: 180000
};

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
  ai: {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    visionModel: '',
    timeoutSec: 60,
    retries: 2,
    maxCharsPerCall: 4000
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
  project: { autoSaveSec: 30, dailyBackup: true },
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
  if (!cfg.key) return { ok: false, message: '未配置 API Key（设置 → AI 服务）' };
  if (!cfg.baseURL) return { ok: false, message: '未配置接口地址（设置 → AI 服务）' };
  const spec = AI_TASKS[task];
  if (!spec) return { ok: false, message: '未知任务：' + task };

  let system = spec.system;
  if (task === 'split' || task === 'script') system += '\n每句台词不超过 ' + (options.maxLen || 25) + ' 字。';
  if (options.projectPrompt) system += '\n项目背景：' + options.projectPrompt;
  if (options.dict && options.dict.length) {
    system += '\n必须遵守的读音约定：' + options.dict.map(d => d.word + ' 读作 ' + d.reading).join('；') + '。';
  }

  const parts = aiChunks(text, cfg.maxChars);
  const outs = [];
  let usage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let i = 0; i < parts.length; i++) {
    let r = null;
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      r = await aiRequest(cfg.baseURL, cfg.key, {
        model: cfg.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: parts[i] }],
        temperature: task === 'roles' ? 0 : 0.2,
        stream: false
      }, Math.min(300000, cfg.timeoutSec * 1000));
      if (r.ok) break;
      if (attempt < cfg.retries) await new Promise(res => setTimeout(res, 800));
    }
    if (!r || !r.ok) return { ok: false, message: (r && r.message) || '调用失败', done: i, total: parts.length };
    outs.push(String(r.content || '').trim());
    if (r.usage) {
      usage.prompt_tokens += r.usage.prompt_tokens || 0;
      usage.completion_tokens += r.usage.completion_tokens || 0;
    }
    if (send && mainWindow) send('vox:ai-progress', { task, done: i + 1, total: parts.length });
  }

  let content = outs.join('\n');
  if (task === 'roles') {
    // 容错：剥掉可能的 markdown 代码块
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const arr = JSON.parse(content);
      if (!Array.isArray(arr)) throw new Error('不是数组');
      return { ok: true, roles: arr, usage, chunks: parts.length };
    } catch (e) {
      return { ok: false, message: '模型返回的角色 JSON 解析失败：' + content.slice(0, 120) };
    }
  }
  return { ok: true, text: content, usage, chunks: parts.length };
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
  return new Promise((resolve) => {
    const { serverScriptPath, serverDir, pythonPath, serverPort, serverStartTimeoutMs } = CONFIG;

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
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ ok: false, message: '无法启动 Python：' + e.message });
      return;
    }
    serverProcess = child;

    // server.py 的 print/异常全部转发到加载页，不再"静默 180 秒然后超时"
    child.stdout?.on('data', (b) => pushLog(b.toString()));
    child.stderr?.on('data', (b) => pushLog(b.toString()));

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
        pushLog('[shell] 后端已就绪');
        finish({ ok: true });
        return;
      }
      if (Date.now() - startedAt > serverStartTimeoutMs) {
        finish({ ok: false, message: `等待后端超时（${Math.round(serverStartTimeoutMs / 1000)} 秒）` });
      }
    }, 1000);
  });
}

async function ensureServer() {
  if (serverState === 'ready') return { ok: true };

  // 端口上已经有服务在跑（例如用户自己启动过 app.py）→ 直接复用，
  // 避免再拉一个绑不上端口、却让健康检查通过第二个进程的假象
  if (await probe(CONFIG.serverPort)) {
    pushLog(`[shell] 端口 ${CONFIG.serverPort} 已有后端在运行，直接复用`);
    serverState = 'ready';
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
   项目 / 集 / 设置 IPC
   ══════════════════════════════════════════════════════════ */
const needStore = () => {
  if (!store) {
    appSettings = appSettings || loadAppSettings();
    store = new ProjectStore(appSettings.output.root);
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
  if (!cfg.key) return { ok: false, message: '未配置 API Key' };
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
  if (!key) return { ok: false, message: '未配置 API Key' };

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
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, message: 'HTTP ' + res.statusCode + '：' + data.slice(0, 120) });
        }
        try {
          const j = JSON.parse(data);
          const list = (j.data || j.models || [])
            .map(m => String(m.id || m.name || m.model || '')).filter(Boolean).sort();
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
ipcMain.handle('vox:path:reveal', (_e, p) => { shell.openPath(String(p || '')); return { ok: true }; });
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

  app.on('window-all-closed', () => {
    killServerTree();
    app.quit();
  });

  app.on('before-quit', () => killServerTree());
}
