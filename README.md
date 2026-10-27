# Liko - LCE（Liko Club Extensions）

**繁體中文** | [English](./README.en.md)

束縛俱樂部（Bondage Club）的功能擴充 **mega-addon**：整合並優化了介面染色、即時通訊、表情與動作、效能、反作弊、衣櫃等一系列功能，並提供橫式登入介面與直式（手機）版面。定位是 **WCE 的替代品**，移植並整合了 WCE / Themed / Responsive / NotifyPlus 等插件的功能。

## 安裝

1. 安裝瀏覽器的使用者腳本管理器（例如 Tampermonkey）。
2. 安裝載入器：[`loader.user.js`](https://awdrrawd.github.io/BC-LCE/loader.user.js)。
3. 開啟或重新整理 Bondage Club。進入遊戲後，可用 `/lcesetting` 開啟設定頁，或在「遊戲偏好 → 擴充組件」中找到 LCE。

載入器只負責從 GitHub Pages 載入最新的 `assets/main.js`，所以更新插件不需要重新安裝載入器。

> **與 WCE 資料互通**：刻意沿用 WCE 的 `ExtensionSettings` 鍵與欄位名（衣櫃 `FBCWardrobe`、圖層隱藏 `WCEOverrides` + `item.Property.wceOverrideHide`），裝過 WCE 的存檔可直接讀取。
>
> **WCE 共存**：當 WCE 已載入且對應功能開啟時，LCE 會讓出重複的功能，不會同時執行兩份；WCE 關閉該功能時，LCE 才接手。細節與已知限制見 [WCE／LCE 共存檢查](docs/wce-compatibility.md)。
>
> **徽章與 `/versions` 走同一條頻道**：頭頂徽章與版本查詢用的打招呼訊息，與 WCE 同走 `BCEMsg` 這條 Hidden 頻道，額外夾一個 `lce` 標記讓兩邊能區分 LCE 與 WCE。因此 WCE 使用者也查得到 LCE 的人（會以 WCE 徽章呈現）；LCE 之間則正確顯示 LCE 徽章。詳見 [`src/features/social/hello.js`](src/features/social/hello.js) 開頭說明。

## 功能總覽

設定頁分成十類：

| 類別 | 內容（例） |
|---|---|
| **聊天 & 社交** | 即時通訊、聊天連結／圖片嵌入、豐富個人檔案與編輯保護、好友上下線通知、更換他人姿勢、已註冊指令轉按鈕、悄悄話斜體與對象自動解除、等待伺服器時顯示已發送訊息、訊息凍結、保存並瀏覽已知個人資料… |
| **BC 主題** | 移植 Themed 的染色引擎；簡易模式（主色／強調色／文字色）與進階模式（每一項顏色、狀態色）、介面字型與中文字型、色票紀錄欄位。**跨帳號共用** |
| **UI 設定** | 橫式登入介面、直式登入／房間搜尋／聊天室介面、LCE 系統訊息與通知氣球配色。**跨帳號共用** |
| **沉浸** | 表情引擎、自動慾望表情、活動表情、顏文字表情、說話時自動開口、防混淆（anti-garble）、防聾、慾望成長增幅、興奮結巴、嘴部牽引（ECHO）、更豐富的音效、寵物服動作… |
| **衣櫃** | 拓展衣櫃到 96 格、圖層隱藏設定（BETA）、直接獲得衣櫃 |
| **效能** | 聊天記錄可見數與自動清除、貼圖畫質（降低角色解析度）、多人角色重繪分流（實驗）、低幀率模式、FPS 顯示、繪圖快取清除… |
| **作弊 & 反作弊** | 反作弊（依關係設門檻）與自動黑名單、UWALL、顯示翹鎖順序、綑綁時可使用分層、掙扎時自動增加進度、繞過 BCX beep 限制 |
| **雜項** | 斷線自動重連（含異地登入判斷）、離開遊戲確認、載入第三方內容前提示、自動 ghost 異常新帳號、安全詞不變更互動權限、混合／女性區快速切換、隱藏衣櫃興奮條 |
| **動物** | 耳朵擺動、尾巴搖擺、翅膀拍動（見下） |
| **容量管理** | `ExtensionSettings` 的容量檢視、備份與刪除 |

自動重連與 ChatLog 保護的設計與時序見 [`docs/automatic-reconnect.md`](docs/automatic-reconnect.md)。

### 動物動畫（耳朵／尾巴／翅膀）

設定頁以上方三個分頁分別設定耳朵、尾巴、翅膀。每個部位都有兩個姿勢：

1. 在遊戲內把該部位的物品調成想要的狀態（顏色、屬性、旋轉、縮放、圖層等），回到 LCE 設定頁按「儲存靜止姿勢」存成 A。
2. 再調成另一個狀態，按「儲存擺動／搖擺／拍動姿勢」存成 B。

播放順序是 B → A → B → A …，共設定的循環次數，**最後停在 A**（靜止姿勢），所以發送者與所有接收者的最終狀態一致。設定頁右側有預覽區：預覽使用獨立的角色副本，不會改動本人外觀，也不會送出任何封包；另有按鈕可直接前往 BC 原生衣櫃調整物品。

- **手動觸發（文字觸發）**：在聊天室輸入下表的文字並送出，就會播放對應動畫。**支援七種語言**（English、繁體中文、简体中文、Русский、Français、Українська、Deutsch），詞與介面語言無關，任何一種語言都能觸發。

  | 部位 | English | 繁體中文 | 简体中文 |
  |---|---|---|---|
  | 耳朵 | `*wiggle*`、`*twitch*` | `*搖耳朵*`、`*抖耳朵*` | `*摇耳朵*`、`*抖耳朵*` |
  | 尾巴 | `*wag*` | `*搖尾巴*`、`*擺尾巴*` | `*摇尾巴*`、`*摆尾巴*` |
  | 翅膀 | `*flap*` | `*拍翅膀*`、`*搧翅膀*` | `*拍翅膀*`、`*扇翅膀*` |

  俄、法、烏、德語及每個語言的全部觸發詞見 [動物動畫文字觸發詞](docs/animal-trigger-words.md)，例如 `*шевелит ушами*`、`*remue la queue*`、`*махає крилами*`、`*wackelt mit den ohren*`。

  - 整句訊息只能是 `*關鍵字*` 或 `*關鍵字`（BC 的動作訊息結尾星號可省略，兩種效果相同），前後不能有其他文字：`*搖尾巴*` 可以，`*慢慢搖尾巴*` 與 `我在 *wag*` 都不會觸發。大小寫、重音符號（`é`、`ö`、`ё`…）、重複空白與結尾的語氣符號（`~`、`!`、`。`…）不影響，半形 `*` 與中日韓輸入法常打出的全形 `＊` 皆可，英文也接受第三人稱寫法（`*wiggles*`、`*wags*`、`*flaps*`）與加部位名（`*wag tail*`）。
  - 訊息會照常送出，所以房間裡的人會看到這行文字，送出後才開始播放。
  - 這是聊天文字，不是 `/` 開頭的指令，也不會出現在 `/lce` 指令總覽裡。
  - 該部位的開關要先打開（設定頁「動物」分頁），而且靜止姿勢 A 與擺動姿勢 B 都要已儲存；任一項沒做，輸入後不會有任何反應。
  - 手動觸發不要求目前有穿戴該物品（沒穿時會直接穿上 A／B 姿勢的物品）；自動觸發才需要已穿戴。
  - 播放中再次輸入會從頭重播，以最新一次為準。
- **自動觸發**：依「觸發間隔」隨機觸發，需要目前有穿戴該部位的物品；使用者脫掉的部位不會被穿回去。
- **同步方式**：開關只決定「自己會不會搖」，不影響你看不看得到別人搖。你的每一格動畫都會送一個物件更新封包（同 BCAR），所以房間裡所有人都看得到，**不需要安裝 LCE，也不需要開啟任何設定**；動畫最後停在 A，伺服器上的狀態也是 A。因為是逐格送出，延遲越短、循環越多，送出的封包越多。
- **提早結束**：播放中該部位被脫下或換成別的物品，動畫立即停止，不會覆蓋對方的變更。
- 循環次數預設為耳朵／尾巴 9、翅膀 3，上限 20；每格延遲限制在 100–2000 毫秒。
- 遠端傳來的姿勢資料會經過白名單、型別、深度與大小的檢查，並過濾危險鍵。

### 指令

（耳朵／尾巴／翅膀的 `*wiggle*`、`*搖尾巴*`、`*flap*` 等七種語言的觸發詞是聊天文字觸發，不是 `/` 指令，說明見上方「動物動畫」。）

`/lce`（指令總覽）、`/lcesetting`（開設定頁）、`/profiles <關鍵字>`、`/versions [名稱]`、`/w`、`/beep`、`/cum`、`/lcegotoroom`、`/exportlooks`、`/importlooks`、`/lcedebug`、`/lceThemetest`。部分通用指令會依 WCE 的啟用狀態在註冊時過濾。

### 直式（手機）版面

直式登入、房間搜尋與聊天室版面移植自 MPL，可在「UI 設定」分別開啟。與 MPL 不同的是：MPL 只看螢幕方向就套用，LCE 是「直向 **且** 該項設定開啟」才套用。帳號、頭像與金鑰的儲存層與 MPL 共用，兩邊的登入資料互通。其他插件可透過 `window.Liko.LCE.Vertical.getState()` 取得目前版面狀態，見 [vertical-api](docs/vertical-api.md)。

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

### 衣櫃

BC R132 起的原生衣櫃已內建角色預覽與覆蓋確認，LCE 不再另外接管這兩項（原有的「角色預覽衣櫃」與「覆蓋確認」已移除）。目前保留的是拓展衣櫃 96 格、圖層隱藏（BETA）與直接獲得衣櫃。額外的衣櫃格存在 WCE 相同的 `FBCWardrobe` 鍵，裝過 WCE 的帳號可直接讀取。

## 語言

語言跟隨 BC 的語言設定（`TranslationLanguage`），支援 **TW / CN / EN / DE / FR / RU / UA** 七種語言。字表放在 [`Translation/`](Translation/)，語言判斷透過 `window.Liko.I18N` 與其他 Liko 插件共用。

## 文件

- [LCE 架構與擴充指南](docs/architecture.md) 與 [互動式功能分支圖](https://awdrrawd.github.io/BC-LCE/lce-architecture.html)（GitHub Pages 線上版；原始檔 [`docs/lce-architecture.html`](docs/lce-architecture.html)）
- [ExtensionSettings 與 AccountUpdate 處理說明](docs/extension-settings-account-update.md)
- [自動重連與 ChatLog 保護](docs/automatic-reconnect.md)
- [共用個資資料庫](docs/profile-database.md)
- [直式版面 API](docs/vertical-api.md)
- [動物動畫文字觸發詞（七種語言）](docs/animal-trigger-words.md)
- [WCE／LCE 共存檢查](docs/wce-compatibility.md)
- [R132Beta3 相容性修補](docs/r132-compatibility.md)（歷史紀錄）
- [自動檢查（CI）](docs/automation.md)
- [安全說明](docs/security-notes.md)（含 `npm run check:bc` 的 BC 掛鉤相容檢查）
- [個資分享（WPS）協定與限制](docs/profile-share.md)
- [聊天按鈕與測試整理](docs/chat-buttons-test-audit.md)
- [檔案搬移對照](docs/file-moves.json)（舊路徑 → 新路徑，供對照審查紀錄）
- [Responsive／LCE 表情與口型分工](docs/responsive-ownership-review.md)
- [未完工作與驗收](docs/unfinished-work.md)
- 審查紀錄：[2026-09-05 程式結構審查](docs/code-review-2026-09-05.md)、[2026-10-06 程式健檢](docs/code-audit-2026-10-06.md)（記錄當時的狀況，不代表現況）

## 專案結構

```
src/
  main.js            進入點：重複載入防護，動態載入 app.js
  app.js             登入前必備（全域設定／配色／FUSAM／登入頁）→ 等 BC 核心就緒
                     → 等登入與設定載入 → 依序安裝各功能（每步 safe() 隔離）→ 掛公開 API
  modsdk.js          內建 bcModSdk（打包進 bundle，不用 @require）

  core/              共用基礎：常數、設定 schema 與儲存、i18n、hook 管理、生命週期、
                     WCE 共存判斷、公開 API、主題 API
  commands/          指令系統（commander.js）
  features/          各功能模組，各自提供 installXxx()：
                     chat / social / messenger / theme / expressions / wardrobe /
                     safety / performance / vertical / animal（動物動畫：播放、姿勢邏輯、七語言觸發詞、設定頁預覽）/
                     echo-mouth-pull / petsuit-render / region-switch / misc …
  game/              對 BC 函式的薄封裝（聊天動作、房間搜尋與導覽、語言）
  loginpage/         橫式登入頁（背景、帳號輪播、設定浮層、BC 原生隱藏 + FUSAM 透傳）
  settings/          遊戲內設定頁（容量管理、色彩選擇器、信任來源管理）
  storage/           帳號、憑證、重連憑證、桌布與 IndexedDB 資料庫
  ui/                聊天訊息渲染、通知與轉場
  assets/            圖示

Translation/         七語 JSON 字表（TW / CN / EN / DE / FR / RU / UA）
tests/               Node VM modules 測試
scripts/             素材驗證、bundle 大小報告與 BC 掛鉤相容檢查（check-bc-compat.mjs）
docs/                設計說明與維護紀錄；互動式架構圖 lce-architecture.html 建置時一併輸出到 dist/，由 Pages 發布
.github/             CI 工作流程（測試與建置、Pages 部署、BC 相容性週檢、安全檢查）與 Dependabot
loader.user.js       正式版載入器（建置時由 vite.config.js 輸出到 dist/，經 GitHub Pages 提供；讀自動生成的 assets/main.js）
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

// 直式版面狀態（見 docs/vertical-api.md）
LCE.Vertical.getState()

// 表情與診斷
LCE.FaceCache                       // 臨時表情快取（唯讀）：{ original, applied }
LCE.expressionData                  // 表情資料表（唯讀）
LCE.debugExpressions(true) / getExpressionQueue() / getExpressionHookOrder()
LCE.getHookFailures()               // 目前沒掛上的 BC 掛鉤（BC 改版時用來診斷）
LCE.debugRelogSnapshot()            // 重連快照診斷
LCE.WCECompatibility                // WCE 共存判斷（isLoaded / isFeatureEnabled / shouldLceHandle）
LCE.isExpressionEngineStarted() / getFaceComponents()  // 表情引擎是否啟動／各部位是否在引擎管轄內

// 維護與其他（供其他插件或 console 使用，不保證穩定）
LCE.refreshI18n()                   // 重新套用語言
LCE.reloadSettings() / refreshAccounts() / captureProfile() / teardownLoginUI()  // 登入頁相關
LCE.profileDatabase                 // 共用個資資料庫的名稱與版本（見 docs/profile-database.md）
LCE.TrustedImageOrigins.normalize(urlOrOrigin)  // 正規化為 https://example.com
```

## 本地測試與建置

需要 Node.js 22.12 以上（CI 使用 Node 22）。

1. 安裝相依套件：
   ```
   npm install
   ```
   從 Git clone 專案時，`npm install` 後即可自動驗證／補齊 `assets`；若使用 GitHub 的 Source ZIP，因 ZIP 不含 `.git`，建置會跳過素材 hash 驗證，且不會自動抓取登入圖片／影片。需要完整登入背景時請改用 Git clone，或另行提供 `assets/`。

2. 執行測試：
   ```
   npm test
   ```

   需要與 Bondage Club 原始碼比對掛鉤時，另可執行 `npm run check:bc -- --bc-dir <BC 原始碼資料夾>`，說明見 [安全說明](docs/security-notes.md)。

3. 啟動本地開發伺服器（會 build 一次並開始 watch + preview）：
   ```
   npm run dev
   ```
   或直接雙擊 `run_dev.bat`。
4. 在 Tampermonkey 安裝 **`loader.local.user.js`**（只裝這一個，別同時裝正式版）。
5. 開啟 / 重新整理 BC，即可看到 LCE。改動 `src/` 後 Vite 會自動重建，重新整理 BC 就會載入最新版。

> Vite 設定裡的 `Access-Control-Allow-Private-Network` header（PNA plugin）是必要的，
> 否則 Chrome 會擋下 HTTPS 的 BC 頁面去 fetch localhost 的 bundle。

## 正式建置與部署

```
npm run build
```

建置產物（`dist/`）**不進 Git**，避免 build 產物在分支合併時產生衝突，一律由 CI 生成：

- **Pull request**：`LCE checks` 會執行 `npm test`、`npm run build`，並與 PR 的 base 分支比較 bundle 大小，不部署。
- **合併到 `main`**：`Deploy GitHub Pages` 會執行測試與建置，再把 `dist/` 部署到 GitHub Pages（Pages 來源需設為 GitHub Actions）。`dist/` 內除了 `loader.user.js` 與 `assets/`，也包含互動式架構圖：https://awdrrawd.github.io/BC-LCE/lce-architecture.html
- **每週排程**：`BC compatibility` 比對 BC 程式碼鏡像與掛鉤基準，有差異時開 issue；`Security checks` 執行 `npm audit` 與 CodeQL（PR 另有 dependency review）；Dependabot 更新相依套件。這些都不會擋 PR 或部署。細節見 [自動檢查（CI）](docs/automation.md)。

`loader.user.js` 直接從 Pages 載入 `assets/main.js`。loader 採獨立版本，只有載入機制變更時才手動更新；build / dev 不會跟隨 `package.json` 改寫 loader 的 `@version`。

## 授權

LCE 本體以 **AGPL-3.0** 授權，見 [LICENSE](./LICENSE)。專案整併了 WCE、Themed、Responsive、NotifyPlus 等開源專案的程式碼，各自的授權與著作權聲明見 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)，授權全文置於 [`licenses/`](./licenses/)。
