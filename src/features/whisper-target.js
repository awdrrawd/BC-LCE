// ════════════════════════════════════════════════════════════════════════════
// 私聊對象離開房間時自動解除（whisperTargetReset）—— 移植自 WCE chatRoomWhisperFixes.ts
//
// 機制：監看聊天室的 Action 訊息。當「目前私聊對象」送出 ServerLeave/Ban/Kick/Disconnect
// 這類離開訊息時，起一個 60 秒寬限計時器；逾時仍指著同一人就 ChatRoomSetTarget(-1) 改回
// 對所有人說話，並送一則本地訊息告知。對方在一分鐘內 ServerEnter 回來則取消計時。
// 寬限一分鐘是為了容忍短暫斷線重連 —— 一離開就清會很煩（同 WCE）。
//
// 註：只做「離開房間」這半邊（使用者要的）。WCE 另有 patch ChatRoomSendChat 在「私聊送到
// 不在場對象」時也重置，但那要靠精確比對 BC 原始碼字串、跨版本易碎，暫不移植。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { LOCAL_MARKER } from './local-messages.js';

const LOG = '🐈‍⬛ [LCE]';
const GRACE_MS = 60 * 1000;   // 離開後的寬限：一分鐘內回來就不清（同 WCE）
const LEAVE_PREFIXES = ['ServerLeave', 'ServerBan', 'ServerKick', 'ServerDisconnect'];

const resetOn = () => !!getFeature('whisperTargetReset');
const target = () => (typeof ChatRoomTargetMemberNumber !== 'undefined' ? ChatRoomTargetMemberNumber : -1);

/** memberNumber → 計時器 id（同時最多一個，因為一次只有一個私聊對象）。 */
const leaveTimers = {};

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'whisper-target hook 未掛上:', name, e?.message ?? e); }
}

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

let installed = false;

export function installWhisperTarget() {
    if (installed) return;
    installed = true;

    hook('ChatRoomMessageDisplay', 1, (args, next) => {
        try {
            const msg = args[0];
            const t = target();
            // 只在「開著功能、且這則 Action 的送出者正是目前私聊對象」時處理
            if (resetOn() && t >= 0 && msg?.Type === 'Action' && msg.Sender === t) {
                const content = String(msg.Content || '');
                if (LEAVE_PREFIXES.some(p => content.startsWith(p))) {
                    cancelTimer(msg.Sender);   // 先清舊的再掛，避免重複計時
                    leaveTimers[msg.Sender] = setTimeout(() => {
                        delete leaveTimers[msg.Sender];
                        // 一分鐘後仍指著同一人才清 —— 中途換了對象或已自行改回就不動
                        if (target() === msg.Sender) clearTargetNotify();
                    }, GRACE_MS);
                } else if (content.startsWith('ServerEnter')) {
                    cancelTimer(msg.Sender);   // 寬限內回來 → 取消清除
                }
            }
        } catch { /* ignore */ }
        return next(args);
    });
}
