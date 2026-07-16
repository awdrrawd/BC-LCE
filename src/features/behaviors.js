// ════════════════════════════════════════════════════════════════════════════
// 雜項行為 hook（讀設定即時生效，無需重載）
//   數字鍵盤 Enter＝送出（內建，無設定開關），行為與普通 Enter 一致
//   confirmLeave   ：離開遊戲（關閉/重整分頁）時跳出確認
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

let installed = false;

export function installBehaviors() {
    if (installed) return;
    installed = true;

    // 數字 Enter 送出：在 BC 自己的 ChatRoomKeyDown 流程裡處理（跟 WCE 一樣），
    // 這樣與普通 Enter 走同一條路徑、同樣尊重中文（IME）組字狀態。
    //   - 普通 Enter 的 event.key 也是 "Enter"，兩者僅差在 event.code；
    //     BC 依 key 判斷，故普通 Enter 本就正常。這裡只補「數字 Enter」。
    //   - e.isComposing 為真（正在組字，例如注音/拼音尚未上屏）時不送出，
    //     與普通 Enter 一致：第一次 Enter 結束組字、需再按一次才送出。
    //   - 回傳 true 表示已處理、消費此事件，避免 BC 原生流程重覆送出。
    (function waitHook(n = 240) {
        if (typeof ChatRoomKeyDown !== 'function') {
            if (n <= 0) return;
            setTimeout(() => waitHook(n - 1), 500);
            return;
        }
        modApi.hookFunction('ChatRoomKeyDown', 10, (args, next) => {
            const e = args[0];
            if (e && e.code === 'NumpadEnter' && !e.shiftKey && !e.isComposing) {
                const input = document.getElementById('InputChat');
                if (input && document.activeElement === input) {
                    if (typeof ChatRoomSendChat === 'function') ChatRoomSendChat();
                    return true;
                }
            }
            return next(args);
        });
    })();

    // 離開確認
    window.addEventListener('beforeunload', (e) => {
        if (!getFeature('confirmLeave')) return;
        if (typeof Player === 'undefined' || !Player?.AccountName) return;
        e.preventDefault();
        e.returnValue = '';
        return '';
    });
}
