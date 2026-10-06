# 自動重連與 ChatLog 保護

LCE 的 `src/features/safety/relogin.js` 參考 WCE 的 automatic reconnect 行為，但沒有直接複製其帳號儲存層。

## 重新登入時序

斷線後 `ServerDisconnect` 仍以 priority 6 接手，先把聊天訊息快照下來，再交還 BC 的正常流程；force disconnect 的情況由 LCE 自己控制 `ServerSocket.disconnect()` / `ServerInit()`。

真正的 `LoginDoLogin()` 不應在 `RelogRun` hook 裡等待 WebCrypto。LCE 現在使用 `src/storage/reconnect-credentials.js`：

1. 使用 LCE 登入頁登入時，先把本次登入密碼放入**僅存在記憶體**的 session cache。
2. `installRelogin()` 啟動後，背景預熱目前帳號的加密密碼；`LoginResponse` / socket connect 也會再次預熱。
3. `RelogRun` 優先直接讀 session cache，因此可以同步呼叫 `LoginDoLogin()`。
4. 極少數冷啟動來不及預熱時，背景解密完成後再提交登入，但不會讓 hook 本身 `await` WebCrypto。

持久化帳號仍維持既有 AES-GCM 儲存格式；session cache 不會寫回 localStorage / IndexedDB。

## ChatLog 恢復

BC 的聊天室歷史主要存在 `#TextAreaChatLog` DOM。完整重登可能重建 ChatLog，因此 LCE 在 `ServerDisconnect` 時保存 `ChatMessage` 的 HTML 與輕量識別資訊。

恢復機制不再使用固定單次 `400ms` timer，也不設定 10 秒之類的「等待上線」期限。LCE 不會等待或停止伺服器重連；它只在 `ChatRoomSync`、`LoginStatusReset`、socket `connect` 等生命週期事件發生時嘗試恢復，若新 `TextAreaChatLog` 尚未建立，則暫時保留快照並監看 ChatLog / DOM 建立事件。

- 原本同一個 ChatLog 還有訊息 → 不重播。
- BC 已恢復至少相同數量的訊息 → 不重播。
- 新 ChatLog 只有部分訊息 → 以 `class + data-time/sender/target/msgid/type + text` 做計數式去重，只補缺少的訊息。
- 若伺服器長時間離線，快照不會因此失效；LCE 不會因等待超時而放棄重連。只有成功判定 ChatLog 已保留／補回，或使用者完成新的手動登入流程後，才會清理舊快照。

快照只保存 `.ChatMessage`，不保存 separator 或其他插件 DOM，因此不會把其他插件的 UI 一起重建。

## 為什麼不是只照抄 WCE

WCE 的 automatic reconnect 可以直接從記憶體帳號表同步取得密碼；LCE 的密碼則來自自己的加密帳號庫。若在斷線當下才第一次呼叫 `decryptPassword()`，就會把非同步解密引入 `RelogRun` 的生命週期。LCE 因此把「預熱」與「真正登入」拆開：重連 hot path 只做同步 cache lookup + `LoginDoLogin()`。

此外，WCE 不需要替 LCE 自己的 ChatLog augment 做 DOM 歷史補救；LCE 仍保留 ChatLog snapshot，但把原本固定 400ms 的脆弱假設改成事件驅動的恢復 + dedupe。

## 診斷

可在 console 執行：

```js
Liko.LCE.debugRelogSnapshot()
```

它會顯示是否仍有待恢復快照、快照訊息數、目前 ChatLog 是否存在，以及目前訊息數。
