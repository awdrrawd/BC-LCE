// ════════════════════════════════════════════════════════════════════════════
// 等待伺服器時顯示已發送的信息（pendingMessages）—— 移植自 WCE pendingMessages.js
// 送出時先在聊天室畫一則半透明的暫存訊息（帶 nonce 與跑馬點），伺服器回傳同 nonce 時移除。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const STYLE_ID = 'lce-pending-style';
const HIDDEN_TYPE = 'Hidden';
let nonce = 0;

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.lce-pending{opacity:0.4;}
.lce-ellipsis{display:inline-block;position:relative;width:80px;height:1em;}
.lce-ellipsis div{position:absolute;top:44%;width:13px;height:13px;border-radius:50%;
  background:var(--lce-text,#fff);animation-timing-function:cubic-bezier(0,1,1,0);}
.lce-ellipsis div:nth-child(1){left:8px;animation:lce-ell1 0.6s infinite;}
.lce-ellipsis div:nth-child(2){left:8px;animation:lce-ell2 0.6s infinite;}
.lce-ellipsis div:nth-child(3){left:32px;animation:lce-ell2 0.6s infinite;}
.lce-ellipsis div:nth-child(4){left:56px;animation:lce-ell3 0.6s infinite;}
@keyframes lce-ell1{0%{transform:scale(0);}100%{transform:scale(1);}}
@keyframes lce-ell3{0%{transform:scale(1);}100%{transform:scale(0);}}
@keyframes lce-ell2{0%{transform:translate(0,0);}100%{transform:translate(24px,0);}}
`;
    document.head.appendChild(s);
}

const isChatMessage = (m) => !!m && typeof m === 'object' && typeof m.Content === 'string' && typeof m.Type === 'string';

function addToDictionary(dictionary, key, value) {
    if (!Array.isArray(dictionary)) dictionary = [];
    dictionary.push({ Tag: key, Text: value });
    return dictionary;
}

let installed = false;

export function installPendingMessages() {
    if (installed) return;
    installed = true;
    injectStyle();

    const hook = (name, prio, fn) => {
        try { modApi.hookFunction(name, prio, fn); }
        catch (e) { console.warn('🐈‍⬛ [LCE] pendingMessages hook 未掛上:', name, e?.message ?? e); }
    };

    // 伺服器回傳 → 移除對應的暫存訊息
    hook('ChatRoomMessage', 0, (args, next) => {
        const ret = next(args);
        try {
            if (getFeature('pendingMessages') && args?.length && isChatMessage(args[0]) && Array.isArray(args[0].Dictionary)) {
                const tag = args[0].Dictionary.find?.(d => d.Tag === 'lce_nonce');
                if (tag) document.querySelector(`[data-nonce='${tag.Text}']`)?.remove();
            }
        } catch { /* ignore */ }
        return ret;
    });

    // 送出 → 先畫暫存訊息
    hook('ServerSend', 10, (args, next) => {
        try {
            if (getFeature('pendingMessages') && args?.length >= 2 && args[0] === 'ChatRoomChat'
                && isChatMessage(args[1]) && args[1].Type !== HIDDEN_TYPE && !args[1].Target) {
                nonce++;
                if (nonce >= Number.MAX_SAFE_INTEGER) nonce = 0;
                args[1].Dictionary = addToDictionary(args[1].Dictionary, 'lce_nonce', nonce);

                const div = document.createElement('div');
                div.classList.add('ChatMessage', 'lce-pending');
                div.setAttribute('data-time', ChatRoomCurrentTime());
                div.setAttribute('data-sender', Player.MemberNumber?.toString());
                div.setAttribute('data-nonce', nonce.toString());

                if (args[1].Type === 'Chat') {
                    div.classList.add('ChatMessageChat');
                    const name = document.createElement('span');
                    name.classList.add('ChatMessageName');
                    name.style.color = Player.LabelColor || '';
                    name.textContent = CharacterNickname(Player);
                    div.appendChild(name);
                    div.appendChild(document.createTextNode(`: ${args[1].Content}`));
                } else if (args[1].Type === 'Emote' || args[1].Type === 'Action') {
                    div.classList.add('ChatMessageEmote');
                    div.appendChild(document.createTextNode(`*${args[1].Type === 'Emote' ? `${CharacterNickname(Player)}: ` : ''}${args[1].Content}*`));
                } else {
                    return next(args);
                }

                const loader = document.createElement('div');
                loader.classList.add('lce-ellipsis');
                for (let i = 0; i < 4; i++) loader.appendChild(document.createElement('div'));
                div.appendChild(loader);
                ChatRoomAppendChat(div);
            }
        } catch (e) { console.warn('🐈‍⬛ [LCE] pendingMessages 失敗:', e); }
        return next(args);
    });
}
