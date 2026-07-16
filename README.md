# Liko - LCE（Liko Club Extensions）

束縛俱樂部（Bondage Club）的橫式登入介面與功能擴充。與 [Liko - MPL](./Liko%20-%20MPL.main.user.js)（直式手機佈局）互補：**LCE 在橫向啟用，MPL 在直向啟用**，帳號 / 頭像 / 密碼儲存雙向共用。

> 目前僅實作**登入介面**，其餘功能後續補上。

## 專案結構

```
src/
  main.js          進入點：重複載入防護、註冊 mod、掛鉤子、初始化
  modsdk.js        內建 bcModSdk 1.2.0（打包進 bundle，不用 @require）
  constants.js     常數（座標、儲存 key、z-index、隱藏清單、圖示、預設設定）
  state.js         共用可變狀態 S + 設定存取
  i18n.js          內嵌字庫（zh-TW / CN / EN）+ 翻譯工具
  util.js          DOM / 環境工具（mk、injectStyle、place、getCanvas…）
  storage.js       AES-GCM 加密 + IndexedDB 快照 + localStorage 帳號（與 MPL 共用 key）
  styles.js        登入頁 CSS 注入
  background.js    滿版背景圖（同時遮住 BC 角色 / 感謝名單 / WCE 存檔按鈕）
  bc.js            隱藏 BC 原生登入 / 第三方元素 + FUSAM 透傳
  accounts-ui.js   帳號區卡片渲染與互動
  settings-ui.js   設定浮層
  login-ui.js      登入 UI 主流程（建構、事件、狀態、定位、啟用/停用、場景偵測）
loader.user.js       正式版載入器（讀 GitHub Pages 的 dist/assets/main.js）
loader.local.user.js 本地開發載入器（讀 http://localhost:5174/assets/main.js）
```

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

## 登入設定

- **登入介面增強**（預設開）：關閉即還原 BC 原生登入
- **顯示頭像 / 顯示帳號 / 顯示名稱**（各自獨立，預設開）
- **背景**：隨機 / 選擇（預設隨機）
