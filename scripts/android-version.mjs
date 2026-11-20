// The last APK before the public version numbering restarted was 2.0.2.
const previousSeriesMaxCode = 2_000_002;

export function androidVersion(input) {
  const versionName = String(input).trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versionName)) {
    throw new Error('请输入三段数字版本号，例如 0.0.1（不要带 v、空格或前导零）。');
  }
  const [major, minor, patch] = versionName.split('.').map(Number);
  const versionCode = previousSeriesMaxCode + major * 1_000_000 + minor * 1_000 + patch;
  if (minor > 999 || patch > 999 || !Number.isSafeInteger(versionCode) || versionCode <= previousSeriesMaxCode || versionCode > 2_100_000_000) {
    throw new Error('次版本号和修订号必须为 0–999，版本号须从 0.0.1 起，生成的版本码不能超过 2100000000。');
  }
  return { versionName, versionCode };
}
