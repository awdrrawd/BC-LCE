// ════════════════════════════════════════════════════════════════════════════
// 玩家關係工具（移植自 MPL）—— 用於在房間卡片上標示主人／戀人／好友
//
// BC 各版本存放主人/戀人的欄位名稱與結構不太一致（有時是數字、有時是物件、
// 有時是陣列），所以這裡不寫死路徑，改用遞迴掃出所有看起來像 MemberNumber 的值。
// ════════════════════════════════════════════════════════════════════════════

/** 遞迴收集物件中所有像 MemberNumber 的數字（只走名稱相關的 key，避免誤抓）。 */
function collectMemberNumbers(value, seen = new Set()) {
    const out = new Set();
    const walk = (v) => {
        if (v == null) return;
        if (typeof v === 'number' && Number.isFinite(v)) { out.add(Number(v)); return; }
        if (typeof v === 'string' && /^\d+$/.test(v)) { out.add(Number(v)); return; }
        if (typeof v !== 'object') return;
        if (seen.has(v)) return;   // 防循環參照
        seen.add(v);
        if (v instanceof Map) { for (const [k, val] of v.entries()) { walk(k); walk(val); } return; }
        if (v instanceof Set) { v.forEach(walk); return; }
        if (Array.isArray(v)) { v.forEach(walk); return; }
        for (const [k, val] of Object.entries(v)) {
            if (/membernumber|membernumbers|owner|owners|lover|lovers|submissive|dominant/i.test(k)) walk(val);
        }
    };
    walk(value);
    return out;
}

function getOwnerSet() {
    const set = new Set();
    if (typeof Player === 'undefined' || !Player) return set;
    for (const src of [Player.Owner, Player.Ownership, Player.Ownership?.Owner,
        Player.Ownership?.Owners, Player.Ownership?.MemberNumber, Player.Ownership?.MemberNumbers]) {
        collectMemberNumbers(src).forEach(n => set.add(n));
    }
    return set;
}

function getLoverSet() {
    const set = new Set();
    if (typeof Player === 'undefined' || !Player) return set;
    for (const src of [Player.Lover, Player.Lovers, Player.Lovership,
        Player.Lovership?.MemberNumber, Player.Lovership?.MemberNumbers]) {
        collectMemberNumbers(src).forEach(n => set.add(n));
    }
    return set;
}

function getFriendSet() {
    const set = new Set();
    if (typeof Player === 'undefined' || !Player) return set;
    // FriendNames 是 Map<MemberNumber, NickName>，只要 key
    const fn = Player.FriendNames;
    if (fn instanceof Map) {
        for (const key of fn.keys()) {
            const n = Number(key);
            if (Number.isFinite(n)) set.add(n);
        }
    } else {
        collectMemberNumbers(fn).forEach(n => set.add(n));
    }
    for (const src of [Player.FriendList, Player.OnlineSharedSettings?.FriendList]) {
        collectMemberNumbers(src).forEach(n => set.add(n));
    }
    return set;
}

/** @returns {'owner'|'lover'|'friend'|null} 該玩家與自己的最高關係 */
export function getRelation(memberNumber) {
    const mn = Number(memberNumber);
    if (!Number.isFinite(mn)) return null;
    if (getOwnerSet().has(mn)) return 'owner';
    if (getLoverSet().has(mn)) return 'lover';
    if (getFriendSet().has(mn)) return 'friend';
    return null;
}

/**
 * 房間內所有熟人，依關係排序（主人 > 戀人 > 好友）。
 * BC 的 room.Friends 只給「是好友」的人，所以查不到更高關係時一律當 friend。
 */
export function getRoomRelations(room) {
    const friends = Array.isArray(room?.Friends) ? room.Friends : [];
    const RANK = { owner: 3, lover: 2, friend: 1 };
    return friends
        .map((f) => {
            const memberNumber = Number(typeof f === 'object' ? f.MemberNumber : f);
            const memberName = typeof f === 'object' ? (f.MemberName || String(memberNumber)) : String(memberNumber);
            return { memberNumber, memberName, relation: getRelation(memberNumber) || 'friend' };
        })
        .sort((a, b) => (RANK[b.relation] ?? 0) - (RANK[a.relation] ?? 0));
}
