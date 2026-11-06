const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, '.build-apk');
const ASSETS = path.join(BUILD, 'assets');
const RES = path.join(BUILD, 'res');
const GEN = path.join(BUILD, 'gen');
const CLASSES = path.join(BUILD, 'classes');
const DEX = path.join(BUILD, 'dex');
const KEYSTORE = path.join(ROOT, 'android', 'keystore', 'calendar-puzzle.jks');
const OUT_APK = path.join(ROOT, 'download', 'calendar-puzzle.apk');
const KEY_PASS = 'calendar-puzzle';

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd: cwd || ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error(`${cmd} 执行失败 退出码 ${res.status}`);
}

function newestDir(base, filter) {
  if (!fs.existsSync(base)) return null;
  const items = fs.readdirSync(base).filter((name) => filter(name) && fs.statSync(path.join(base, name)).isDirectory());
  items.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return items.length ? path.join(base, items[items.length - 1]) : null;
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    'D:\\Android',
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'platforms')) && fs.existsSync(path.join(dir, 'build-tools'))) return dir;
  }
  throw new Error('找不到 Android SDK 请先设置 ANDROID_HOME');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function collect(dir, ext, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, ext, out);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const sdk = findSdk();
const buildTools = newestDir(path.join(sdk, 'build-tools'), () => true);
const platform = newestDir(path.join(sdk, 'platforms'), () => true);
if (!buildTools || !platform) throw new Error('SDK 缺少 build-tools 或 platforms');

const aapt2 = path.join(buildTools, 'aapt2.exe');
const zipalign = path.join(buildTools, 'zipalign.exe');
const apksigner = path.join(buildTools, 'apksigner.bat');
const androidJar = path.join(platform, 'android.jar');

for (const file of [aapt2, zipalign, apksigner, androidJar]) {
  if (!fs.existsSync(file)) throw new Error(`缺少构建工具 ${file}`);
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(GEN, { recursive: true });
fs.mkdirSync(CLASSES, { recursive: true });
fs.mkdirSync(DEX, { recursive: true });
fs.mkdirSync(path.dirname(OUT_APK), { recursive: true });

// 站点资源直接作为 APK assets 保证离线可用
const PACK = path.join(BUILD, 'assets-pack');
const PACK_ASSETS = path.join(PACK, 'assets');
fs.mkdirSync(PACK_ASSETS, { recursive: true });
for (const item of ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'src', 'icons']) {
  const from = path.join(ROOT, item);
  const to = path.join(PACK_ASSETS, item);
  if (fs.statSync(from).isDirectory()) copyDir(from, to);
  else fs.copyFileSync(from, to);
}

copyDir(path.join(ROOT, 'android', 'res'), RES);
fs.mkdirSync(path.join(RES, 'mipmap-xxxhdpi'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'icons', 'icon-192.png'), path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher.png'));

const resZip = path.join(BUILD, 'res.zip');
run(aapt2, ['compile', '--dir', RES, '-o', resZip]);

const unsigned = path.join(BUILD, 'app-unsigned.apk');
run(aapt2, [
  'link', '-o', unsigned,
  '-I', androidJar,
  '--manifest', path.join(ROOT, 'android', 'AndroidManifest.xml'),
  '--java', GEN,
  '--min-sdk-version', '23',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', '1.0',
  resZip,
]);

const javaFiles = collect(path.join(ROOT, 'android', 'java'), '.java', []);
const rJava = collect(GEN, '.java', []);
run('javac', ['-source', '8', '-target', '8', '-Xlint:-options', '-bootclasspath', androidJar, '-d', CLASSES].concat(javaFiles, rJava));

const classFiles = collect(CLASSES, '.class', []);
run(path.join(buildTools, 'd8.bat'), ['--release', '--min-api', '23', '--lib', androidJar, '--output', DEX].concat(classFiles));

run('jar', ['uf', unsigned, '-C', PACK, 'assets', '-C', DEX, 'classes.dex']);

const aligned = path.join(BUILD, 'app-aligned.apk');
run(zipalign, ['-f', '-p', '4', unsigned, aligned]);

if (!fs.existsSync(KEYSTORE)) {
  fs.mkdirSync(path.dirname(KEYSTORE), { recursive: true });
  run('keytool', [
    '-genkeypair', '-keystore', KEYSTORE, '-alias', 'calendar',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '36500',
    '-storepass', KEY_PASS, '-keypass', KEY_PASS,
    '-dname', 'CN=CalendarPuzzle,OU=Personal,O=Personal,L=Local,ST=Local,C=CN',
  ]);
}

run(apksigner, ['sign', '--ks', KEYSTORE, '--ks-pass', `pass:${KEY_PASS}`, '--key-pass', `pass:${KEY_PASS}`, '--out', OUT_APK, aligned]);
run(apksigner, ['verify', '--print-certs', OUT_APK]);

const size = fs.statSync(OUT_APK).size;
console.log(`APK 完成 ${OUT_APK} ${(size / 1024).toFixed(0)} KB`);
console.log(`SDK ${sdk}  build-tools ${path.basename(buildTools)}  platform ${path.basename(platform)}`);
