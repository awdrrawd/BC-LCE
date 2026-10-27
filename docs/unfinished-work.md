# 未完工作與驗收

更新：2026-10-06（PR12 合併後維護檢查；歷史日期僅保留作為追蹤脈絡）。2026-10-27 文件核對只更新了測試數量與過時的路徑／建置描述，各待辦的完成狀態沒有重新驗收。這份清單是目前待辦；code-review-2026-09-05.md 包含歷次修改前的問題，不應全部當成未修問題。

## 提交前：使用者實測

- [ ] 主題：原先失效的擴充圖示是否恢復染色；簡易／進階配色、主題關閉再開啟、字型獨立開關。
- [ ] LCE 偏好設定：懸停只亮底色，文字維持原色；滑桿、顏色、主題快照更新後重新登入仍保存。
- [ ] IM：歷史還原、連續收發、未讀提示、重連；資料庫仍為 `lce-im` V1，store 為 `history`，不升版或搬移資料。
- [ ] 登入：帳號輪播、桌布快速切換、長時間停留登入頁再登入。
- [ ] 直式：橫直切換、搜尋區域、加入房間、滑動翻頁、翻頁中刷新／離開、卸載後不殘留介面。
- [ ] 動物動畫文字觸發（PR26）：實測 `*wiggle` 與 `*wiggle*` 都能觸發、結尾語氣符號（`~`、`!`）、三個部位都關閉時沒有計時器。
- [ ] 動物動畫：本人逐格送物件更新，實測連續觸發、最短延遲（100 毫秒）與多部位同時播放，確認不會被伺服器限流或斷線；若有問題再調高送出端的最短延遲。
- [ ] 表情：手動表情、活動表情、單眼、慾望階段與多姿勢衝突。`features/expressions/data.js`（原 `expressions-data.js`）未修改；時間計算與姿勢仲裁有調整。
- [ ] 與 WCE／Responsive／PCM 並存及缺席時的行為；確認沒有重複 hooks、重複提示或插件互相覆寫。
- [ ] 使用者確認無阻擋問題後，再做一次 commit。尚未提交或部署。

## 錯誤流程的後續驗證

目前 229 項 Node VM 測試通過（2026-10-27 重新計算）；Source ZIP 由於沒有 `.git`，建置時會略過 pinned assets 同步；Git clone／CI 仍應完整執行 `npm run build`，但模擬 DOM／BC／IndexedDB 不能代替瀏覽器與伺服器驗收。

- [ ] IM 整合故障注入：開庫延遲／失敗期間仍接收事件，讀取失敗後連續訊息保留，再次開窗成功還原後按順序合併。既有測試涵蓋讀取失敗禁止保存及正常延遲收訊，完整失敗後重試鏈仍需補驗證。
- [ ] IM 寫入失敗：目前記錄警告並回傳 false，控制器未提供使用者可見的未保存狀態；評估提示與重試策略，避免只留 console。
- [ ] 設定失敗提示：目前 API／action 可收到 false，但一般控制項尚未一致呈現「已套用、未保存」與重試入口。不得把記憶體更新說成已遠端保存。
- [ ] Hook 安裝：已有失敗快照與警告；上層尚未統一顯示部分安裝失敗或安排重試。不要因可選 hook 不存在而中止所有功能。
- [ ] 聊天原地更新：已測文字替換；另驗證其他插件只改連結屬性、重建相同文字 DOM，以及重連快照後的互動。避免自身 DOM 修改造成重入。
- [ ] 帳號切換：IM history Promise、待處理事件及畫面狀態目前未完整按帳號生命週期隔離；確認是否支援不重載頁面的切換，再決定清理／重建流程。

## 暫緩，非本輪測試前必改

- [x] JS chunk 內容 hash 與部署舊資產保留策略：目前 `main.js` 維持固定入口（loader 以 `?v=` 取新），`app` chunk 與圖片／影片輸出都採 content hash（見 `vite.config.js`）；部署時舊 chunk 需保留一段時間，讓仍快取舊 `main.js` 的分頁可以載入。
- [x] vendored SDK 的來源與同步方式：架構／自動化文件已記錄，後續只在來源版本更新時同步。
- [x] loader 單一來源：已移除 `public/`，正式版 loader 只保留根目錄的 `loader.user.js`，由 `vite.config.js` 的 `emit-loader` 在建置時輸出到 `dist/`；本機版 `loader.local.user.js` 與 `login-preview.html` 不再部署。
- [ ] 【不急迫】結構盤點（2026-10-10）後尚未處理的建議，皆為整理性質、不影響功能：
  - `features/chat-qol.js` 名稱與內容不符：實際是寵物服動畫同步與表情 QoL（匯出 `onPetsuitMessage`、`togglePetsuitAnimation` 等），且 `petsuit-render.js` 只被它使用。建議合併成 `features/petsuit/`，並重新命名。
  - `features/trusted-domains.js` 是被 `app.js`、`misc.js`、`chat/chat-augments.js`、`settings/trusted-domain-manager.js` 共用的服務，建議與其管理介面規劃在一起（`features/trusted-domains/`）。
  - `core/` 仍反向依賴外層：`settings-schema.js` → `settings/theme-actions.js`、`game/setting-effects.js`、`features/animal/actions.js`；`settings-values.js` → `game/language.js`；`state.js` → `loginpage/state.js`；`theme-api.js` → `features/theme/`。根本做法是讓各功能自己提供 schema 片段再由 core 組合，工程較大，另案處理。
  - `ui/chat/markup.js` 只有 `features/chat/index.js` 使用，`ui/transition.js` 只有 `features/vertical/chatsearch.js` 使用；目前保留在 `ui/` 當共用層，若之後仍無第二個使用者再搬回各功能。
  - `echo-mouth-pull.js`、`behaviors.js`、`misc.js`、`region-switch.js` 仍是 `features/` 根目錄的獨立檔案，數量不多，暫不另立資料夾。
- [x] `src/core/i18n-engine.js` 的 `loadScript()` 已限制只能載入 `awdrrawd.github.io` 與 jsDelivr 的自家路徑（見 `docs/security-notes.md`、`tests/security-patches.test.mjs`）。
- [ ] 信息凍結插件改釘 jsDelivr commit hash 並加 SRI（需要實際 commit 與 hash，無法離線產生）。
- [ ] 僅在實測或事件流程分析證明有責任混雜時，才整理其他大模組；不以行數或檔案數作為目標。

## 已收斂的範圍

設定 UI／API 共用更新入口；通知不再依賴指令模組；動作訊息、JSON 解析及 hook 包裝集中。表情計算合併至 `calculations.js`，設定觸發的遊戲操作集中至 `setting-effects.js`，IM 單則呈現回到控制模組。架構圖以現行責任為準。


## 2026-10-06 本輪已處理

- [x] PR12 合併後重新跑完整 Node VM suite：92/92 通過。
- [x] 聊天容量 prune 邊界：只移除 `.ChatMessage`，保留其他插件 DOM 節點。
- [x] 清理未使用的 `src/core/storage.js` 兼容轉匯出。
- [x] Source ZIP 的 `verify-assets` 不再因缺少 `.git` 直接中止。

仍需實際 BC／多插件共存驗證的項目，不在本輪以模擬測試冒充完成。
