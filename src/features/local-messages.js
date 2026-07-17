// ════════════════════════════════════════════════════════════════════════════
// 本地訊息 —— 沒有設定，一律啟用
//
//   1. LCE 自己的本地訊息統一樣式：淡紫底色 + 黑字。
//      只染 LCE 的訊息，不動 BC / BCX / 其他插件的本地訊息。
//   2. BCX 指令教學只顯示一次。
//
// 都掛在 ChatRoomAppendChat 上，因為那是所有聊天訊息真正進 DOM 的唯一入口：
// BCX 有自己的 ChatRoomSendLocal（見其 src/utilsClub.ts），不走 BC 的全域函式，
// 所以 hook BC 的 ChatRoomSendLocal 攔不到它 —— 但它最後仍呼叫 ChatRoomAppendChat。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature, setFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';
const STYLE_ID = 'lce-local-msg-style';

// BCX 教學訊息的開頭（見 BCX src/modules/commands.ts 的 CommandsShowFirstTimeHelp）
const BCX_TUTORIAL_PREFIX = '[ BCX commands tutorial ]';

/** LCE 本地訊息的標記類別：由 lceChatNotify 直接掛在訊息 div 上，或包在送出的內容裡。 */
export const LOCAL_MARKER = 'lce-local';

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // 兩種來源：
    //   .ChatMessage.lce-local            —— 我們自己建 div 再 append（lceChatNotify）
    //   .ChatMessageLocalMessage:has(...) —— 經 BC 的 ChatRoomSendLocal，div 是 BC 建的，
    //                                        只能靠內容裡的標記元素認出來
    // 底色要夠不透明，黑字才讀得清楚（聊天區底色會隨主題變深或變淺）。
    s.textContent = `
        .ChatMessage.${LOCAL_MARKER},
        .ChatMessage.ChatMessageLocalMessage:has(> .${LOCAL_MARKER}) {
            background: #ba9eff !important;
            color: #000 !important;
        }
        .ChatMessage.${LOCAL_MARKER} a,
        .ChatMessage.ChatMessageLocalMessage:has(> .${LOCAL_MARKER}) a {
            color: #4b0082 !important;
        }

        /* 指令面板（/lce、/lcesetlist）的可點文字。
           不畫按鈕外框 —— 跟 beep 連結一樣用染色文字表示可點，融進聊天訊息裡。 */
        .ChatMessage .lce-cmd-btn {
            display: inline;
            margin: 0;
            padding: 0;
            border: none;
            background: none;
            color: #4b0082;
            font: inherit;
            font-weight: bold;
            line-height: inherit;
            text-align: left;
            cursor: pointer;
        }
        .ChatMessage .lce-cmd-btn:hover { text-decoration: underline; }
        .ChatMessage .lce-del-btn { color: #a00; }
        .ChatMessage .lce-help-row,
        .ChatMessage .lce-setlist-row { margin: 2px 0; }
        .ChatMessage .lce-confirm-bar { margin-top: 4px; }
    `;
    document.head.appendChild(s);
}

let installed = false;

export function installLocalMessages() {
    if (installed) return;
    installed = true;

    injectStyle();

    try {
        modApi.hookFunction('ChatRoomAppendChat', 10, (args, next) => {
            try {
                const [div] = args;
                // BCX 先 div.innerText = msg 才 append，所以這時 textContent 已經有內容
                if (div?.textContent?.startsWith(BCX_TUTORIAL_PREFIX)) {
                    if (getFeature('bcxTutorialSeen')) return null;   // 看過了，不再顯示
                    setFeature('bcxTutorialSeen', true);
                }
            } catch { /* 認不出來就當一般訊息放行 */ }
            return next(args);
        });
    } catch (e) {
        console.warn(LOG, 'ChatRoomAppendChat hook 未掛上:', e?.message ?? e);
    }
}
