# Liko - LCE（Liko Club Extensions）

束縛俱樂部（Bondage Club）的功能擴充 **mega-addon**：整合並優化了介面染色、即時通訊、表情/姿勢、效能、反作弊、衣櫃等一系列功能，並提供一套橫式登入介面。定位是 **WCE 的替代品**（移植了 WCE / Themed / Responsive / NotifyPlus 等的功能），與 [Liko - MPL](./Liko%20-%20MPL.main.user.js)（直式手機佈局）互補：**橫向啟用 LCE 版面、直向啟用 MPL 版面**，帳號 / 頭像 / 密碼儲存雙向共用。

> **與 WCE 資料互通**：刻意沿用 WCE 的 `ExtensionSettings` 鍵與欄位名（衣櫃 `FBCWardrobe`、圖層隱藏 `WCEOverrides` + `item.Property.wceOverrideHide`），裝過 WCE 的存檔可直接讀取。
>
> **徽章 / `/versions` 走同一條頻道**：頭頂徽章與版本查詢用的打招呼訊息，與 WCE 同走 `BCEMsg` 這條 Hidden 頻道，額外夾一個 `lce` 標記讓兩邊能區分 LCE 與 WCE。因此 WCE 使用者也查得到 LCE 的人（會以 WCE 徽章 + `Other Addons` 清單呈現）；LCE 之間則正確顯示 LCE 徽章。詳見 [`src/features/hello.js`](src/features/hello.js) 開頭說明。

## 文件

- [ExtensionSettings 與 AccountUpdate 處理說明](docs/extension-settings-account-update.md)
- [LCE 架構與擴充指南](docs/architecture.md)
- [互動式功能分支圖](docs/lce-architecture.html)

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

自動重連與 ChatLog 保護的設計與時序見 [`docs/automatic-reconnect.md`](docs/automatic-reconnect.md)。

指令：`/lce`（總覽）、`/lcesetting`（開設定頁）、`/profiles`、`/versions` 等。`ExtensionSettings` 的容量、備份與刪除已移至偏好設定中的「容量管理」。

### 沉浸設定與 ECHO 相容

沉浸設定分成「沉浸與表情」「聊天」「其他」三頁。聊天頁右側集中防混淆及其子設定；其他頁右側集中寵物服動作設定。反作弊的關係名單與動作按鈕位置可用下拉選單直接選取。

- **活動表情**：同一開關涵蓋原有活動與支援的 ECHO 活動。原有表情規則優先；新增對照表與匹配邏輯分別放在 `src/features/expressions/qol-data.js`、`qol-rules.js`，共用既有表情引擎。
- **顏文字表情**：預設關閉。傳送以空白分隔的顏文字時，觸發五秒表情，需要啟用表情引擎。
- **嘴部牽引**：預設開啟。雙手受限、嘴部可用且牽引方 Misc 格為空時，可使用 ECHO 的「拉到身邊」。雙方需要 ECHO，對方不需要 LCE；道具配對與權限檢查仍由 ECHO 處理。補充動作訊息透過共用 L10N 引擎提供七語翻譯。
- **更豐富的音效**：預設關閉。為支援的 ECHO 活動補充音效，保留既有音效優先順序及遊戲音量、靜音設定。
- **寵物服動作**：預設關閉，需要表情引擎、寵物服及切換手臂姿勢的權限。可設定動畫次數、動作間隔與四個按鈕位置；每次包含左右手各舉起一次，結束後恢復原姿勢。左右交替採用本機畫面合成，其他人仍看到 BC 原生的雙手姿勢。手動換姿勢會停止動作。
- **聊天 QoL 的延遲與撤銷**：顏文字表情固定持續 5 秒；訊息觸發的嘴型可依訊息長度延遲，但新訊息到達時會取消舊的 pending mouth timer，避免過期表情回頭覆蓋新表情。寵物服與顏文字共用臨時表情快取，最後一個 hold 結束後才恢復原臉。
- **Echo 活動安全邊界**：只有已辨識的自訂 Echo 活動或 Luzi 活動才進入 LCE 的表情／音效映射；普通 BC Activity 不會僅因名稱碰到 `Kiss`、`Hit` 等關鍵字而誤觸發。

防混淆沿用既有 WCE 相容邏輯。「閉眼仍可見房間」暫不提供；從曾載入該功能的版本更新後，請重新整理遊戲以清除舊掛鉤。

## 專案結構

```
src/
  main.js            進入點：重複載入防護 → 登入前必備（全域設定/配色/FUSAM/登入頁）
                     → 等 BC 核心就緒 → 等登入 → 依序安裝各功能（每步 safe() 隔離）→ 掛公開 API
  modsdk.js          內建 bcModSdk 1.2.0（打包進 bundle，不用 @require）

  core/
    constants.js     常數（座標、儲存 key、z-index、FUSAM 透傳清單…）
    state.js         登入頁共用可變狀態 S + 設定存取
    i18n-registry.js 共用語言註冊橋接（內嵌 i18n-engine）
    util.js          DOM / 環境工具（injectStyle、place、getCanvas、byteSize…）
    feature-settings.js  功能設定儲存層（ui/theme 走全域 localStorage、其餘走 ExtensionSettings.LCE）
    settings-schema.js   所有設定的 schema（型別、預設、分類、sideEffects）
    theme-api.js     對外主題色 API（window.Liko.LCE.Theme）
    i18n.js          i18n 載入器（載入 7 個語系包 + 翻譯工具）
    Translation/     七語完整 JSON 字表（TW / CN / EN / DE / FR / RU / UA）

  features/          各功能模組（chat / theme / expressions / wardrobe / cheats / performance /
                     instant-messenger / relogin / layering-hide / misc … 各自 installXxx()）
    vertical/        直式版面（移植自 MPL）

  loginpage/         橫式登入頁（背景、帳號輪播、設定浮層、BC 原生隱藏 + FUSAM 透傳、主流程）
  settings/          遊戲內設定頁（PreferenceRegisterExtensionSetting 九宮格）
  assets/            建置時由 assets lock 補齊的登入圖片／影片（選配）
  Translation/       七語 JSON 字表

loader.user.js       正式版載入器（讀 GitHub main 分支的 dist/assets/main.js）
loader.local.user.js 本地開發載入器（讀 http://localhost:5174/assets/main.js）
```

## 對外 API（`window.Liko.LCE`）

```js
LCE.version                         // 版本字串
LCE.getFeature(key) / setFeature(key, value)   // 讀/寫功能設定（會觸發 sideEffects + 存檔）
LCE.settings                        // 目前設定物件（唯讀 getter）

// 圖片來源信任（origin 會正規化為 https://example.com）
LCE.TrustedImageOrigins.list()                  // 永久信任來源的複本
LCE.TrustedImageOrigins.isPermanentlyTrusted(urlOrOrigin)
LCE.TrustedImageOrigins.isSessionTrusted(urlOrOrigin)
LCE.TrustedImageOrigins.isTrusted(urlOrOrigin)  // 永久或本次連線信任
LCE.TrustedImageOrigins.addPermanent(urlOrOrigin)
LCE.TrustedImageOrigins.removePermanent(urlOrOrigin)
await LCE.TrustedImageOrigins.request(urlOrOrigin, 'image', { persistent: true })

// 主題色（建議用 Theme.*；未啟用染色時顏色一律 null）
LCE.Theme.enabled                   // boolean：染色是否啟用
LCE.Theme.Main / .Accent / .Text …  // hex，或未啟用時 null（另有 Element/ElementHover… 全套）
LCE.Theme.isDark / .palette / .special
LCE.isThemeEnabled()                // 同 Theme.enabled
// 向後相容（等同 Theme.*、未啟用時同樣回 null）：getMainColor/getAccentColor/getTextColor/getPalette/isDarkTheme

// 畫布按鈕（完整路徑皆以 window.Liko.LCE 開頭）
LCE.Button.Messenger
LCE.Button.EditProfile
LCE.Button.pastProfiles
// 共用方法：getPosition/setPosition/resetPosition、hide/show/isHidden、
// hideVisual/showVisual/isVisualHidden，以及 isEnabled。

// 即時通訊視窗另有 z-index 控制
LCE.Button.Messenger.getZIndex()
LCE.Button.Messenger.setZIndex(100)
LCE.Button.Messenger.resetZIndex()

// Past Profiles 個人備註
await LCE.pastProfiles.get(memberNumber)
await LCE.pastProfiles.set(memberNumber, note)

// Profile 分享能力（接收優先序：FCM > LCE > 獨立 WPS）
LCE.ProfileShare.apiVersion
await LCE.ProfileShare.share(memberNumber)  // 使用 LCE 保存的 Profile 發送
LCE.ProfileShare.handlesReceive()           // LCE 是否為目前的 PROFILESHARE 接收者

// 表情引擎診斷、登入頁熱移除等，見 main.js 的 Object.assign 區塊
```

語言跟隨 BC 的語言設定（`TranslationLanguage`），支援 **TW / CN / EN / DE / FR / RU / UA**；語言判斷透過 `window.Liko.I18N` 與其他 Liko 插件共用。

## 本地測試與建置（參考 BC-AEE 做法）

1. 安裝相依套件：
   ```
   npm install
   ```
2. 從 Git clone 專案時，`npm install` 後即可自動驗證／補齊 `assets`；若使用 GitHub 的 Source ZIP，因 ZIP 不含 `.git`，建置會跳過素材 hash 驗證，且不會自動抓取登入圖片／影片。需要完整登入背景時請改用 Git clone，或另行提供 `assets/`。

3. 啟動本地開發伺服器（會 build 一次並開始 watch + preview）：
   ```
   npm run dev
   ```
   或直接雙擊 `run_dev.bat`。
4. 在 Tampermonkey 安裝 **`loader.local.user.js`**（只裝這一個，別同時裝正式版）。
5. 開啟 / 重新整理 BC，即可看到 LCE。改動 `src/` 後 Vite 會自動重建，重新整理 BC 就會載入最新版。

> Vite 設定裡的 `Access-Control-Allow-Private-Network` header（PNA plugin）是必要的，
> 否則 Chrome 會擋下 HTTPS 的 BC 頁面去 fetch localhost 的 bundle。

## 正式建置

[R132Beta3 分支修補與驗收](docs/r132-compatibility.md)

```
npm run build
```
產物在 `dist/assets/main.js`，由 `loader.user.js` 以 dynamic import 載入。
loader 採獨立版本，只有載入機制變更時才手動更新；build / dev 不會跟隨 `package.json` 改寫 loader 的 `@version`。
