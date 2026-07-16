// ════════════════════════════════════════════════════════════════════════════
// 說話時自動開口（autoMouthOnTalk）—— 移植自 BC-Responsive CharTalk.ts
//
// 機制：收到聊天訊息時把內容切成 3 字一組，依字母對照表換算成一串「嘴型 + 持續時間」，
// 再逐格改變該角色的嘴部表情做出說話動畫。
//
// 重點：這只是本地視覺效果 —— 動畫期間會在 CommonDrawAppearanceBuild 裡「暫時」把嘴型
// 換掉、畫完立刻還原，所以不會污染角色真正的表情，也不會外送給別人。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';

const LOG = '🐈‍⬛ [LCE]';
const MAX_FRAMES = 30;

// 字母 → [嘴型, 持續毫秒]，依優先序比對（移植自 BC-Responsive，含拉丁與斯拉夫字母）
// 原版只涵蓋拉丁/斯拉夫字母，中日韓文字一條都不會命中 → 會落到「不改嘴型」，嘴巴完全不動。
// 因此另外補上全形標點的停頓規則，並在 animateSpeech 對未命中的字元做交替張合。
const LETTER_MAP = [
    { regex: /[.?!…~]/, expr: [null, 600] },
    { regex: /[。．！？；：～]/, expr: [null, 600] },   // 全形句末標點：停頓
    { regex: /[,;]/, expr: [null, 250] },
    { regex: /[，、]/, expr: [null, 250] },             // 全形逗號頓號：短停頓
    // Latin
    { regex: /[a]/i, expr: ['Open', 400] },
    { regex: /[oeu]/i, expr: ['HalfOpen', 300] },
    { regex: /[bp]/i, expr: [null, 200] },
    { regex: /[mn]/i, expr: [null, 500] },
    { regex: /[ij]/i, expr: ['Smirk', 400] },
    { regex: /[kqrw]/i, expr: ['HalfOpen', 300] },
    { regex: /[fv]/i, expr: ['LipBite', 300] },
    { regex: /[cdt]/i, expr: ['TonguePinch', 200] },
    { regex: /[slz]/i, expr: ['TonguePinch', 400] },
    { regex: /[ghx]/i, expr: ['Angry', 300] },
    // Cyrillic
    { regex: /[ая]/i, expr: ['Open', 400] },
    { regex: /[оеуєю]/i, expr: ['HalfOpen', 300] },
    { regex: /[бп]/i, expr: [null, 200] },
    { regex: /[мн]/i, expr: [null, 500] },
    { regex: /[иіжїы]/i, expr: ['Smirk', 400] },
    { regex: /[yкр]/i, expr: ['HalfOpen', 300] },
    { regex: /[фв]/i, expr: ['LipBite', 300] },
    { regex: /[цдт]/i, expr: ['TonguePinch', 200] },
    { regex: /[слз]/i, expr: ['TonguePinch', 400] },
    { regex: /[гх]/i, expr: ['Angry', 300] },
];

/** MemberNumber -> { realExpression, currentExpression, animation, animationFrame } */
const charData = {};

/** 只對「單純的聊天發言」做動畫：指令 / OOC / 動作 / 悄悄話 / 連結都跳過。 */
function isSimpleChat(msg) {
    return msg.trim().length > 0
        && (typeof ChatRoomTargetMemberNumber === 'undefined' || ChatRoomTargetMemberNumber === -1)
        && !msg.startsWith('/') && !msg.startsWith('(') && !msg.startsWith('*')
        && !msg.startsWith('!') && !msg.startsWith('.') && !msg.startsWith('@')
        && !msg.startsWith('http');
}

function setLocalMouthExpression(c, expressionName) {
    const mouth = InventoryGet(c, 'Mouth');
    if (!mouth || (expressionName && !mouth.Asset.Group.AllowExpression.includes(expressionName))) return;
    const d = charData[c.MemberNumber];
    if (!d) return;
    d.currentExpression = expressionName;
    CharacterRefresh(c, false);
}

function cleanup(c) {
    const d = charData[c.MemberNumber];
    if (!d) return;
    setLocalMouthExpression(c, d.realExpression);
    delete charData[c.MemberNumber];
}

function runStep(c) {
    const d = charData[c.MemberNumber];
    if (!d) return;
    if (d.animationFrame >= d.animation.length) { cleanup(c); return; }
    const [expression, duration] = d.animation[d.animationFrame++];
    setLocalMouthExpression(c, expression);
    setTimeout(() => runStep(c), duration);
}

function runAnimation(c, list) {
    if (charData[c.MemberNumber]) return;   // 已在動畫中就不重疊
    charData[c.MemberNumber] = { realExpression: null, currentExpression: null, animation: list, animationFrame: 0 };
    runStep(c);
}

/** 未命中對照表時的交替嘴型：讓中日韓等非字母文字也會確實開口。 */
const FALLBACK_CYCLE = [['Open', 350], ['HalfOpen', 300]];

function animateSpeech(c, msg) {
    // 中日韓一個字就是一個音節，3 字一組會太快；純 CJK 時改成逐字一格。
    const cjkHeavy = (msg.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g) || []).length >= msg.replace(/\s/g, '').length / 2;
    const chunks = msg.match(cjkHeavy ? /.{1}/g : /.{1,3}/g) || [];

    let alt = 0;
    const animation = chunks.map(chunk => {
        const hit = LETTER_MAP.find(({ regex }) => regex.test(chunk));
        if (hit) return hit.expr;
        // 沒有任何規則命中（中文/日文/韓文…）：交替張合，而不是原版的「不動」
        if (/\S/.test(chunk)) return FALLBACK_CYCLE[alt++ % FALLBACK_CYCLE.length];
        return [null, 200];
    }).slice(0, MAX_FRAMES);

    runAnimation(c, animation);
}

let installed = false;

export function installCharTalk() {
    if (installed) return;
    installed = true;

    // 收訊息 → 起動畫
    try {
        if (typeof ChatRoomRegisterMessageHandler === 'function') {
            ChatRoomRegisterMessageHandler({
                Description: 'LCE: 說話時自動開口',
                Priority: 500,
                Callback: (data, sender, msg) => {
                    try {
                        if (!getFeature('autoMouthOnTalk')) return false;
                        if (data.Type !== 'Chat' || !sender) return false;
                        if (charData[sender.MemberNumber]) return false;
                        if (isSimpleChat(msg)) animateSpeech(sender, msg);
                    } catch (e) { console.warn(LOG, 'charTalk 失敗:', e); }
                    return false;
                },
            });
        }
    } catch (e) { console.warn(LOG, 'charTalk 訊息處理器註冊失敗:', e); }

    // 繪製時暫時替換嘴型，畫完立刻還原（不污染真實表情）
    try {
        modApi.hookFunction('CommonDrawAppearanceBuild', 0, (args, next) => {
            const c = args[0];
            const d = c && charData[c.MemberNumber];
            if (!d) return next(args);

            const mouth = InventoryGet(c, 'Mouth');
            if (!mouth) return next(args);
            if (!mouth.Property) mouth.Property = {};

            d.realExpression = mouth.Property.Expression ?? null;
            mouth.Property.Expression = d.currentExpression ?? null;
            const ret = next(args);
            mouth.Property.Expression = d.realExpression;
            return ret;
        });
    } catch (e) { console.warn(LOG, 'CommonDrawAppearanceBuild hook 未掛上:', e?.message ?? e); }
}
