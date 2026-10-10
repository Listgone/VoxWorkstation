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

/** 生成 VoxVoices-YYYYMMDD-HHmm 形式的备份目录名 */
function stampName(now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'VoxVoices-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

/**
 * 备份：在 baseDir 下新建带时间戳的目录，复制声纹与预设，并写 manifest.json
 * @returns {{ok:boolean, dest?:string, copied?:number, voiceCount?:number, message?:string}}
 */
function backupVoices(paths, baseDir, meta) {
  if (!baseDir) return { ok: false, message: '没有指定备份目录' };
  if (!fs.existsSync(paths.profiles) && !fs.existsSync(paths.presets)) {
    return { ok: false, message: '音色库里还没有内容，无需备份' };
  }
  // 同一分钟内备份两次会重名 —— 递增加序号，绝不覆盖已有备份
  let dest = path.join(baseDir, stampName());
  if (fs.existsSync(dest)) {
    for (let i = 2; i < 100; i++) {
      const alt = path.join(baseDir, stampName() + '-' + i);
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
    backedUpAt: new Date().toISOString(),
    voices: names,
    fileCount: copied,
    source: paths.profiles
  }, null, 2), 'utf8');
  return { ok: true, dest, copied, voiceCount: names.length };
}

/** 在目录（或其上级）里找到要还原的备份目录：优先 VoxVoices-* 中最新的一份 */
function resolveBackupSource(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  if (fs.existsSync(path.join(dir, 'voice_profiles')) || fs.existsSync(path.join(dir, 'custom_presets.json'))) return dir;
  let subs = [];
  try {
    subs = fs.readdirSync(dir)
      .filter((n) => n.startsWith('VoxVoices-'))
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

module.exports = { listFilesRecursive, copyTreeFlat, statVoices, stampName, backupVoices, resolveBackupSource, restoreVoices };
