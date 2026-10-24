# 安全說明

## 已記住密碼的保護程度（刻意維持現狀）

`src/storage/credentials.js` 以 AES-GCM 加密帳號密碼後存進 IndexedDB，但**金鑰（JWK）存放在同一個資料庫**（`mainKey`）。

- 能做到：密碼不以明文出現在儲存區、匯出或備份檔裡。
- 做不到：抵禦能讀取同源儲存區、或能在頁面內執行程式碼的攻擊者——他們能同時取得密文與金鑰。
- 不要把它宣稱成「安全保管密碼」。使用者若在不信任的裝置上，應不要使用「記住密碼」。

### 為什麼不直接改成不可匯出的 CryptoKey

資料庫結構與 MPL 共用，且使用者已記住的密碼是用現有金鑰加密的。直接換金鑰格式會讓所有已記住的密碼解密失敗。

### 若日後要強化（需要整批遷移）

1. 以舊金鑰解出所有帳號密碼（任何一筆失敗都要保留舊資料並中止）。
2. 產生新的不可匯出 `CryptoKey`，重新加密並在單一交易內寫回。
3. 與 MPL 協調新格式與資料庫版本，再移除 JWK。
4. 準備回滾：遷移完成並驗證前不要刪除舊金鑰。

## 遠端程式碼載入

- `loadScript`（`core/i18n-engine.js`）只允許 `https://awdrrawd.github.io` 與 `https://cdn.jsdelivr.net/gh/awdrrawd/`、`/npm/`。
- 信息凍結插件仍由 jsDelivr `@main` 載入（使用者明示開啟才載）。建議改釘 commit 並加 SRI，見待辦。

## 2026-10-23 安全檢查

範圍：`src/` 全部 JS、`package-lock.json`、載入器與 CI。LCE 是瀏覽器端 userscript（JavaScript / Vite），專案內沒有 PHP 或 Java，因此近期的 PHP / Java 漏洞不適用；檢查改以此類專案實際的風險面為主。

- 相依套件：`npm audit` 為 0 個已知漏洞（vite、sass、idb、concurrently、acorn）。
- 危險 API：`src/` 沒有 `eval`、`document.write`、`insertAdjacentHTML`；`innerHTML` 只用來清空或寫入內建的靜態圖示常數；`new Function` 只出現在 `loadScript`（已有來源白名單與測試）。
- 已修正：`pending-messages.js` 把聊天訊息 `Dictionary` 裡的 `lce_nonce` 直接插進 `querySelector`。Dictionary 由房內任何玩家送出、伺服器原樣轉發，惡意內容（例如 `'],#TextAreaChatLog,[x='`）可讓 LCE 移除頁面上任意元素。現在只接受純數字 nonce，並有回歸測試。
- 已修正：聊天室連結 `target="_blank"` 補上 `rel="noopener noreferrer"`，避免把 BC 網址當 Referer 洩漏給外部網站。
- 刻意不處理（維持現狀）：載入器與外掛每次都下載最新版（`import(...?v=<時間>)`、jsDelivr `@main`）。這是專案的更新機制，不列為待修項目。
- 低風險備註：`i18n-engine.js` 的 `_loadJsonLang` 只拿純資料 JSON，沒有套用 `loadScript` 的來源白名單；它不會執行程式碼，但公開的 `Liko.__Sys_i18n__` 若被其他插件呼叫，可讓頁面對任意網址發出 GET。需要時可比照 `_isAllowedScriptUrl` 收斂。

## BC 掛鉤檢查（`npm run check:bc`）

移植自 AEE 的 `check-bc-compat.mjs`，用來提早發現 Bondage Club 改版造成的掛鉤失效。

```sh
# 與已提交的基準（scripts/bc-compat-baseline.json）比對
npm run check:bc -- --bc-dir <BC 原始碼資料夾>
# 確認過 BC 的變動後更新基準
npm run check:bc -- --bc-dir <BC 原始碼資料夾> --update
```

- 以 AST 找出 LCE 所有掛鉤名稱：`hook` / `registerHook` / `patch`、ModSDK 原生 API、`createHook('x')('Name')` 行內形式；`for (const fn of [...]) hook(fn)` 視為「擇一」（例如 `CharacterSetActivePose` / `PoseSetActive`，BC 只會有其中一個）。
- 三項檢查：函式是否還在、函式本體雜湊（與 ModSDK `originalHash` 相同的 CRC32）是否變動、`patchFunction` 的取代字串是否仍在函式本體（不在時 ModSDK 只會警告，功能卻靜默失效）。
- 支援 `var X = new class {…}` 這類單例（例如 `ToastManager._process`）。
- 結束碼：0 = 一致、1 = 有差異、2 = 用法或解析錯誤。
- `.github/workflows/bc-compat.yml` 每週一檢查 BC 程式碼鏡像，有差異時開（或更新）一個 `bc-compat` issue，不會擋 PR 或部署。
- 新增或移除 hook 後請重新 `--update` 基準；`tests/bc-compat.test.mjs` 會檢查基準是否涵蓋目前所有 hook。目前基準：BC R133，106 個函式，無缺漏、無失效的 patch。

## 2026-10-23 追加

- **打招呼欄位驗證**（`src/features/social/hello.js`）：房裡任何玩家都能送 Hidden 的 BCEMsg / LCEMsg。`version` 與 `lce` 現在只接受長度 ≤ 32 的非空字串（否則視為 `0.0`），`capabilities` 只接受字串陣列（最多 32 項、每項 ≤ 64 字）。以前 WCE 分支直接存原值，對方送 `version: 123` 會讓 `character.FBC` 變成數字。測試：`tests/hello-validation.test.mjs`。
- **Node 22**：CI 全面改用 Node 22，`package.json` 的 `engines` 為 `>=22.12.0`（Vite 8 本身要求 `^20.19 || >=22.12`）。Node 20 官方維護已結束。
- **workflow 加固**：所有 workflow 的 checkout 都不保留 token（`persist-credentials: false`），`npm ci` 改為 `--ignore-scripts`，並加上 `timeout-minutes`；Pages 部署改為 `cancel-in-progress: false`，避免新推送中途取消部署。
- **刻意沒改**：`i18n-engine.js` 的 `_loadJsonLang` 仍沒有來源白名單。它只抓純資料 JSON、不執行程式碼；而這個 API 由其他 Liko 外掛共用，收緊白名單可能讓它們放在其他網域的翻譯檔讀不到，需要先確認各外掛的用法。信息凍結插件仍由 jsDelivr `@main` 載入（使用者主動開啟才載入），要釘 commit 並加 SRI 時需連同上游倉庫的發版流程一起改。
