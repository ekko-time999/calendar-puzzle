'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let html = read('index.html');
const css = read('styles.css');

html = html.replace(/\n?\s*<link rel="manifest"[^>]*>/g, '');
html = html.replace(/\n?\s*<link rel="apple-touch-icon"[^>]*>/g, '');
html = html.replace(/\n?\s*<link rel="icon"[^>]*>/g, '');
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>');

const scripts = ['pieces', 'solver', 'storage', 'game', 'app'];
for (const name of scripts) {
  const tag = '<script src="src/' + name + '.js"></script>';
  const code = read('src/' + name + '.js');
  html = html.replace(tag, '<script>\n' + code + '\n</script>');
}

html = html.replace(
  /\s*<a id="offlineLink"[^>]*>[^<]*<\/a>/,
  '\n        <p class="help-note">当前打开的就是单文件离线版 可以直接复制保存或发送到手机</p>'
);

// 单文件版不注册 Service Worker
html = html.replace(
  /if \('serviceWorker' in navigator[\s\S]*?\}\s*\n/,
  ''
);

html = html.replace('<title>', '<!-- 单文件离线版 双击即可游玩 不依赖网络 -->\n  <title>');

fs.writeFileSync(path.join(root, 'calendar-puzzle-standalone.html'), html, 'utf8');
console.log('calendar-puzzle-standalone.html  ' + Math.round(Buffer.byteLength(html) / 1024) + ' KB');
