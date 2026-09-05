# LCE 架構與功能分支圖

互動式架構圖：[開啟 LCE 功能分支圖](./lce-architecture.html)

左側選擇功能，右側顯示「功能 → 模組責任 → 實際檔案」。點擊節點可查看完整路徑。

## 資料夾配置

```text
src/
├─ app.js / main.js       組裝與載入入口
├─ assets/               自有圖示
├─ commands/             指令入口
├─ core/                 設定、相容、API 與基礎工具
├─ game/                 BC 呼叫適配
├─ storage/              資料庫、帳號、憑證與桌布
├─ loginpage/            登入頁與登入狀態
├─ settings/             設定頁、選擇器與管理介面
├─ ui/
│  ├─ chat/              通知、標記與增量監聽
│  └─ transition.js      動畫完成與取消
└─ features/
   ├─ chat/              聊天功能
   ├─ social/            好友、Profile、歡迎與徽章
   ├─ messenger/         IM 入口、編解碼與歷史
   ├─ theme/             染色、字型、圖示政策與 styles/
   ├─ expressions/       引擎、資料表、計算及相關表情功能
   ├─ wardrobe/          衣櫃與圖層
   ├─ performance/       效能入口與三個子系統
   ├─ safety/            重連、作弊控制與安全詞
   ├─ vertical/          直式版面
   └─ *.js               尚無需另立資料夾的獨立功能
```

功能入口使用該資料夾的 `index.js`；資料夾整理不代表再拆分函式。路徑搬移對照見 [file-moves.json](./file-moves.json)，歷史審查文件中的原路徑可依此查找。

## 模組邊界

- `loginpage/`：橫式登入、帳號、背景及登入設定。
- `features/`：聊天、社交、主題、沉浸、衣櫃、效能與安全功能。
- `features/performance/`：聊天容量、貼圖快取、幀率與 FPS 三個子模組，各自管理 hooks 與狀態。
- `features/vertical/`：直式聊天與房間介面。
- `settings/`：遊戲內設定、容量及信任來源管理。
- `core/`：設定 schema／驗證與更新交易、hook／生命週期工具、相容層與公開 API。舊 `state.js`、`storage.js` 保留轉匯出相容入口。
- `storage/`：資料庫連線、帳號資料、加密憑證、桌布；寫入成功以交易完成為準。
- `game/`：遊戲語言、動作訊息、房間導覽等 BC 呼叫適配。`room-search.js` 共用原生區域讀寫、性別限制與搜尋呼叫；橫式／直式介面各自負責呈現。
- `ui/`：本地聊天通知、文字節點標記與共用聊天增量監聽。`chat-pipeline.js` 擁有容器 observer 與處理器訂閱；各功能保留自己的啟用條件和冪等標記，不承擔指令註冊。
- `assets/icons.js`：自有內嵌 SVG；圖像染色政策位於 `features/theme/image-policy.js`。
- `commands/`：LCE 指令入口。

登入狀態與頭像擷取由 `loginpage/state.js`、`loginpage/profile-capture.js` 擁有。設定選擇器位於 `settings/pickers.js`，主題操作位於 `settings/theme-actions.js`；設定頁與 API 均透過 `setFeature`／`updateSettings` 更新，批次事件的 `changes` 包含整筆交易，預覽可延後保存。IM 歷史讀取由 `features/messenger/history.js` 共用同一個載入 Promise；`codec.js` 管理通訊格式與輸入簡寫，單則訊息呈現回到主模組的區域函式。主模組負責對話狀態、未讀、捲動及 BC hooks。

## 驗證

執行 `npm test` 與 `npm run build`。測試以 Node VM 載入實際模組，模擬 BC、DOM、socket 和 IndexedDB，涵蓋設定交易、非同步競態、信任來源、hook 還原與卸載；不能取代實際 BC 和其他插件並存時的介面驗收。Pages 工作流程會先測試再建置。

詳細問題與實施狀態見 [程式碼檢視報告](./code-review-2026-09-05.md)。互動圖已更新為目前的責任分組與主要事件流程，不代表完整 import 關係。未完工作以 [未完工作與驗收](./unfinished-work.md) 為準。

本輪收斂：表情事件準備、時間與衝突計算集中於 `features/expressions/calculations.js`；schema 觸發的遊戲操作集中於 `game/setting-effects.js`。IM 收訊先排隊，歷史讀取失敗時不覆寫資料，下次收訊或開啟視窗重試。設定操作的布林結果表示本次本機套用與保存是否成功，不代表伺服器已確認持久化。
