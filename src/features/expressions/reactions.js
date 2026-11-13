// ════════════════════════════════════════════════════════════════════════════
// 活動反應規則表 —— LCE 自有的「某個活動發生時，玩家該露出什麼表情」統一管理處
//
// 與 data.js 的分工：
//   data.js       ActivityTriggers：沿用 WCE 的資料表，只管「玩家自己做的／少數固定情境」。
//   reactions.js  本檔：LCE 新增的反應。原生活動與 Echo 自訂活動共用同一份規則，
//                 要新增、調整反應只改下面的 ReactionRules，不需動引擎或其他檔案。
//
// 規則欄位：
//   Id        規則名稱（只供辨識、除錯）
//   Category  活動類別，即 qol-data.js 的 mappings 事件名（Lick、Kiss、Cuddle…）
//             原生活動與 Echo 自訂活動分類後都會落在同一組類別。
//   Role      玩家在這則活動中的角色：
//               'target' 被作用的一方（且不是發送者）
//               'sender' 發送者
//               'any'    兩者皆可
//   Groups    限定部位（ItemEars…）；省略＝不限部位
//   Event     要推送的事件名，必須存在於 EventExpressions（data.js）
//
// 比對順序：由上而下，第一條符合的規則生效。
// ════════════════════════════════════════════════════════════════════════════

import { classifyActivity } from './qol-rules.js';
import { EventExpressions } from './data.js';

export const ReactionRules = [
    // 被舔耳朵／鼻子：對可愛事物的互動 → 擁抱同款的微笑。
    // 較親暱的部位不適合微笑，因此不列入（沒有規則＝不反應）。
    { Id: 'lick-cute-target', Category: 'Lick', Role: 'target', Groups: ['ItemEars', 'ItemNose'], Event: 'Cuddle' },
];

const roleMatches = (role, c) =>
    role === 'target' ? c.isTarget && !c.isSender
        : role === 'sender' ? c.isSender
            : c.isTarget || c.isSender;

/** 回傳這則活動訊息對應的事件名；沒有規則命中則回傳 null。 */
export function reactionEvent(data, memberNumber) {
    const c = classifyActivity(data, memberNumber, { native: true });
    if (!c) return null;
    for (const rule of ReactionRules) {
        if (rule.Category !== c.category) continue;
        if (rule.Groups && !rule.Groups.includes(c.group)) continue;
        if (!roleMatches(rule.Role ?? 'any', c)) continue;
        return EventExpressions[rule.Event] ? rule.Event : null;
    }
    return null;
}
