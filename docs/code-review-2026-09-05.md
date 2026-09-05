# LCE 程式結構與呼叫流程審查

日期：2026-09-05。範圍：BC-LCE 工作目錄，不包含另一個 WCE-beta 專案的全面審查。

## 收斂與測試交付

停止新增細粒度拆分。表情計算合併至 calculations.js，遊戲設定副作用合併至 setting-effects.js，IM 單則 view 回到控制模組。以下歷次紀錄中的舊檔名保留作為歷史。

已修正：IM 收訊入口先於資料庫等待、讀取失敗禁止覆寫並保留排隊訊息、設定保存／動作失敗回報、原地修改聊天文字的重新處理、低優先權姿勢衝突漏判。IM 的持續性儲存故障仍需使用者處理；重试由下一次訊息或開啟視窗觸發，不無限背景重試。設定同步目前無伺服器確認協定，不宣稱已獲遠端保存確認。

等待使用者實際測試登入／重連、IM、設定與直式介面後再 commit；未部署。

## 本輪實施狀態

下文保留重構前的審查與原始行號，不能視為目前仍存在的問題清單。

- 已統一設定 UI／API 的驗證、預覽、批次更新、事件與保存管道，修正登入資料載入前的覆寫風險、主題 API 副作用與 past-profiles 從關閉再啟用的流程。
- 已抽離登入狀態、資料庫／憑證／帳號／桌布、頭像擷取、設定選擇器、通知、聊天標記、動作訊息、語言與房間導覽；舊入口保留相容轉匯出。
- 已共用 JSON 解析、hook 註冊、socket 綁定與生命週期工具，直式介面卸載可取消延遲工作；非同步安裝失敗有統一錯誤處理。
- 已修正聊天節點處理、重連後互動、圖片信任與音樂信任的邊界、IM 歷史載入競態、繪製暫時狀態還原、桌布過期讀取與金鑰交易完成契約。
- SVG 保留 inline／URL 既有形式，自有 inline 圖示集中於 `assets/icons.js` 並補裝飾語意；染色政策独立並正規化本地路徑。
- 已抽出搜尋區域共用適配，橫式切換改讀 BC 當前狀態，避免直式先切換後仍使用舊偏好；共用男性角色限制、離頁防護與非同步搜尋錯誤處理。
- 已將指令按鈕與連結嵌入改用共用聊天 MutationObserver；500ms tick 僅檢查容器／開關，初始、重新啟用及容器替換才補掃。pending 訊息移除狀態後再處理，避免提前標記完成。
- IM 的 codec 與單則訊息 view 已抽離，收發與歷史還原共用編解碼，保留 BcUtil／WCE wire format；異常 metadata 使用預設類型／顏色。
- schema 的主題操作已移到 `settings/theme-actions.js`，以注入 schema 讀取器避免反向 import；表情與衣櫃副作用位於 game 適配模組。主題還原只接受指定鍵，異常快照由設定交易整筆拒絕。
- 效能模組拆為 `performance/chat-capacity.js`、`textures.js`、`frames.js`，各自持有狀態與安裝旗標；入口保留 `doClearCaches` 相容 API。聊天容量 observer 仍獨立於文字加工，避免耦合刪除與呈現。
- 直式房間卡片、標籤與詳情面板抽到 `vertical/room-view.js`；加入房間共用 game 適配，點擊當下取得原生按鈕，避免搜尋刷新後保留舊 DOM。搜尋／分頁與手勢狀態仍由 chatsearch 管理。
- 直式按鈕與手勢翻頁共用動畫提交，篩選 track 的 transform 事件並加入逾時完成；清單刷新、容器重建和卸載會取消舊回呼，避免永久鎖定或過期翻頁。
- 表情事件準備抽到 `expressions/event.js`，以注入時間與 ID 來源測試模板隔離、雙眼同步、持續時間及優先權；逐幀仲裁與 BC 寫入仍待進一步拆分。
- 表情／姿勢共用 `expressions/timeline.js` 的步驟選擇，保留零時長跳過、負時長常駐與到期邊界；同一輪仲裁使用同一時間點。
- 姿勢衝突解析抽到 `expressions/pose-conflicts.js`，保留優先權與同級 ID 選擇順序，回傳獨立選擇物件；全身／上下半身衝突已有測試。
- 已新增 32 項 Node VM 回歸測試與 Pages 建置前測試步驟；Vite 建置通過。測試使用模擬 BC／DOM／IndexedDB，實際遊戲、手機操作及 WCE／Responsive／PCM 並存驗收尚未執行。

仍待後續：IM 對話狀態與整體 view 的進一步拆分、表情／直式大型模組拆分，以及 chunk hash 與部署舊資產保留策略。本輪不更動儲存格式或引入新框架。

## 結論

值得調整，優先順序是：修正有行為差異的共用流程 → 確立服務與功能邊界 → 拆分多職責模組 → 整理圖示與樣式。

SVG 並不是目前主要複雜度來源。主要問題是同一件事由不同入口各自實作，且狀態透過 BC 全域、DOM 標記、設定事件和 socket 回呼交錯傳遞。單純切成更多檔案，不會解決這些問題。

檢查方式與限制：

- 建立 `src/` 全部 67 個 JavaScript 檔案的靜態引用圖，合計約 15,682 行，包含註解及內嵌 SDK。檢查入口、設定、儲存、登入、功能、樣式及建置配置，針對跨模組呼叫與異常路徑深入閱讀。
- 靜態 import 掃描未發現循環相依。這不代表事件、全域函式 patch 或 socket 回呼沒有循環呼叫風險。
- 以 Node VM 搭配模擬 BC/DOM 介面，重現本文標示的設定、來源信任、HTML 字串生成、IM 競態、全域狀態還原與非同步初始化問題。未在正式聊天室執行測試，HTML 測試只確認不安全屬性被產生，未執行注入的事件程式。
- 執行 `node node_modules/vite/bin/vite.js build` 成功，126 個模組完成轉換。使用本地既有 assets，沒有重新抓取遠端素材。這不是實際遊戲、多插件共存或手機操作的完整驗收。
- 本輪沒有修改執行程式碼；重新建置後，git status 僅列出此新增報告。

## 一、優先修正的行為問題

### 1. [P1] 聊天房間標記使用 innerHTML 字串替換，會把文字變成 HTML 屬性

位置：`src/features/chat.js:299` 的 `processMessage()`，尤其第 313 行的房間標記替換；第 259 行 `showDesc()` 也會把房間文字當成 HTML。

目前從 `element.innerHTML` 取內容，再將 `#房間名稱#` 裡的名稱插入 `data-room="..."`。聊天文字裡的雙引號不必然在 innerHTML 中被編碼，因此可以終止屬性，產生額外事件屬性。以無害的 `void(0)` 測試，已確認原函式會產生額外 `onmouseover` 屬性。即使原訊息本來安全地以文字節點呈現，這次重新解析仍會使它變成 HTML。

建議：只走訪文字節點，先辨識 token，再以 `createElement`、`textContent`、`dataset.room` 建立節點。提示文字也採文字節點，換行使用 `<br>` 節點。不要對整段既有 innerHTML 做正規表示式替換。

這項應先修正，再把解析器移到共用的富文字模組。

### 2. [P1] 暫時替換 BC 狀態缺少 finally，異常會留下錯誤狀態

位置：

- `src/features/wardrobe.js:154`：`WardrobeRun` 暫時將全域 `Player` 換成另一角色。
- `src/features/char-talk.js:149`：繪製時暫時修改 `mouth.Property.Expression`。
- `src/features/badges.js:45`：繪製徽章時暫時刪除 `C.FBC`。

這些地方都是修改 → `next(args)` → 還原。若 BC 或另一個插件的下游 hook 丟例外，還原不會執行。VM 已重現 `WardrobeRun` 出錯後全域 Player 仍指向另一角色。衣櫃流程還會直接覆寫目標角色的 `VisualSettings`、`Canvas`、`CanvasBlink`，也需要盤點哪些是暫時值。

建議：用 `try/finally` 還原；保存欄位是否原本存在，避免把「不存在」還原成「值為 undefined 的自有屬性」。可参考 `profile.js` 的 `fakeViewButtons()` / `restoreViewButtons()` 模式。先修各處，不必立即做一個處理任意物件的複雜抽象。

### 3. [P2] 設定修改有兩條管道，主題與字型已出現行為分歧

位置：`src/core/feature-settings.js:260`、`src/settings/settings-page.js:229`、`src/features/theme.js:88`、`src/features/theme-font.js:247`。

目前：

- API/登入頁：`setFeature()` → 修改值 → 副作用 → 事件 → 立即存檔。
- 遊戲設定頁：直接寫 `fSettings` → `fireSideEffect()` → 事件；離開設定頁才存檔。
- 主題重新套用：另外放在設定頁的 click / color picker 回呼裡。

具體差異：

1. `setFeature('themeEnabled', ...)` 或修改主題顏色只更新設定及發事件；`theme.js` 沒有監聽這個事件。CSS/patch 不會像設定頁操作一樣更新，可能留下半套主題狀態。
2. 設定頁勾選 `themeFontEnabled` 時，事件 key 是本體 `themeFont`；公開 API 發出的卻是 `themeFontEnabled`。字型模組只接受本體 key，因此 API 切換字型啟用狀態不會即時套用。
3. `setFeature()` 的衍生鍵判斷將 `withToggle` / `withSound` 混在一起。已重現只有 withToggle 的 `textureQuality` 也接受不存在的 `textureQualitySound`。
4. 寫入入口沒有統一驗證型別、select 選項和 bar 範圍。已重現 `scrollMaxMessages=-999` 被原樣存入；部分消費者自行 clamp，掩蓋了來源不一致。

建議新增單一設定修改管道：

`UI / command / public API → resolveSettingKey → normalizeValue → updateSettings → effects / changed event → persist`

事件同時保留實際修改的 `key` 和 `ownerKey`，批次操作提供完整 `changes`。主題模組自行監聽相關變更，UI 不負責套用主題。滑桿的記憶體預覽和最後存檔分開，避免每一幀同步伺服器。主題快照載入、還原預設等 action 也應走批次修改，而不是直接改傳入物件。

### 4. [P2] 永久信任與單次信任的判斷分散，已造成永久允許仍被阻擋

位置：`src/features/misc.js:98`、`src/features/chat-augments.js:57`、`src/features/trusted-domains.js:28`、`src/app.js:59`。

房間自訂內容流程詢問前使用 `isOriginTrusted()`，但真正放行時只看 `sessionCustomOrigins`。所以永久允許的圖片來源，在重新整理後 session Map 為空時，不會再詢問，也不會放行。VM 已重現這個情境。

聊天嵌圖與公開 API 則各自又寫了一套「永久或 session 允許」的判斷。

建議把 `getTrustDecision(origin, contentType)` / `isTrusted()` 放進來源信任服務，由聊天、房間自訂内容與公開 API 共用。圖片永久信任、音樂單次允許的既有差異應保留為明確政策。

另需定義「從管理器刪除永久來源」是否也撤銷當次允許：現在 `removeTrustedOrigin()` 不清 session Map，而新增永久来源會同時寫 session。這是語意需要明確化的地方，不應擅自把所有移除永久信任都等同當次拒絕。

### 5. [P2] IM 首次讀取歷史沒有共用載入中的 Promise

位置：`src/features/instant-messenger.js:280`，呼叫端在第 397、411、432 行。

`loadIM()` 一進去就將 `loaded=true`，然後才 await IndexedDB。第二則訊息在讀取未完成時到達，會看到 loaded 已經為真而直接追加訊息；第一個載入完成後，`friend.historyRaw = fh.historyRaw` 又以舊資料覆蓋它。已用受控的延遲讀取重現新訊息從記憶體歷史消失的情況。

建議：使用 `historyLoadPromise` 去重所有載入請求，成功完成後才標記 loaded。收訊、送訊與開啟視窗都經過同一個 `ensureHistoryLoaded()`。把歷史模型/資料庫和 DOM 呈現分開，才能針對並行訊息做精確測試。

### 6. [P2] 初始化與卸載沒有一致契約

位置：`src/app.js:87`、`src/features/past-profiles.js:354`、`src/features/vertical/index.js:151`。

- `safe()` 只捕捉同步 throw，忽略 installer 回傳的 Promise。`installPastProfiles()` / `installInstantMessenger()` 都是 async；原本聲稱的逐步初始化及失敗紀錄，並不涵蓋它們 await 後的執行。已驗證 rejected Promise 不會進入 safe 的警告處理。
- `installPastProfiles()` 在功能關閉時直接 return，卻沒有設定事件讓之後的啟用安裝它；初始關閉後在同一分頁開啟，不會建立功能。
- `uninstallVertical()` 只移除畫面與樣式，保留 DrawProcess hook、事件與 installed 旗標。設定仍開啟時，下一幀 `checkScene()` 可以再次套用直式介面，因此它不是完整卸載。
- 多個模組自行在 ServerInit 後重新 `.on()` socket 事件，没有共同記錄綁定的 socket 與 `.off()` 清理。在 socket 是否替換尚未確認前，不能斷言每次重連都重複通知，但管理方式確實不一致。

建議：區分 `install`、`enable/disable`、`dispose`、`ready`。先以登入頁既有的 unhooks 清理模式為基礎，提供管理 hook、DOM listener、timer、observer 的小型 scope。Socket 綁定另提供保存目標與回呼引用的 helper。

初始化入口須接住 async 結果；有順序依賴的安裝才依序 await。無限等待登入/進房的 readiness 不宜直接放進阻塞全體模組的序列。

### 7. [P2] 重連以 HTML 還原聊天，保留已綁定標記卻遺失事件

位置：`src/features/relogin.js:35`、第 67 行，以及 `src/features/chat.js:279`、第 300 行。

聊天快照存的是 `innerHTML`。回復出來的節點保留 `data-bound`、`data-lce-done` 等標記，但原本用 `addEventListener` / onclick 屬性掛上的函式不會由 HTML 還原。掃描器又因完成標記而跳過，房間按鈕、指令按鈕及部分本地通知控制項會失去互動。

建議先將 LCE 的互動改為容器事件委派，或明確提供還原後的 hydrate 階段與版本化標記。不要只刪除標記後再次對整段 HTML 替換，否則可能重複包裝。第三方插件節點的回呼恢復不在 LCE 能保證的範圍內。

## 二、適合收束的重複函式

| 現有位置 | 重合內容 | 建議歸屬與邊界 |
| --- | --- | --- |
| `chat.js:65`、`cheats.js:29` | `sendActionText()` 的封包格式與實作相同 | 共用 `game/chat-actions.js`；保持它是對外發送動作，與本地通知分開 |
| `commander.js:25`；由 welcome / cheats / past-profiles 引用 | `lceChatNotify()` 實際是共用通知呈現，不是指令解析 | `ui/chat-notification.js`；原 export 可暫時轉匯出以保持相容 |
| feature-settings / commander / IM / past-profiles / wardrobe / layering-hide | 6 份 `parseJSON()`，相同空字串/失敗回 null 行為 | `core/serialization.js` 的小型 parse helper；每個資料領域仍自己驗證結構與壓縮格式 |
| 16 份具名 `hook()`，另外還有區域 hook 包裝 | ModSDK hook 登記及錯誤訊息 | `core/hooks.js`，提供模組名稱、回收函式；relogin/past-profiles 的動態 gate 必須保留，不能粗暴換成無條件 hook |
| `settings-schema.js:122/150`、`login-ui.js:183/297` | 語言清單、當前語言、BC 切換後重載字典 | `game/language.js`；登入頁保留派送 BC 原生 dropdown 事件的適配層 |
| `vertical/chatsearch.js:35/53`、`region-switch.js:35/89` | 搜尋區域讀取、更新、觸發查詢 | `game/room-search.js`；統一男性角色限制、來源正本、查詢字串及圖示狀態 |
| `chat.js:268`、`commander.js:106` | 加入房間，但離開/清除回房狀態/錯誤處理不同 | `game/room-navigation.js`；提供保留限制與指令強制跳轉等明確選項，先保留兩入口原本語意 |
| 多個 UI 的建立 style 程式 | style ID 去重、注入 | 沿用 `core/util.js` 已有 `injectStyle/removeStyle`；需要只注入一次的地方保留 once 語意 |

應避免的收束：不同資料庫因共用 helper 就合併資料庫；本地通知與伺服器訊息合成一個容易混用的 send；動畫 tick 與登入輪詢強行共用單一 timer；看到同名 `cleanup()` 就當作重複功能。

## 三、模組邊界與函式放置

### 應先修正的依賴方向

1. `features/welcome.js`、`features/cheats.js`、`features/past-profiles.js` 只為了通知而 import `commands/commander.js`。這會把指令、診斷和主題測試等不相關依賴也納入同一條依賴鏈。應將通知往共用 UI 層移動。
2. `core/state.js` 的 S 幾乎全是登入 UI 狀態，如 stageEl、selectedIdx、settingsOpen；其 readRoot 又被全域設定服務使用。應拆成登入頁狀態與全域設定根儲存服務，避免基礎設定依賴登入畫面狀態初始化。
3. `core/storage.js` 同時負責資料庫、密碼加解密、帳號清單、桌布、BC Canvas 頭像與重試排程。將 capture/schedule 移到登入帳號快照服務，帳號與桌布提供各自 repository，IndexedDB 共用技術層即可。
4. `core/settings-schema.js` 應以定義、預設與驗證為主；遊戲語言重載、Player 慾望副作用、主題快照 action 屬於功能服務。先以 effects/action registry 接上，不要直接讓 schema import 所有 feature，否則容易真正引入循環。
5. `features/misc.js` 的 AccountUpdate 防護是跨插件傳輸政策；房間自訂來源是信任檢查；新帳號過濾是社交功能。三者不應長期藏在同一個「雜項」入口。拆移時保持現有傳輸政策，不因整理結構改變其作用範圍。
6. `core/theme-api.js` 是主題的對外 facade，依賴 `features/theme-colors.js`；移到 theme 領域並由 app 組裝，比將它當成通用 core 更清楚。這是邊界改善，不是單凭 import 方向就判定為錯誤。

### 大模組的實際拆分點

| 現有模組 | 建議責任拆分 | 優先度 |
| --- | --- | --- |
| `settings/settings-page.js` | 頁面導覽/生命週期、canvas controls、字型/語言/color picker；修改值统一走設定服務 | 高 |
| `features/chat.js` | 訊息標記解析、輸入歷史、姿勢選單、時區顯示 | 高 |
| `features/chat-augments.js` | 共用文字/網址呈現、信任政策呼叫、聊天室掃描適配 | 高 |
| `features/instant-messenger.js` | 訊息 model/codec、history repository、view、BC hooks | 高 |
| `features/theme.js` | canvas draw hooks、HTML image hooks、BC source patches、style application | 中 |
| `features/performance.js` | chat capacity、texture/cache、frame limiter、FPS overlay | 中 |
| `features/vertical/chatsearch.js` | ChatSelect、搜尋 shell、room card/info、分頁手勢、樣式 | 中 |
| `features/vertical/chatroom.js` | 聊天版面、手機輸入代理、dialog mirror/click mapping | 中 |
| `features/expressions.js` | 事件正規化/queue、優先權與時間計算、BC 寫入與廣播、活動適配、hooks | 中，待核心狀態測試到位 |
| `features/past-profiles.js` | profile/notes repository、歷史 UI、WPS protocol | 中 |
| `commands/commander.js` | 命令註冊/dispatch、versions 查詢、外觀匯入匯出、診斷 | 中 |
| `loginpage/login-ui.js` | DOM 組裝、登入提交、設定事件、layout/scene controller | 中 |

拆分目標是每個模組有清楚的狀態擁有者，而不是限制每份檔案行數。`expressions-data.js` 已將資料表分開，是合理的既有設計；大型資料檔或純樣式檔不因行數多就必須再拆。

建議的依賴方向：入口 app 組裝 → feature / command / page → game adapters、UI 元件、領域服務 → 無副作用的共用工具。不要把所有共用函式都塞回 `util.js`。

## 四、SVG 是否需要改用其他方式

目前自有 SVG 是 1 個檔案與 2 個內嵌常數，沒有大量重複 SVG 元件或既有龐大圖示系統。

| 類型 | 目前位置 | 判斷 |
| --- | --- | --- |
| 登入帳號/鎖圖示 | `core/constants.js:101`，inline SVG、`stroke=currentColor` | 保留 inline SVG；移到 `assets/icons/` 以 raw import 或小型 icons 模組管理。這個用量不需要 icon library 或 sprite。補上裝飾圖示的 aria-hidden 語意 |
| 設定入口 LCE 圖示 | `assets/lce-icon.svg`，`settings-page.js:15` URL import | 保留 SVG URL，符合 BC 接收圖片來源的介面。只有要求完全固定字形時才考慮將 `<text>LCE</text>` 轉 path；不是必要重構 |
| BC 圖示染色 | `features/theme.js:110` 之後 | 應整理來源正規化與可染色政策，不是全部轉 SVG。Canvas 路徑與 HTML 圖片路徑仍各自適配 |
| 外部聊天 SVG | `features/chat-augments.js:55/99` | 保持圖片 URL 經 `<img>` 顯示的邊界；不要為了改色而抓取外部 SVG，再塞進 innerHTML |

圖示染色的一個具體問題：`canColorize()` 對前綴排除處理了 `./`，對檔案排除卻直接 `files.has(src)`。例如 `Icons/Female.svg` 與 `./Icons/Female.svg` 可能得到不同結果。先正規化本地 asset 路徑，再比對同一套 catalog；完整外部 URL、data URL 與本地資產要保持可區分。

若未來需要大量單色 DOM 圖示，可用 CSS mask + currentColor；但現在為三個圖示改造整套渲染流程，收益很低。自有圖示和 BC 圖片也不需要强行採同一種 API。

## 五、其他值得安排的調整

- **聊天處理只處理增量**：`chat.js` 與 `chat-augments.js` 各每 500ms 掃描聊天。可共用針對新增訊息的 observer / pipeline，初次安裝和換房補掃一次；每個 processor 保持順序與冪等。`performance.js` 已有聊天 observer，不要不加區分地將容量管理與文字改寫混成一個函式。
- **IndexedDB 完成契約**：`core/storage.js` 寫入以 request 的 onsuccess 回報完成；密鑰儲存失敗還會 resolve(false) 後繼續使用新 key。應以 transaction 完成作為成功，寫入密鑰失敗須向呼叫端回報，避免持有無法持久化的 key 卻繼續保存密文。專案已有 `idb` 可共用，但需保留 MPL 共用資料庫的名稱、版本與格式。
- **背景非同步生命週期**：`background.js` 有 videoToken，uploaded wallpaper 的 await 沒有相同的請求代號。快速從上傳桌布改到其他模式時，舊讀取可能稍後覆蓋新選擇。新增 apply token 與 dispose，登入頁銷毀時也明確回收桌布 object URL。
- **JS chunk 版本一致性**：`vite.config.js` 將 entry 與 chunk 都固定命名，loader 只對 main.js 加時間戳；建置後 main.js 仍引用固定 app.js。存在入口更新、內部 chunk 仍命中舊快取的風險，實際情況取決於 CDN/browser cache。建議 entry 維持固定入口、chunk 使用內容 hash；發布時一起處理舊入口仍可能引用舊 chunk 的保留策略。
- **註解與實作對齊**：settings-schema 仍有 enhance 舊設定歸屬說明，以及「信息凍結關閉才 teardown」註解；chat-scroll-freeze.js 明確寫的是關閉不 teardown，因為實體與其他插件共用。以現行已確認語意更新註解，不應照舊註解改壞程式。
- **來源副本與生成物**：`modsdk.js`、`i18n-engine.js`、responsive 相容層與 loader 副本要標明來源/同步方法。不要在重構時任意格式化 vendored SDK；loader 根目錄與 public 副本可由單一來源產生。

## 六、建議實施順序與驗收

1. **行為修正**：HTML 節點生成、暫時狀態 finally、來源信任、IM 載入 Promise。每項獨立修正並驗證原情境。
2. **統一設定管道**：定義 key / ownerKey / changes，涵蓋 toggle、sound、bar、color、批次主題 action。驗證 UI 與 API 修改得到相同副作用；滑桿結束才 commit。
3. **抽離已證實共用的服務**：通知、動作訊息、JSON parse、語言、搜尋區域、房間導覽。先保留原 export facade，降低 import 路徑一次改動的規模。
4. **生命週期**：統一安裝結果、取消/清理和 socket ownership；驗證關閉後啟用、卸載後下一幀、socket 重用及替換兩種情境。
5. **拆大模組與圖示整理**：最後再拆 expression/performance/vertical 等領域；保留既有 hook 優先權、相容欄位、storage key 和格式。

必要驗收場景：長時間停在登入頁後登入、設定 UI/API 等價、IM 讀取中連續收訊、重連後聊天互動、直橫向切換與停用、WCE/Responsive/PCM 存在與缺席，以及異常 hook 後 BC 全域狀態仍正確。

不建議在第一輪加入大型框架、全面改 TypeScript、重寫 ModSDK 或建立泛用插件容器。先把已出現分歧的呼叫流程收斂，才會真正降低之後改功能的成本。
