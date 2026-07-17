// ════════════════════════════════════════════════════════════════════════════
// 防混淆（antiGarble）＋ 防聾（antiDeaf）＋ 興奮結巴（stutters）
// 移植自 WCE antiGarbling.ts / chatAugments.js 的 SpeechTransformProcess 部分。
//
// 防混淆的運作：送出訊息時，除了照常送出被塞口球等效果混淆過的內容，
// 另外把「未混淆（或依設定只混淆到較低程度）」的版本放進 Dictionary 的 Original 欄位。
// 接收端由 BC 原生支援顯示成括號內的原文（偏好設定的 ShowUngarbledMessages）。
//
// 六項細節：聊天 / 耳語 各有「混淆程度、結巴、嬰兒語」，對應 antiGarble<Chat|Whisper><...>。
//   程度 none/low/medium/high = 只混淆到 0/1/3/5 級；full = 完全不送原文；off = 耳語完全不混淆
//   結巴 / 嬰兒語 remove=一律移除、ignore=只在有其他解混淆時移除、preserve=保留
//
// 注意：WCE 的 antiGarbleChatOptions（聊天框上的快捷按鈕列）不在規格內，未移植。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';
const LEVEL_INTENSITY = { low: 1, medium: 3, high: 5 };

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'antiGarble hook 未掛上:', name, e?.message ?? e); }
}

// ───────────────────────── 興奮結巴（stutterWord，移植自 WCE chatAugments）─────────────────────────
const START_SOUNDS = ['..', '--'];
const END_SOUNDS = ['...', '~', '~..', '~~', '..~'];
const EGGED_SOUNDS = ['ah', 'aah', 'mnn', 'nn', 'mnh', 'mngh', 'haa', 'nng', 'mnng'];

/** 依慾望與震動強度，替單字加上 s-s-結巴，並可能插入呻吟。 */
export function stutterWord(word, forceStutter) {
    if (!word?.length) return { results: [word], stutter: false };

    const addStutter = (w) =>
        /^\p{L}/u.test(w) ? `${w.substring(0, /[\uD800-\uDFFF]/u.test(w[0]) ? 2 : 1)}-${w}` : w;

    const maxIntensity = Math.max(0, ...Player.Appearance
        .filter(a => (a.Property?.Intensity ?? -1) > -1)
        .map(a => a.Property?.Intensity ?? 0));
    const playerArousal = Player.ArousalSettings?.Progress ?? 0;
    const eggedBonus = maxIntensity * 5;
    const chanceToStutter = (Math.max(0, playerArousal - 10 + eggedBonus) * 0.5) / 100;
    const chanceToMakeSound = (Math.max(0, playerArousal / 2 - 20 + eggedBonus * 2) * 0.5) / 100;

    let stutter = false;
    const r = Math.random();
    for (let i = Math.min(4, Math.max(1, maxIntensity)); i >= 1; i--) {
        if (r < chanceToStutter / i || (i === 1 && forceStutter && chanceToStutter > 0)) {
            word = addStutter(word);
            stutter = true;
        }
    }

    const results = [word];
    if (maxIntensity > 0 && Math.random() < chanceToMakeSound) {
        const s = START_SOUNDS[Math.floor(Math.random() * START_SOUNDS.length)];
        const m = EGGED_SOUNDS[Math.floor(Math.random() * EGGED_SOUNDS.length)];
        const e = END_SOUNDS[Math.floor(Math.random() * END_SOUNDS.length)];
        results.push(' ', `${s}${m}${e}`);
        stutter = true;
    }
    return { results, stutter };
}

const parseUrl = (word) => {
    const t = /^\((.+)\)$/.exec(word);
    if (t) return parseUrl(t[1]);
    try { const u = new URL(word); return ['http:', 'https:'].includes(u.protocol); } catch { return false; }
};

/** 逐字處理訊息：OOC 內不動、網址用括號包起來、其餘視設定加結巴。 */
function messageReplacements(msg) {
    const words = [msg];
    const newWords = [];
    let firstStutter = true, inOOC = false, hasStuttered = false;

    for (let i = 0; i < words.length; i++) {
        const wsIdx = words[i].search(/[\s\r\n]/u);
        if (wsIdx >= 1) {
            words.splice(i + 1, 0, words[i].substring(wsIdx));
            words[i] = words[i].substring(0, wsIdx);
        } else if (wsIdx === 0) {
            words.splice(i + 1, 0, words[i].substring(1));
            [words[i]] = words[i];
            newWords.push(words[i]);
            continue;
        }

        const oocIdx = words[i].search(/[()]/u);
        if (oocIdx > 0) {
            words.splice(i + 1, 0, words[i].substring(oocIdx + 1));
            words.splice(i + 1, 0, words[i].substring(oocIdx, oocIdx + 1));
            words[i] = words[i].substring(0, oocIdx);
        } else if (oocIdx === 0 && words[i].length > 1) {
            words.splice(i + 1, 0, words[i].substring(1));
            [words[i]] = words[i];
        }

        if (words[i] === '(') inOOC = true;

        if (!inOOC && parseUrl(words[i])) {
            newWords.push('( ', words[i], ' )');
        } else if (getFeature('stutters') && !inOOC) {
            const { results, stutter } = stutterWord(words[i], firstStutter);
            hasStuttered ||= stutter;
            newWords.push(...results);
            firstStutter = false;
        } else {
            newWords.push(words[i]);
        }

        if (words[i] === ')') inOOC = false;
    }
    return { msg: newWords.join(''), hasStuttered };
}

/**
 * 這則訊息是不是「純粹一個網址」（前後空白不算）。
 * 只認 http/https，避免把普通句子誤判成網址。
 */
function isPureUrl(text) {
    const word = String(text ?? '').trim();
    if (!word || /[\s\r\n]/u.test(word)) return false;
    try {
        const url = new URL(word);
        return ['http:', 'https:'].includes(url.protocol);
    } catch { return false; }
}

let installed = false;

export function installAntiGarble() {
    if (installed) return;
    installed = true;

    // ── 純網址自動當 OOC 送出 ──
    // 口堵/結巴/寶寶語都是逐字改寫，會把網址整個打爛（對方既點不開也嵌不出圖）。
    // 包成 OOC 的 ( ) 之後 BC 就不會做任何語音變形，而 chat-augments 的 parseUrl
    // 本來就會剝掉外層括號，所以圖片嵌入照常運作。
    hook('ChatRoomSendChat', 100, (args, next) => {
        try {
            if (!getFeature('urlAsOoc')) return next(args);
            const text = ElementValue('InputChat');
            // 已經是 OOC 或指令就別動
            if (!text || text.startsWith('(') || text.startsWith('/') || text.startsWith('*')) return next(args);
            if (!isPureUrl(text)) return next(args);
            ElementValue('InputChat', `(${text.trim()})`);
        } catch (e) { console.warn(LOG, 'urlAsOoc 失敗:', e); }
        return next(args);
    });

    // 送出端：附上未混淆（或較低混淆）的版本供對方顯示
    hook('ChatRoomGenerateChatRoomChatMessage', 100, (args, next) => {
        const [type, , replyId, ...rest] = args;
        let msg = args[1];
        if (!getFeature('antiGarble') || type === 'Emote') return next(args);

        // OOC 自動補右括號（沿用 BC 的 OOCAutoClose 行為）
        const lastRange = SpeechGetOOCRanges(msg).pop();
        if (Player.ChatSettings.OOCAutoClose && typeof lastRange === 'object'
            && msg.charAt(lastRange.start + lastRange.length - 1) !== ')'
            && lastRange.start + lastRange.length === msg.length
            && lastRange.length !== 1) {
            msg += ')';
        }

        let process = { effects: [], text: msg };
        let originalMsg;

        const lvl = getFeature(`antiGarble${type}Level`);
        const babyTalkMode = getFeature(`antiGarble${type}BabyTalk`);
        const stutterMode = getFeature(`antiGarble${type}Stutter`);

        if (type !== 'Whisper' || getFeature('antiGarbleWhisperLevel') !== 'off') {
            process = SpeechTransformProcess(Player, msg, SpeechTransformSenderEffects);
            const shouldBabyTalk = SpeechTransformShouldBabyTalk(Player);
            const gagIntensity = SpeechTransformGagGarbleIntensity(Player);
            const stutterIntensity = SpeechTransformStutterIntensity(Player);

            if (gagIntensity > 0
                || (babyTalkMode === 'remove' && shouldBabyTalk)
                || (stutterMode === 'remove' && stutterIntensity > 0)) {
                if (Player.RestrictionSettings?.NoSpeechGarble) {
                    originalMsg = msg;
                } else if (lvl !== 'full') {
                    originalMsg = msg;
                    if (babyTalkMode === 'preserve' && shouldBabyTalk) {
                        originalMsg = SpeechTransformBabyTalk(originalMsg);
                    }
                    if (['low', 'medium', 'high'].includes(lvl)) {
                        originalMsg = SpeechTransformGagGarble(originalMsg, Math.min(gagIntensity, LEVEL_INTENSITY[lvl]));
                    }
                    if (stutterMode === 'preserve' && stutterIntensity > 0) {
                        originalMsg = getFeature('stutters')
                            ? stutterWord(originalMsg, true).results.join('')
                            : SpeechTransformStutter(originalMsg, stutterIntensity);
                    }
                }
            }
            if (process.text === originalMsg) originalMsg = undefined;
        }

        const Dictionary = [{ Effects: process.effects, Original: originalMsg }];
        if (replyId) {
            Dictionary.push({ ReplyId: replyId, Tag: 'ReplyId' });
            ChatRoomMessageReplyStop();
        }
        return { Content: process.text, Type: type, Dictionary };
    });

    // 興奮結巴：接在 BC 的語音轉換流程上（stutters 關閉時保留 BC 原本的 stutter 效果）
    hook('SpeechTransformProcess', 5, (args, next) => {
        const [C, m, effects, ignoreOOC] = args;
        if (!getFeature('stutters')) return next(args);
        const { msg, hasStuttered } = messageReplacements(m || '');
        const result = next([C, msg, effects.filter(f => f !== 'stutter'), ignoreOOC]);
        if (hasStuttered) result.effects.push('stutter');
        return result;
    });

    // 防聾：失聰時把原文塞進 metadata，BC 會顯示在括號內
    try {
        if (typeof ChatRoomRegisterMessageHandler === 'function') {
            ChatRoomRegisterMessageHandler({
                Description: 'LCE: 失聰時顯示原文',
                Priority: 90,
                Callback: (data, _sender, msg, metadata) => {
                    if (data.Type === 'Chat' && getFeature('antiDeaf')
                        && Player.GetDeafLevel() > 0 && !metadata.OriginalMsg) {
                        metadata.OriginalMsg = msg;
                    }
                    return false;
                },
            });
        }
    } catch (e) { console.warn(LOG, 'antiDeaf 訊息處理器註冊失敗:', e); }
}
