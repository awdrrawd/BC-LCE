# Liko - LCE（Liko Club Extensions）

束縛俱樂部（Bondage Club）的功能擴充 **mega-addon**：整合並優化了介面染色、即時通訊、表情/姿勢、效能、反作弊、衣櫃等一系列功能，並提供一套橫式登入介面。定位是 **WCE 的替代品**（移植了 WCE / Themed / Responsive / NotifyPlus 等的功能），與 [Liko - MPL](./Liko%20-%20MPL.main.user.js)（直式手機佈局）互補：**橫向啟用 LCE 版面、直向啟用 MPL 版面**，帳號 / 頭像 / 密碼儲存雙向共用。

> **與 WCE 資料互通**：刻意沿用 WCE 的 `ExtensionSettings` 鍵與欄位名（衣櫃 `FBCWardrobe`、圖層隱藏 `WCEOverrides` + `item.Property.wceOverrideHide`），裝過 WCE 的存檔可直接讀取。
>
> **徽章 / `/versions` 走同一條頻道**：頭頂徽章與版本查詢用的打招呼訊息，與 WCE 同走 `BCEMsg` 這條 Hidden 頻道，額外夾一個 `lce` 標記讓兩邊能區分 LCE 與 WCE。因此 WCE 使用者也查得到 LCE 的人（會以 WCE 徽章 + `Other Addons` 清單呈現）；LCE 之間則正確顯示 LCE 徽章。詳見 [`src/features/hello.js`](src/features/hello.js) 開頭說明。

## 功能總覽

設定頁（遊戲偏好 → 擴充組件，或 `/lcesetting`）分成八類：

| 類別 | 內容（例） |
|---|---|
| **聊天 & 社交** | 即時通訊、聊天連結/圖片嵌入、豐富個人檔案、好友上下線通知、改他人姿勢、指令按鈕化、已看過的個資瀏覽… |
| **BC 主題** | 移植 Themed 的 `gui_redraw` 染色引擎；主/強調/文字色（簡易）或每一項顏色（進階）、狀態色、存/讀色票槽。**跨帳號共用** |
| **UI 設定** | 橫式/直式登入介面、直式房間搜尋/聊天室、LCE 系統訊息與通知氣球配色。**跨帳號共用** |
| **沉浸** | 表情/姿勢動畫引擎、自動慾望表情、活動表情、防亂碼（anti-garble）、慾望成長加成、興奮結巴… |
| **衣櫃** | 拓展衣櫃 96 格、角色預覽衣櫃、覆蓋確認、圖層隱藏（BETA）… |
| **效能** | 聊天記錄延遲渲染 + 自動清除、貼圖畫質、低幀率模式、FPS 顯示、清繪圖快取… |
| **作弊 & 反作弊** | 反作弊（依關係設門檻）、UWALL、開鎖提示、綑綁時可分層、自動掙扎… |
| **雜項** | 斷線自動重連（含異地登入判斷）、離開確認、分享插件清單、第三方內容網域確認… |

指令：`/lce`（總覽）、`/lcesetting`（開設定頁）、`/lcesetlist`（列出/刪除 `ExtensionSettings`）、`/profiles`、`/versions` 等。

## 專案結構

```
src/
  main.js            進入點：重複載入防護 → 登入前必備（全域設定/配色/FUSAM/登入頁）
                     → 等 BC 核心就緒 → 等登入 → 依序安裝各功能（每步 safe() 隔離）→ 掛公開 API
  modsdk.js          內建 bcModSdk 1.2.0（打包進 bundle，不用 @require）

  core/
    constants.js     常數（座標、儲存 key、z-index、FUSAM 透傳清單…）
    state.js         登入頁共用可變狀態 S + 設定存取
    storage.js       AES-GCM 加密 + IndexedDB 快照 + localStorage 帳號（與 MPL 共用 key）
    util.js          DOM / 環境工具（injectStyle、place、getCanvas、byteSize…）
    feature-settings.js  功能設定儲存層（ui/theme 走全域 localStorage、其餘走 ExtensionSettings.LCE）
    settings-schema.js   所有設定的 schema（型別、預設、分類、sideEffects）
    theme-api.js     對外主題色 API（window.Liko.LCE.Theme）
    i18n.js          i18n 載入器（載入 7 個語系包 + 翻譯工具）
    i18n-registry.js Liko 共用語言判斷註冊處（window.Liko.I18N）
    i18n/            語系包：tw / cn / en / de / fr / ru / ua（每包完整字表）

  features/          各功能模組（chat / theme / expressions / wardrobe / cheats / performance /
                     instant-messenger / relogin / layering-hide / misc … 各自 installXxx()）
    styles/          染色引擎用的 CSS/SCSS（卷軸/輸入框/聊天/房間搜尋…）
    vertical/        直式版面（移植自 MPL）

  loginpage/         橫式登入頁（背景、帳號輪播、設定浮層、BC 原生隱藏 + FUSAM 透傳、主流程）
  settings/          遊戲內設定頁（PreferenceRegisterExtensionSetting 九宮格）
  assets/            圖示

loader.user.js       正式版載入器（讀 GitHub Pages 的 dist/assets/main.js）
loader.local.user.js 本地開發載入器（讀 http://localhost:5174/assets/main.js）
```

## 對外 API（`window.Liko.LCE`）

```js
LCE.version                         // 版本字串
LCE.getFeature(key) / setFeature(key, value)   // 讀/寫功能設定（會觸發 sideEffects + 存檔）
LCE.settings                        // 目前設定物件（唯讀 getter）

// 主題色（建議用 Theme.*；未啟用染色時顏色一律 null）
LCE.Theme.enabled                   // boolean：染色是否啟用
LCE.Theme.Main / .Accent / .Text …  // hex，或未啟用時 null（另有 Element/ElementHover… 全套）
LCE.Theme.isDark / .palette / .special
LCE.isThemeEnabled()                // 同 Theme.enabled
// 向後相容（等同 Theme.*、未啟用時同樣回 null）：getMainColor/getAccentColor/getTextColor/getPalette/isDarkTheme

// 表情引擎診斷、登入頁熱移除等，見 main.js 的 Object.assign 區塊
```

語言跟隨 BC 的語言設定（`TranslationLanguage`），支援 **TW / CN / EN / DE / FR / RU / UA**；語言判斷透過 `window.Liko.I18N` 與其他 Liko 插件共用。

## 本地測試（參考 BC-AEE 做法）

1. 安裝相依套件：
   ```
   npm install
   ```
2. 啟動本地開發伺服器（會 build 一次並開始 watch + preview）：
   ```
   npm run dev
   ```
   或直接雙擊 `run_dev.bat`。
3. 在 Tampermonkey 安裝 **`loader.local.user.js`**（只裝這一個，別同時裝正式版）。
4. 開啟 / 重新整理 BC，即可看到 LCE。改動 `src/` 後 Vite 會自動重建，重新整理 BC 就會載入最新版。

> Vite 設定裡的 `Access-Control-Allow-Private-Network` header（PNA plugin）是必要的，
> 否則 Chrome 會擋下 HTTPS 的 BC 頁面去 fetch localhost 的 bundle。

## 正式建置

```
npm run build
```
產物在 `dist/assets/main.js`，由 `loader.user.js` 以 dynamic import 載入。
`scripts/sync-version.mjs` 會在 build / dev 前把 `package.json` 的版本同步到兩個 loader 的 `@version`。
