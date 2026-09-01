# LCE 架構與功能分支圖

互動式架構圖：[開啟 LCE 功能分支圖](./lce-architecture.html)

左側選擇功能，右側顯示「功能 → 模組責任 → 實際檔案」。點擊節點可查看完整路徑。

## 模組邊界

- `loginpage/`：橫式登入、帳號、背景及登入設定。
- `features/`：聊天、社交、主題、沉浸、衣櫃、效能與安全功能。
- `features/vertical/`：直式聊天與房間介面。
- `settings/`：遊戲內設定、容量及信任來源管理。
- `core/`：狀態、儲存、設定 schema、相容層與公開 API。
- `commands/`：LCE 指令入口。

