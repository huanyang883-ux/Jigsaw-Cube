import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { androidVersion } from './android-version.mjs';

const root = path.resolve(import.meta.dirname, '..');
const local = path.join(root, '.local');
const configPath = path.join(local, 'android-build.json');
const exists = async (file) => !!await fs.stat(file).catch(() => null);
const readJSON = async (file, fallback) => {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

function run(file, args, { cwd = root, env = process.env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    // Only trusted Gradle wrappers go through cmd.exe. Version input is parsed
    // as numeric components before it can become a Gradle argument.
    const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
    const command = batch ? process.env.ComSpec || 'cmd.exe' : file;
    const arguments_ = batch ? ['/d', '/s', '/c', `""${file}" ${args.map(a => `"${a}"`).join(' ')}"`] : args;
    const child = spawn(command, arguments_, {
      cwd, env, windowsHide: true, windowsVerbatimArguments: batch,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    if (capture) {
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
    }
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(file)} 执行失败（${code}）${output ? `\n${output}` : ''}`)));
  });
}

async function findToolchain(config) {
  const sdkCandidates = [
    config.sdkPath, process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'AppData/Local/Android/Sdk'),
    'D:/Unity/2022.3.62f3/Editor/Data/PlaybackEngines/AndroidPlayer/SDK',
  ].filter(Boolean);
  let sdkPath;
  for (const candidate of sdkCandidates) {
    if (await exists(path.join(candidate, 'platforms/android-36/android.jar'))) { sdkPath = path.resolve(candidate); break; }
  }
  if (!sdkPath) throw new Error(`没有找到 Android API 36 SDK。安装后在 ${configPath} 中设置 sdkPath。`);
  const managedJdks = await fs.readdir(path.join(local, 'android-toolchain'), { withFileTypes: true }).catch(() => []);
  const javaCandidates = [
    config.javaHome, process.env.JAVA_HOME,
    ...managedJdks.filter(e => e.isDirectory() && e.name.startsWith('jdk-')).map(e => path.join(local, 'android-toolchain', e.name)).sort().reverse(),
    'C:/Program Files/Android/Android Studio/jbr',
  ].filter(Boolean);
  let javaHome;
  for (const candidate of javaCandidates) {
    const release = await fs.readFile(path.join(candidate, 'release'), 'utf8').catch(() => '');
    const major = Number(release.match(/JAVA_VERSION="(\d+)/)?.[1]);
    if (major === 21 && await exists(path.join(candidate, 'bin/javac.exe'))) { javaHome = path.resolve(candidate); break; }
  }
  if (!javaHome) throw new Error(`没有找到 JDK 21。请在 ${configPath} 中设置 javaHome；Unity 2022 自带的 JDK 11 无法编译这个工程。`);
  if (!await exists(path.join(sdkPath, 'build-tools/36.0.0/apksigner.bat'))) {
    throw new Error('SDK 缺少 Android SDK Build-Tools 36.0.0，请通过 SDK Manager 安装后重试。');
  }
  // Remove differently cased inherited Windows variables (e.g. Java_Home).
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'PATH'].includes(key.toUpperCase())));
  Object.assign(env, {
    JAVA_HOME: javaHome, ANDROID_HOME: sdkPath, ANDROID_SDK_ROOT: sdkPath,
    Path: `${path.join(javaHome, 'bin')};${process.env.Path || process.env.PATH || ''}`,
  });
  await fs.mkdir(local, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ ...config, sdkPath, javaHome }, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'android/local.properties'), `sdk.dir=${sdkPath.replaceAll('\\', '/').replaceAll(':', '\\:')}\n`);
  return { sdkPath, javaHome, env };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('此一键脚本面向 Windows；其他平台可以直接使用 Capacitor / Gradle。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本。');
  process.chdir(root);
  const { versionName: defaultVersion } = await readJSON(path.join(root, 'android/version.json'));
  let input = process.argv[2];
  if (input === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { input = (await rl.question(`\nJigsawCube Android APK\n请输入版本号 [默认 ${defaultVersion}]: `)).trim() || defaultVersion; }
    finally { rl.close(); }
  }
  const { versionName, versionCode } = androidVersion(input);
  const { sdkPath, javaHome, env } = await findToolchain(await readJSON(configPath, {}));
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!await exists(npmCli)) throw new Error('当前 Node.js 安装缺少 npm，请安装完整的 Node.js 22+。');
  if (!await exists(path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'))) {
    console.log('\n安装工程依赖…'); await run(process.execPath, [npmCli, 'ci'], { env });
  }
  console.log(`\n应用: JigsawCube / com.huanyang.jigsawcube\n版本: ${versionName} (${versionCode})\nAPI: compile 36 / target 36 / min 24\nSDK: ${sdkPath}\nJava: ${javaHome}`);
  console.log('\n[1/5] 构建测试版游戏资源');
  await run(process.execPath, [npmCli, 'run', 'android:web', '--', '--mode', 'test'], { env });
  console.log('\n[2/5] 同步 Android 工程');
  // Keep the double-click flow to a single version prompt; Capacitor's
  // non-interactive mode also skips its automatic CLI telemetry opt-in.
  await run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android'], { env: { ...env, CI: '1' } });
  console.log('\n[3/5] 编译并使用调试密钥签名');
  await run(path.join(root, 'android/gradlew.bat'), [
    '--no-daemon', '--console=plain', ':app:assembleDebug',
    `-PjigsawVersionName=${versionName}`, `-PjigsawVersionCode=${versionCode}`,
  ], { cwd: path.join(root, 'android'), env });
  const apk = path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk');
  console.log('\n[4/5] 校验 APK 的签名、包名和版本');
  const signer = path.join(sdkPath, 'build-tools/36.0.0/apksigner.bat');
  const signature = await run(signer, ['verify', '--verbose', '--print-certs', apk], { env, capture: true });
  const badging = await run(path.join(sdkPath, 'build-tools/36.0.0/aapt.exe'), ['dump', 'badging', apk], { env, capture: true });
  const packageLine = badging.split(/\r?\n/).find(line => line.startsWith('package:')) || '';
  for (const expected of ["name='com.huanyang.jigsawcube'", `versionCode='${versionCode}'`, `versionName='${versionName}'`]) {
    if (!packageLine.includes(expected)) throw new Error(`APK 包信息不匹配: ${expected}`);
  }
  if (!badging.includes("targetSdkVersion:'36'") || !badging.includes("sdkVersion:'24'") || !badging.includes("application-label:'JigsawCube'")) {
    throw new Error('APK API 版本或应用名称不匹配。');
  }
  console.log('\n[5/5] 导出安装包');
  const out = path.join(root, 'builds/android');
  await fs.mkdir(out, { recursive: true });
  const output = path.join(out, `JigsawCube-${versionName}-debug.apk`);
  await fs.copyFile(apk, output);
  const bytes = await fs.readFile(output);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
  await fs.writeFile(`${output}.json`, JSON.stringify({
    appId: 'com.huanyang.jigsawcube', appName: 'JigsawCube', versionName, versionCode,
    compileSdk: 36, targetSdk: 36, minSdk: 24, variant: 'debug',
    sizeBytes: bytes.length, sha256, builtAt: new Date().toISOString(),
    signer: signature.split(/\r?\n/).find(line => line.includes('certificate SHA-256 digest:')),
  }, null, 2) + '\n');
  console.log(`\n构建成功！\n${output}\n大小: ${(bytes.length / 1024 / 1024).toFixed(1)} MiB\n可直接将 APK 复制到安卓手机安装。`);
}

main().catch(error => { console.error(`\n打包失败：${error.message}`); process.exitCode = 1; });
