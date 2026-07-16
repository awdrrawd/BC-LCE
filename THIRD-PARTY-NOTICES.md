# 第三方授權聲明（Third-Party Notices）

LCE 本體以 **AGPL-3.0** 授權（見 [LICENSE](./LICENSE)）。
本專案整併了以下開源專案的程式碼，各自的授權與著作權聲明如下。
授權全文置於 [`licenses/`](./licenses/)。

---

## WCE — Wholesome Club Extensions
- **授權**：GPL-3.0-or-later — 全文見 [`licenses/WCE-GPL-3.0.txt`](./licenses/WCE-GPL-3.0.txt)
- **與 AGPL 的相容性**：GPLv3 第 13 條明文允許把 GPLv3 作品與 AGPLv3 作品結合成單一作品；
  結合後各部分仍受其原授權約束。
- **本專案使用/改作的部分**：
  - 設定頁與設定儲存架構（`settingsPage.ts`、`util/settings.ts`）
  - 指令系統 Commander（`commands.ts`）— 已排除 toy / uwall / r / anim / pose
  - 聊天鏈接與嵌入、個資富文本、待送訊息、已知個資、好友上下線通知、即時通訊
  - 防混淆／防聾／興奮結巴（`antiGarbling.ts`、`chatAugments.js`）
  - 自動慾望表情／活動表示與其資料表（`automaticExpressions.js`、`util/expressions.ts`）
    — **已移除 `animationEngine` 總開關**，改由兩項設定各自控制
  - 衣櫃（`extendedWardrobe.ts`、`privateWardrobe.js`）、繪圖快取（`cacheClearer.ts`）
  - 翹鎖提示、自動掙扎、斷線重連、共享插件、異常新帳號、第三方網域確認
- **資料相容**：刻意沿用 WCE 的儲存鍵，使資料雙向互通 —
  `bce-past-profiles`（已知個資）、`Player.ExtensionSettings.FBCWardrobe`（拓展衣櫃）、
  `Player.FBCOtherAddons`（插件清單）。

## Themed-BC
- **授權**：MIT — Copyright (c) 2026 dDeepLb — 全文見 [`licenses/Themed-BC-MIT.txt`](./licenses/Themed-BC-MIT.txt)
- **本專案使用/改作的部分**：主題染色引擎（`gui_redraw` 的 hook 群、`utilities/color.ts` 的
  色彩運算、`ColorType` 編碼、`patchFunction` 色彩 token 化）與樣式表
  （`scrollbar` / `selection` / `inventory` / `inputs` / `chat` / `preference` /
  `chatroom_search` / `misc` / `friendList`，CSS 變數前綴改為 `--lce-`）。
  未使用其 integrations 與自有元件樣式。

## BC-Responsive
- **授權**：MIT — Copyright (c) 2023 dDeepLb — 全文見 [`licenses/BC-Responsive-MIT.txt`](./licenses/BC-Responsive-MIT.txt)
- **本專案使用/改作的部分**：說話時自動開口（`Modules/CharTalk.ts` 的字母→嘴型對照與動畫流程）。
  **改作**：原表僅涵蓋拉丁/斯拉夫字母，本專案另加全形標點停頓與中日韓文字的交替張合。

## BCNotifyPlus
- **授權**：MIT — Copyright (c) 2022 Da'Inihlus — 全文見 [`licenses/BCNotifyPlus-MIT.txt`](./licenses/BCNotifyPlus-MIT.txt)
- **本專案使用/改作的部分**：好友上下線以「聊天室訊息」樣式通知的做法（與 WCE 的氣泡樣式並列為二選一）。

## BC_LianOptimizationSource
- **授權**：MIT — Author: XinLian
- **本專案使用/改作的部分**：性能優化的概念與參數（聊天記錄條數上限、降低貼圖畫質、低幀率）。
  **改作**：未沿用其自行改寫 WebGL 上傳流程與 `FrameRateLimitManager` 的做法，改以侵入性較低的方式實作。

## Liko - CRA / Liko - MPL
- 與本專案同作者（Likolisu）。
- CRA：替他人改姿勢、輸入歷史、@ 帶名字、頭頂時區、指令轉按鈕、`/cum` 指令已整併進 LCE。
- MPL：直式聊天室 / 對話框 / 房間清單 / 房間類型選擇的版面已整併進 LCE
  （`src/features/vertical/`）；直式登入則改為沿用 LCE 既有登入頁的 RWD 版面，
  尺寸參考 MPL。**LCE 已完整取代 MPL，兩者不應同時啟用**（會重複 hook
  `LoginLoad` / `DrawProcess` 等）。

## bcModSdk
- 由 Jomshir98 提供（`https://github.com/Jomshir98/bondage-club-mod-sdk`），內嵌於 `src/modsdk.js`。

## idb
- MIT — Copyright (c) 2016, Jake Archibald。經 npm 相依安裝，授權隨套件散布。

---

### 變更聲明
依 GPL-3.0 第 5 條，凡取自 WCE 的檔案皆已在原始碼標頭註明其來源與本專案所做的修改
（例如「移植自 WCE …」「已移除 animationEngine 總開關」「未移植 localWardrobe」等）。
