/* ══════════════════════════════════════════════════════════
   音色库备份 / 还原（纯逻辑，不依赖 Electron，便于单独测试）

   为什么单独一个文件：音色（voice_profiles 下的音频）与 custom_presets.json
   都在软件目录里，误删目录、换机器或重装就会丢。备份必须落到软件目录之外，
   这里负责「按时间戳生成备份目录并复制」「从备份补回缺失文件」。

   为什么不用 fs.cpSync：它可能跟随目录联接（engine 目录正是联接），
   逐个 copyFileSync 更可控。
   ══════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

/** 递归列出目录下的所有文件（返回相对路径） */
function listFilesRecursive(root, base) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) out.push(...listFilesRecursive(p, base));
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

/** 把 src 目录里的所有文件平铺复制到 dst（保持相对结构） */
function copyTreeFlat(src, dst) {
  let n = 0;
  for (const rel of listFilesRecursive(src, src)) {
    const target = path.join(dst, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(src, rel), target);
    n++;
  }
  return n;
}

/** 读 custom_presets.json，坏了就当空 */
function readPresets(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { return {}; }
}

/** 音色库概况：数量、文件数、体积、上次备份目录 */
function statVoices(paths, lastBackup) {
  const files = fs.existsSync(paths.profiles) ? listFilesRecursive(paths.profiles, paths.profiles) : [];
  const names = Object.keys(readPresets(paths.presets));
  let bytes = 0;
  for (const rel of files) {
    try { bytes += fs.statSync(path.join(paths.profiles, rel)).size; } catch (e) { /* 忽略 */ }
  }
  return {
    dir: paths.dir, profiles: paths.profiles, presets: paths.presets,
    voiceCount: names.length, names, fileCount: files.length, bytes,
    lastBackup: lastBackup || '', hasProfiles: fs.existsSync(paths.profiles)
  };
}

/** 生成备份目录名。auto=true 时为 VoxAuto-…（自动备份，便于单独清理） */
function stampName(now, auto) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  const base = (auto ? 'VoxAuto-' : 'VoxVoices-') + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  return base;
}

/** 备份目录名前缀（手动 / 自动），还原时按前缀查找 */
const PREFIX_MANUAL = 'VoxVoices-';
const PREFIX_AUTO = 'VoxAuto-';

/** 音色库当前内容的指纹：每个声纹的「文件名 + 字节数 + 修改时间」+ 描述文件的字节数。
 *  用来判断"和上一份备份是不是一模一样"，避免手动点一下又存一份完全重复的。 */
function voicesSignature(paths) {
  const parts = [];
  const files = fs.existsSync(paths.profiles) ? listFilesRecursive(paths.profiles, paths.profiles).sort() : [];
  for (const rel of files) {
    try {
      const st = fs.statSync(path.join(paths.profiles, rel));
      parts.push(rel + ':' + st.size + ':' + Math.floor(st.mtimeMs / 1000));
    } catch (e) { parts.push(rel + ':?'); }
  }
  let presets = '';
  try {
    const st = fs.statSync(paths.presets);
    presets = fs.readFileSync(paths.presets, 'utf8');
  } catch (e) { presets = ''; }
  return parts.join('|') + '##' + presets;
}

/** 读某份备份里的指纹（备份时不写指纹，这里按同样的规则重算） */
function readBackupSignature(dir) {
  const parts = [];
  const prof = path.join(dir, 'voice_profiles');
  const files = fs.existsSync(prof) ? listFilesRecursive(prof, prof).sort() : [];
  for (const rel of files) {
    try {
      const st = fs.statSync(path.join(prof, rel));
      // 备份是复制出来的，mtime 与源文件一致（copyFileSync 不保留 mtime，
      // 所以这里不比较时间，只比较名字与大小；描述文件按内容比较）
      parts.push(rel + ':' + st.size);
    } catch (e) { parts.push(rel + ':?'); }
  }
  let presets = '';
  try { presets = fs.readFileSync(path.join(dir, 'custom_presets.json'), 'utf8'); } catch (e) { presets = ''; }
  return parts.join('|') + '##' + presets;
}

/**
 * 备份：在 baseDir 下新建带时间戳的目录，复制声纹与预设，并写 manifest.json
 * @param {object} paths  音色库路径（profiles / presets）
 * @param {string} baseDir 备份根目录
 * @param {object} meta   { version, auto, dedupe } auto=true 时命名 VoxAuto-…；
 *                        dedupe 默认 true：与最新一份备份内容相同则不再新建
 * @returns {{ok:boolean, dest?:string, copied?:number, voiceCount?:number, skipped?:boolean, message?:string}}
 */
function backupVoices(paths, baseDir, meta) {
  if (!baseDir) return { ok: false, message: '没有指定备份目录' };
  if (!fs.existsSync(paths.profiles) && !fs.existsSync(paths.presets)) {
    return { ok: false, message: '音色库里还没有内容，无需备份' };
  }
  const auto = !!(meta && meta.auto);
  const dedupe = !(meta && meta.dedupe === false);

  /* 去重：与最新一份备份内容一致就不再新建 ——
     自动备份刚做完、用户又点一下手动备份，不该多出一份完全重复的。 */
  if (dedupe) {
    const newest = listBackups(baseDir)[0];
    if (newest) {
      const cur = voicesSignature(paths).split('##')[0];
      const old = readBackupSignature(newest.dir).split('##')[0];
      let curPresets = '', oldPresets = '';
      try { curPresets = fs.readFileSync(paths.presets, 'utf8'); } catch (e) { /* 无 */ }
      try { oldPresets = fs.readFileSync(path.join(newest.dir, 'custom_presets.json'), 'utf8'); } catch (e) { /* 无 */ }
      if (cur === old && curPresets === oldPresets) {
        return { ok: true, skipped: true, reason: 'unchanged', dest: newest.dir,
                 voiceCount: newest.voices, copied: newest.files, auto };
      }
    }
  }

  // 同一分钟内备份两次会重名 —— 递增加序号，绝不覆盖已有备份
  let dest = path.join(baseDir, stampName(null, auto));
  if (fs.existsSync(dest)) {
    for (let i = 2; i < 100; i++) {
      const alt = path.join(baseDir, stampName(null, auto) + '-' + i);
      if (!fs.existsSync(alt)) { dest = alt; break; }
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  const copied = fs.existsSync(paths.profiles) ? copyTreeFlat(paths.profiles, path.join(dest, 'voice_profiles')) : 0;
  if (fs.existsSync(paths.presets)) fs.copyFileSync(paths.presets, path.join(dest, 'custom_presets.json'));
  const names = Object.keys(readPresets(paths.presets));
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({
    app: 'VoxWorkstation',
    version: (meta && meta.version) || '',
    kind: auto ? 'auto' : 'manual',
    backedUpAt: new Date().toISOString(),
    voices: names,
    fileCount: copied,
    source: paths.profiles
  }, null, 2), 'utf8');
  return { ok: true, dest, copied, voiceCount: names.length, auto };
}

/** 在目录（或其上级）里找到要还原的备份目录：手动与自动备份中取最新的一份 */
function resolveBackupSource(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, 'voice_profiles')) || fs.existsSync(path.join(dir, 'custom_presets.json'))) return dir;
  let subs = [];
  try {
    subs = fs.readdirSync(dir)
      .filter((n) => n.startsWith(PREFIX_MANUAL) || n.startsWith(PREFIX_AUTO))
      .map((n) => path.join(dir, n))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } })
      .sort();
  } catch (e) { return null; }
  return subs.length ? subs[subs.length - 1] : null;
}

/**
 * 还原：把备份里的文件补回音色库，默认不覆盖已有同名文件
 * @returns {{ok:boolean, from?:string, added?:number, skipped?:number, message?:string}}
 */
function restoreVoices(paths, fromDir, opts) {
  const src = resolveBackupSource(fromDir);
  if (!src) return { ok: false, message: '这个目录里没找到 VoxVoices- 开头的备份' };
  const overwrite = !!(opts && opts.overwrite);
  fs.mkdirSync(paths.profiles, { recursive: true });
  let added = 0, skipped = 0;
  const srcProfiles = path.join(src, 'voice_profiles');
  if (fs.existsSync(srcProfiles)) {
    for (const rel of listFilesRecursive(srcProfiles, srcProfiles)) {
      const dst = path.join(paths.profiles, rel);
      if (fs.existsSync(dst) && !overwrite) { skipped++; continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(srcProfiles, rel), dst);
      added++;
    }
  }
  const srcPresets = path.join(src, 'custom_presets.json');
  if (fs.existsSync(srcPresets)) {
    const merged = Object.assign({}, readPresets(paths.presets), readPresets(srcPresets));
    fs.writeFileSync(paths.presets, JSON.stringify(merged, null, 2), 'utf8');
  }
  return { ok: true, from: src, added, skipped };
}

/**
 * 列出备份目录下的所有备份（手动 + 自动），按修改时间从新到旧
 * @returns {Array<{name:string, dir:string, kind:'manual'|'auto', at:number, voices:number, files:number, bytes:number}>}
 */
function listBackups(baseDir) {
  const out = [];
  if (!baseDir || !fs.existsSync(baseDir)) return out;
  let names = [];
  try { names = fs.readdirSync(baseDir); } catch (e) { return out; }
  for (const n of names) {
    if (!n.startsWith(PREFIX_MANUAL) && !n.startsWith(PREFIX_AUTO)) continue;
    const dir = path.join(baseDir, n);
    let st = null;
    try { st = fs.statSync(dir); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    const prof = path.join(dir, 'voice_profiles');
    const files = fs.existsSync(prof) ? listFilesRecursive(prof, prof) : [];
    let bytes = 0;
    for (const rel of files) { try { bytes += fs.statSync(path.join(prof, rel)).size; } catch (e) { /* 忽略 */ } }
    const presets = readPresets(path.join(dir, 'custom_presets.json'));
    out.push({
      name: n, dir, kind: n.startsWith(PREFIX_AUTO) ? 'auto' : 'manual',
      at: st.mtimeMs, voices: Object.keys(presets).length, files: files.length, bytes
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** 删除若干部备份；只允许删 baseDir 下带备份前缀的目录 */
function deleteBackups(baseDir, names) {
  let removed = 0, skipped = 0;
  for (const n of (names || [])) {
    if (typeof n !== 'string' || (!n.startsWith(PREFIX_MANUAL) && !n.startsWith(PREFIX_AUTO)) || n.includes('..')) {
      skipped++;
      continue;
    }
    const dir = path.join(baseDir, n);
    // 双保险：解析后的路径必须仍在备份根目录内
    if (path.dirname(path.resolve(dir)) !== path.resolve(baseDir)) { skipped++; continue; }
    try { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
    catch (e) { skipped++; }
  }
  return { removed, skipped };
}

module.exports = {
  listFilesRecursive, copyTreeFlat, statVoices, stampName, backupVoices,
  resolveBackupSource, restoreVoices, listBackups, deleteBackups,
  PREFIX_MANUAL, PREFIX_AUTO
};
