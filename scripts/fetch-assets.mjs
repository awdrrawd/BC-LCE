// 從 `assets` 分支抓取圖片/影片到本地 assets/（main 分支本身不追蹤這個資料夾）。
// 於 npm 的 predev / prebuild 自動執行，見 package.json。
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const DIR = 'assets';
const BRANCH = 'assets';

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

if (existsSync(DIR)) {
  console.log(`[fetch-assets] ${DIR}/ 已存在，略過抓取（若要更新請先刪除該資料夾再重跑）`);
  process.exit(0);
}

try {
  console.log(`[fetch-assets] 從 origin/${BRANCH} 抓取素材…`);
  run(`git fetch --depth=1 origin ${BRANCH}`);
  run(`git checkout FETCH_HEAD -- ${DIR}`);
  run(`git reset -- ${DIR}`); // 只取檔案到工作目錄，不讓 main 的 index 追蹤它
  console.log(`[fetch-assets] 完成，${DIR}/ 已就緒。`);
} catch (err) {
  console.error('[fetch-assets] 抓取失敗：', err.message);
  console.error(`請確認遠端 repo 有 "${BRANCH}" 分支，且本地已設定好 origin remote 的存取權限。`);
  process.exit(1);
}