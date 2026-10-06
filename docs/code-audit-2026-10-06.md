# LCE 程式健檢（2026-10-06）

本輪以 PR #12 合併後的 LCE source snapshot 為基準，先執行現有 Node VM tests，再做模組依賴、建置流程、聊天容量、素材驗證與文件一致性檢查。

## 結果

- Node VM tests：**92 / 92 通過**。
- Translation：七語 key set 全部一致，458 / 458 keys 均存在。
- Source graph：109 個 `src/*.js` 中，`src/core/storage.js` 沒有任何 runtime import，確認為已被 `src/storage/` 分拆後遺留的死碼；已移除。
- Chat capacity：`pruneOldest()` 原本會把到達刪除門檻前的所有 element 一起移除，而不只是 `.ChatMessage`；已修正並加入 regression test。
- Asset build：`verify-assets.mjs` 原本假設目前目錄一定是 Git worktree；Source ZIP 沒有 `.git` 時會直接失敗。現在 Git clone 仍做 pinned commit 驗證，Source ZIP 改為明確警告並略過 Git-only 同步。

## 保留不動的項目

`src/core/i18n-engine.js` 雖然是 side-effect module，沒有直接 import consumer，實際由 `i18n-registry.js`／Echo L10N 路徑載入，因此不屬於死碼。

`src/features/theme/theme-test.js` 由 `/lceThemetest` 指令使用，雖然是 debug 工具，但仍有明確 runtime consumer，因此保留。

大量 feature-level `setInterval`／事件 listener 屬於「一次安裝、頁面生命週期存在」設計；本輪沒有證據顯示它們會重複安裝或在目前架構下造成累積，因此不做僅憑行數的重構。

## 建議的實機驗收

仍建議在實際 Bondage Club 環境確認：LCE + WCE / Responsive 共存、登入頁背景素材、聊天容量清除、Echo Activity 映射，以及切房／離開後 hook、timer、observer 是否完整交還。自動測試不能替代這些整合驗收。


## 2026-10-06 重連聊天修正

針對偶發「斷線重連後 ChatMessage 被清空」問題，新增 `docs/automatic-reconnect.md` 與 `src/storage/reconnect-credentials.js`。重連熱路徑不再等待 WebCrypto，ChatLog 恢復從固定 400ms 改成最多 10 秒的重試與缺失訊息去重。新增回歸測試後測試總數為 94/94。
