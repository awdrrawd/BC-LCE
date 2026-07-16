// 把 package.json 的 version 同步到兩個 loader userscript 的 @version 欄位，
// 讓使用者的 Tampermonkey 能偵測到更新。build / dev 前會自動執行。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf-8'));
const version = pkg.version;

const loaders = ['loader.user.js', 'loader.local.user.js'];
for (const file of loaders) {
  const path = root + file;
  let text;
  try { text = readFileSync(path, 'utf-8'); }
  catch { continue; }
  const updated = text.replace(/(\/\/\s*@version\s+)\S+/, `$1${version}`);
  if (updated !== text) {
    writeFileSync(path, updated);
    console.log(`[sync-version] ${file} -> ${version}`);
  }
}
