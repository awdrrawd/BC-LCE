// 表情緩存：自動表情（寵物服、顏文字…）改臉之前先記下「原本的表情」。
//
//  • 緩存是空的 → 記下當前表情；不是空的 → 已經有人在臨時改臉，保留最早那份、不覆蓋。
//  • 臨時表情全部結束（最後一個釋放）時取出並清空。
//  • 唯讀 API 掛在 window.Liko.LCE.FaceCache，其他插件可偵測「現在的臉是不是臨時的」。
let cache = null;   // null = 空；否則 { original: {群組: 表情|null}, applied: {群組: 臨時表情|null} }

const copy = c => c && { original: { ...c.original }, applied: { ...c.applied } };

export const FaceCache = Object.freeze({
    isEmpty: () => cache === null,
    /** 目前緩存的副本（空時為 null）。original = 原本的表情，applied = 正套用的臨時表情。 */
    get: () => copy(cache),
});

/** applied 為 { 群組: 臨時表情 }；read(群組) 回傳該群組目前的表情。只補上緩存裡還沒有的群組。 */
export function captureFace(read, applied) {
    cache ??= { original: {}, applied: {} };
    for (const [group, value] of Object.entries(applied)) {
        if (!(group in cache.original)) cache.original[group] = read(group) ?? null;
        cache.applied[group] = value ?? null;
    }
}

/** 取出並清空緩存。 */
export function releaseCachedFace() {
    const taken = cache;
    cache = null;
    return taken;
}
