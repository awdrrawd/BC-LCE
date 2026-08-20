// ════════════════════════════════════════════════════════════════════════════
// 雜項行為 hook（讀設定即時生效，無需重載）
//   Enter／數字鍵盤 Enter＝送出（沿用 BC 的按鍵綁定）
//   confirmLeave   ：離開遊戲（關閉/重整分頁）時跳出確認
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

let installed = false;

export function installBehaviors() {
    if (installed) return;
    installed = true;

    // BC 仍負責送出功能的按鍵設定；此處只補齊 Enter 與 NumpadEnter 的等價判定。
    // 使用者改綁成其他按鍵或解除綁定後，不會被這個相容處理覆蓋。
    (function waitHook(n = 240) {
        if (typeof ChatRoomKeyDown !== 'function') {
            if (n <= 0) return;
            setTimeout(() => waitHook(n - 1), 500);
            return;
        }
        modApi.hookFunction('ChatRoomKeyDown', 10, (args, next) => {
            const handled = next(args);
            if (handled) return handled;

            const e = args[0];
            if (!e || e.isComposing || (e.code !== 'Enter' && e.code !== 'NumpadEnter')) return handled;

            const keyManager = globalThis.KeyManager;
            const binding = keyManager?.getKeybinding?.('chat_send_chat');
            const configuredKey = binding?.keyCombo?.key;
            if (configuredKey !== 'Enter' && configuredKey !== 'NumpadEnter') return handled;

            const expectedModifiers = binding.keyCombo.modifiers ?? new Set();
            const actualModifiers = keyManager.getModifiers(e);
            if (expectedModifiers.size !== actualModifiers.size
                || [...expectedModifiers].some((modifier) => !actualModifiers.has(modifier))) return handled;

            const contextsActive = binding.contextIds.every((id) => keyManager.getContext(id)?.prerequisite(e) === true);
            if (!contextsActive) return handled;

            return binding.action(e) || true;
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
