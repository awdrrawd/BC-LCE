# 自動檢查

- PR：`LCE checks` → `Test and build`，執行測試、建置及 JS／gzip 大小報告，不部署、不需額外 secrets。
- main：保留既有 GitHub Pages 測試、建置與部署流程。
- 手動：Actions 頁可執行 `LCE checks`。

## 管理者設定

1. 提交並推送 workflow；本地建立檔案不會啟用遠端檢查。
2. 確认 repository 允許 GitHub Actions，且 `assets` 分支可讀。
3. 執行一次檢查後，將 `Test and build` 加入 main 的 required status checks，要求 PR 合併前通過。
4. 保留現有 Pages 的 GitHub Actions 部署來源與 environment 權限。

PR 會另行建置 base SHA，比較全部 JS 的原始與 gzip 大小，顯示增減 bytes 與百分比；手動執行只有絕對值。大小變化僅報告，不阻擋合併。base 建置失敗仍會讓檢查失敗，避免顯示不完整比較。

素材由 `assets.lock.json` 固定 commit。Git clone 下的 `predev`／`prebuild` 會逐檔驗證 Git blob hash；缺少的素材自動補齊，內容不符會停止，不會覆蓋本地素材，也不修改 Git index。若從 GitHub Source ZIP 執行，因沒有 `.git` 無法驗證 pinned commit，腳本會改為警告並略過素材同步；這時只有 ZIP 內自行提供的 `assets/` 會參與 Vite 建置。初始 commit 取自本地 origin/assets，40 個檔案已驗證相符。更新素材時需明確更新 lock commit，先備份／移走不符的檔案再建置。

原素材抓取腳本已替換為 `scripts/verify-assets.mjs`。新的 CI 不需新增 secrets，必要檢查名稱不變。

尚未加入瀏覽器截圖回歸；目前直式版面已有座標／尺寸的模擬回歸測試，但模擬測試不能代替 iPhone 或實際遊戲截圖。真實 PR 觸發仍需推送後驗證。

## 共存界線

筆記維持 WCE 共用資料庫與 schema。只合併進行中的讀取，不快取已完成讀取；WCE 接管時不由 LCE 背景更新旗標。LCE 明確儲存成功仍立即發布旗標。

徽章仍由 LCE 優先控制，保留現有暫藏 FBC 的相容方式；已測試 WCE hook 先／後註冊。這仍依賴已知 WCE hook 優先序，不代表所有第三方版本皆已驗證。


## Source ZIP 建置

GitHub Source ZIP 不包含 `.git`，所以不能依 `assets.lock.json` 自動 fetch `assets` branch。這不是 CI 的問題：GitHub Actions 使用 checkout 後仍保有 Git metadata，會走完整驗證。

若需要可重現且包含完整登入背景／影片的建置，請使用 Git clone；Source ZIP 主要適合閱讀、修改與不依賴外部素材的測試。
