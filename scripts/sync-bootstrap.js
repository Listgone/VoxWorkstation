/* 构建前同步：engine/server.py → bootstrap/server.py
 *
 * 为什么需要这一步：
 * 一键配置会把 bootstrap/ 里的 server.py 释放到用户的后端目录。
 * 而开发时我改的是 engine/server.py —— 两者一旦不同步，
 * 用户拿到的就是旧版后端，表现为「我明明修了但没生效」。
 * 这个坑已经踩过一次（v1.0.17 的端口重试没进安装包）。
 */
const fs = require('fs');
const path = require('path');

const pairs = [
  ['engine/server.py', 'bootstrap/server.py'],
  ['engine/requirements.txt', 'bootstrap/requirements.txt'],
];

let changed = 0;
for (const [src, dst] of pairs) {
  if (!fs.existsSync(src)) {
    console.error('[sync] 源文件不存在: ' + src);
    process.exit(1);
  }
  const a = fs.readFileSync(src);
  const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
  if (b && a.equals(b)) {
    console.log('[sync] 已一致: ' + dst);
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, a);
  console.log('[sync] 已更新: ' + dst + '  (' + (b ? (b.length / 1024).toFixed(1) + ' → ' : '') + (a.length / 1024).toFixed(1) + ' KB)');
  changed++;
}

// 复查：同步后必须完全一致，否则构建应失败
let bad = 0;
for (const [src, dst] of pairs) {
  if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) {
    console.error('[sync] ✗ 同步失败: ' + dst);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('[sync] 完成，' + changed + ' 个文件更新');
