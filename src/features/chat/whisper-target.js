import { createHook } from '../../core/hooks.js';
// ════════════════════════════════════════════════════════════════════════════
// 私聊對象管理：
// 1. 私聊對象離開房間時自動解除（whisperTargetReset）—— 移植自 WCE chatRoomWhisperFixes.ts
// 2. 回覆/點擊悄悄話後持續鎖定對象（persistentWhisper）—— 防止後續發言洩漏至公開頻道
// ════════════════════════════════════════════════════════════════════════════

import { shouldLceHandle } from '../../core/wce-compat.js';
import { getFeature } from '../../core/feature-settings.js';
import { T } from '../../core/i18n.js';
import { LOCAL_MARKER } from './local-messages.js';
import { LOG } from '../../core/constants.js';

const GRACE_MS = 60 * 1000;   // 離開後的寬限：一分鐘內回來就不清（同 WCE）
const LEAVE_PREFIXES = ['ServerLeave', 'ServerBan', 'ServerKick', 'ServerDisconnect'];

const resetOn = () => shouldLceHandle('whisperTargetReset', 'whisperTargetFixes');
const persistentOn = () => !!getFeature('persistentWhisper');
const target = () => {
    if (typeof window !== 'undefined' && typeof window.ChatRoomTargetMemberNumber === 'number') {
        return window.ChatRoomTargetMemberNumber;
    }
    return typeof ChatRoomTargetMemberNumber !== 'undefined' ? ChatRoomTargetMemberNumber : -1;
};

/** memberNumber → 計時器 id（同時最多一個，因為一次只有一個私聊對象）。 */
const leaveTimers = {};

const hook = createHook('whisper-target');

function cancelTimer(num) {
    if (leaveTimers[num]) { clearTimeout(leaveTimers[num]); delete leaveTimers[num]; }
}

/** 改回對所有人說話並在聊天室送一則本地提示（樣式交給 local-messages.js 統一）。 */
function clearTargetNotify() {
    try {
        if (typeof ChatRoomSetTarget === 'function') ChatRoomSetTarget(-1);
        if (typeof ChatRoomSendLocal === 'function') {
            ChatRoomSendLocal(`<div class="${LOCAL_MARKER}">${T('whisper_target_cleared')}</div>`);
        }
    } catch (e) { console.warn(LOG, '解除私聊對象失敗:', e); }
}

function lockWhisperTarget(memberNumber) {
    if (!persistentOn()) return;
    if (typeof memberNumber !== 'number' || isNaN(memberNumber) || memberNumber < 0) return;

    // Do not lock onto self
    const myNumber = typeof Player !== 'undefined' && Player ? Player.MemberNumber : -1;
    if (memberNumber === myNumber) return;

    // Validate that the target character is actually present in the room
    if (typeof ChatRoomCharacter !== 'undefined' && Array.isArray(ChatRoomCharacter)) {
        const inRoom = ChatRoomCharacter.some(c => c && c.MemberNumber === memberNumber);
        if (!inRoom) return;
    }

    if (typeof ChatRoomSetTarget === 'function') {
        ChatRoomSetTarget(memberNumber);
    } else {
        window.ChatRoomTargetMemberNumber = memberNumber;
    }
}

function unlockWhisperTarget() {
    if (typeof ChatRoomSetTarget === 'function') {
        ChatRoomSetTarget(-1);
    } else {
        window.ChatRoomTargetMemberNumber = -1;
    }

    if (typeof ChatRoomMessageReplyStop === 'function') {
        ChatRoomMessageReplyStop();
    }

    // Strip prefilled /whisper or /w command while preserving the message body typed by user
    const input = document.getElementById('InputChat');
    if (input && typeof input.value === 'string') {
        const stripped = input.value.replace(/^\/(?:whisper|w)\s+\d+\s*/i, '');
        if (stripped !== input.value) {
            input.value = stripped;
        }
    }
}

let installed = false;

export function installWhisperTarget() {
    if (installed) return;
    installed = true;

    // 1. 自動解除（離開房間計時）
    hook('ChatRoomMessageDisplay', 1, (args, next) => {
        try {
            const msg = args[0];
            const t = target();
            // 只在「開著功能、且這則 Action 的送出者正是目前私聊對象」時處理
            if (resetOn() && t >= 0 && msg?.Type === 'Action' && msg.Sender === t) {
                const content = String(msg.Content || '');
                if (LEAVE_PREFIXES.some(p => content.startsWith(p))) {
                    cancelTimer(msg.Sender);   // 先清舊的再掛，避免重複計時
                    // Persistent mode preserves target until explicit exit (BC blocks sending with a warning)
                    if (persistentOn()) return next(args);
                    leaveTimers[msg.Sender] = setTimeout(() => {
                        delete leaveTimers[msg.Sender];
                        // 一分鐘後仍指著同一人才清 —— 中途換了對象或已自行改回就不動
                        if (resetOn() && !persistentOn() && target() === msg.Sender) clearTargetNotify();
                    }, GRACE_MS);
                } else if (content.startsWith('ServerEnter')) {
                    cancelTimer(msg.Sender);   // 寬限內回來 → 取消清除
                }
            }
        } catch { /* ignore */ }
        return next(args);
    });

    // 2. 點擊私聊訊息的 Reply 按鈕時鎖定私聊對象
    hook('ChatRoomMessageSetReply', 1, (args, next) => {
        const res = next(args);
        try {
            if (persistentOn()) {
                const msgId = args[0];
                const isWhisper = typeof ChatRoomMessageGetType === 'function'
                    ? ChatRoomMessageGetType(msgId) === 'Whisper'
                    : false;

                if (isWhisper) {
                    const replyMsg = typeof ChatRoomMessageGetById === 'function'
                        ? ChatRoomMessageGetById(msgId)
                        : null;

                    if (replyMsg) {
                        const sender = Number(replyMsg.getAttribute('data-sender'));
                        const tgt = Number(replyMsg.getAttribute('data-target'));
                        const myNumber = typeof Player !== 'undefined' && Player ? Player.MemberNumber : -1;
                        const receiver = (sender === myNumber && !isNaN(tgt) && tgt >= 0) ? tgt : sender;

                        if (!isNaN(receiver) && receiver >= 0) {
                            lockWhisperTarget(receiver);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(LOG, 'ChatRoomMessageSetReply hook error:', e);
        }
        return res;
    });

    // 3. 點擊聊天記錄發言者名字時鎖定私聊對象
    hook('ChatRoomMessageNameClick', 1, function (args, next) {
        const res = next(args);
        try {
            if (persistentOn()) {
                const el = this?.parentElement ? this : window.event?.currentTarget;
                const sender = Number.parseInt(el?.parentElement?.dataset?.sender, 10);
                const tgt = Number.parseInt(el?.parentElement?.dataset?.target, 10);
                const myNumber = typeof Player !== 'undefined' && Player ? Player.MemberNumber : -1;
                const receiver = (sender === myNumber && !isNaN(tgt) && tgt >= 0) ? tgt : sender;

                if (!isNaN(receiver) && receiver >= 0) {
                    lockWhisperTarget(receiver);
                }
            }
        } catch (e) {
            console.warn(LOG, 'ChatRoomMessageNameClick hook error:', e);
        }
        return res;
    });

    // 4. 發送悄悄話後持續鎖定對象，並在目標離場發送失敗時提示返回公開聊天
    hook('ChatRoomSendWhisper', 1, (args, next) => {
        const targetNum = args[0];
        const res = next(args);
        if (persistentOn()) {
            if (res === true && typeof targetNum === 'number' && targetNum >= 0) {
                lockWhisperTarget(targetNum);
            } else if (res === 'target-gone') {
                if (typeof ChatRoomSendLocal === 'function') {
                    ChatRoomSendLocal(`<div class="${LOCAL_MARKER}">${T('whisper_absent_hint')}</div>`);
                }
            }
        }
        return res;
    });

    // 5. 支援 /p, /public, /all 指令切回公開聊天，亦支援附帶發言內容（例如 /p 你好）
    hook('CommandParse', 1, (args, next) => {
        if (persistentOn() && typeof args[0] === 'string') {
            const raw = args[0].trim();
            const lower = raw.toLowerCase();
            if (lower === '/p' || lower === '/public' || lower === '/all') {
                unlockWhisperTarget();
                if (typeof CommandChangeChatInputContent === 'function') {
                    CommandChangeChatInputContent('');
                } else {
                    const input = document.getElementById('InputChat');
                    if (input) input.value = '';
                }
                return true;
            }
            const match = raw.match(/^\/(?:p|public|all)\s+(.+)$/i);
            if (match) {
                unlockWhisperTarget();
                return match[1];
            }
        }
        return next(args);
    });

    // 6. 在輸入框內按 Esc 鍵解除鎖定並返回公開聊天（不干擾其他控制項或選單的 Esc）
    document.addEventListener('keydown', (e) => {
        if (!persistentOn()) return;
        if (e.key === 'Escape') {
            if (typeof CurrentScreen !== 'undefined' && CurrentScreen === 'ChatRoom') {
                const hasWhisperPrefix = typeof e.target?.value === 'string' && /^\/(?:whisper|w)\s+\d+/i.test(e.target.value);
                if (e.target?.id === 'InputChat' && (target() >= 0 || hasWhisperPrefix)) {
                    unlockWhisperTarget();
                }
            }
        }
    }, true);
}
