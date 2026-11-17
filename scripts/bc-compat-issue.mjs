#!/usr/bin/env node
// 讀取 check-bc-compat.mjs 的 --json 結果，維護唯一一則 label=bc-compat 的追蹤 issue：
//   - 有差異且沒有 open issue：建立。
//   - 有差異且差異與上次不同：更新內文並留言（留言才會通知）；差異相同則不重複打擾。
//   - 沒有差異且有 open issue：留言後自動關閉。
// 只做通知，不會讓工作流程失敗。需要 gh CLI 與 GH_TOKEN（issues: write）、GH_REPO。
//
//   node scripts/bc-compat-issue.mjs <專案名稱> <report.json> [report.md]
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const [project, jsonPath, mdPath] = process.argv.slice(2);
if (!project || !jsonPath) {
  console.error('用法：node scripts/bc-compat-issue.mjs <專案名稱> <report.json> [report.md]');
  process.exit(2);
}

const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8'});
const report = JSON.parse(readFileSync(jsonPath, 'utf8'));

// 各欄位統一成排序過的字串清單，讓簽章不受順序影響。
const missing = [...(report.missing ?? [])].sort();
const changed = (report.changed ?? []).map(c => `${c.name}（${c.file}）${c.was} → ${c.now}`).sort();
const added = [...(report.added ?? [])].sort();
const stale = [...(report.stale ?? [])].sort();
const patchMisses = (report.patchMisses ?? []).map(p => `${p.name}（${p.file}）@ ${p.location}`).sort();
const problems = missing.length + changed.length + added.length + stale.length + patchMisses.length;

// 簽章只看差異內容，不含 BC 版本或執行編號，避免內容沒變卻重複通知。
const sig = createHash('sha1').update(JSON.stringify([missing, changed, added, stale, patchMisses])).digest('hex').slice(0, 12);

const list = items => items.map(item => `- \`${item}\``).join('\n');
const section = (title, items) => (items.length ? `\n### ${title}\n${list(items)}\n` : '');
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';
const detail = mdPath && existsSync(mdPath) ? readFileSync(mdPath, 'utf8').trim().slice(0, 40000) : '';

const body = `<!-- bc-compat-sig:${sig} -->
每週檢查發現 ${project} 掛鉤的 Bondage Club 函式與基準不同（BC 版本 **${report.gameVersion ?? 'unknown'}**，共 ${problems} 項）。
${section('patchFunction 的取代字串已不在 BC 函式本體（該 patch 會靜默失效）', patchMisses)}${section('找不到被掛鉤的函式（掛鉤會安裝失敗）', missing)}${section('BC 函式內容自基準後有變動（請檢視掛鉤行為）', changed)}${section('已掛鉤但基準尚未收錄', added)}${section(`基準有、${project} 已不再掛鉤`, stale)}
請對照 BC 原始碼確認掛鉤行為，必要時調整程式；確認後在本機執行下列指令更新基準並提交：

\`\`\`sh
node scripts/check-bc-compat.mjs --bc-dir <BC 原始碼資料夾> --update
\`\`\`
${detail ? `\n<details><summary>完整報告</summary>\n\n\`\`\`text\n${detail}\n\`\`\`\n\n</details>\n` : ''}
> 此議題由每週檢查自動維護：差異內容改變時更新內文並留言，差異全部消失後自動關閉。${runUrl ? `\n> 最近一次執行：${runUrl}` : ''}`;

try { gh('label', 'create', 'bc-compat', '--color', 'BFD4F2', '--description', `Bondage Club functions hooked by ${project} changed or disappeared`, '--force'); } catch {}
const open = JSON.parse(gh('issue', 'list', '--label', 'bc-compat', '--state', 'open', '--json', 'number,body', '--limit', '20'));
const existing = open[0];
const tmp = `${process.env.RUNNER_TEMP ?? '.'}/bc-compat-body.md`;

if (problems) {
  writeFileSync(tmp, body);
  if (!existing) {
    gh('issue', 'create', '--title', 'BC 函式掛鉤與基準不同', '--label', 'bc-compat', '--body-file', tmp);
    console.log(`已建立 issue（${problems} 項差異）`);
  } else if ((existing.body ?? '').includes(`bc-compat-sig:${sig}`)) {
    console.log('差異與上次相同，不重複通知。');
  } else {
    gh('issue', 'edit', String(existing.number), '--body-file', tmp);
    gh('issue', 'comment', String(existing.number), '--body', `檢查結果有變動（BC 版本 ${report.gameVersion ?? 'unknown'}，目前 ${problems} 項差異），內文已更新。`);
    console.log(`已更新 issue #${existing.number}`);
  }
} else if (open.length) {
  for (const issue of open) {
    gh('issue', 'comment', String(issue.number), '--body', `BC 版本 ${report.gameVersion ?? 'unknown'} 已與基準一致，自動關閉。`);
    gh('issue', 'close', String(issue.number));
    console.log(`差異已消失，已關閉 issue #${issue.number}`);
  }
} else {
  console.log('無差異，沒有需要處理的 issue。');
}
