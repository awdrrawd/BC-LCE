# ExtensionSettings 與 AccountUpdate 處理說明

## 背景

Bondage Club 登入後，`Player.ExtensionSettings` 包含伺服器剛下發的各插件設定。這份資料已經存在伺服器，不需要在遊戲初始化時再以下列形式原樣寫回：

```js
ServerAccountUpdate.QueueData({
    ExtensionSettings: Player.ExtensionSettings,
});
```

整包回傳並不能提供有意義的插件註冊或安全驗證，反而會把所有插件的資料集中在同一則 `AccountUpdate` 中。當多個大型插件同時存在時，單則訊息可能超過 180K 上限，導致訊息被拒絕或產生巨大訊息錯誤。

## LCE 的處理原則

LCE 在 `ServerSend` 真正送出前檢查 `AccountUpdate`。若訊息含有頂層 `ExtensionSettings` 欄位，LCE 會：

1. 從訊息中移除整包 `ExtensionSettings`。
2. 保留並送出同封 `AccountUpdate` 的其他欄位。
3. 若訊息只含有 `ExtensionSettings`，則取消該則不必要的請求。
4. 不檢查整包大小，不將其拆批，也不替所有插件重新同步設定。

這個規則不需要猜測當前是否仍在登入初始化階段。整包 `ExtensionSettings` 無論在哪個階段都不應作為寫入方式；將它移除可以同時處理初始化回傳與插件誤用 API 兩種情況。

## 插件的正確寫入方式

插件實際修改自己的設定後，應只同步自己所屬的鍵：

```js
Player.ExtensionSettings.MyPlugin = serializedSettings;
ServerPlayerExtensionSettingsSync("MyPlugin");
```

這會使用 `ExtensionSettings.MyPlugin` 這類 dot-notation 單鍵更新，不會將其他插件的資料塞進同一則訊息，也不會覆蓋整個 `ExtensionSettings` 物件。

資料遷移也應遵守相同規則。只有實際發生變更的插件鍵需要同步，不應因為登入或初始化而重送全部已有設定。

## 180K 單鍵上限

LCE 不拆分單一插件的設定值。若 `ExtensionSettings.MyPlugin` 本身已超過單則請求上限，這是該插件的資料設計問題。插件應自行採取壓縮、刪減、分鍵或其他儲存方式；LCE 不會在傳輸層自動切割其內容，以免改變插件的資料格式與寫入語意。

## 舊處理方式與調整理由

舊版 LCE 只在整封 `AccountUpdate` 超過 180K 時才移除 `ExtensionSettings`，並把其內每個插件鍵重新組成多則 dot-notation 請求送出。

此做法已移除，原因如下：

- 登入時的資料來自伺服器，沒有全部重送的必要。
- 自動重送會把一個不必要的整包請求轉成多個實際寫入。
- LCE 無法判斷哪些鍵真正發生變更，因此不應替所有插件補送。
- 單一大鍵仍可能超過限制，自動分批並不能完整解決問題。
- 統一移除整包欄位的規則比依賴訊息大小更可預測，也不會改變其他 `AccountUpdate` 欄位的行為。
