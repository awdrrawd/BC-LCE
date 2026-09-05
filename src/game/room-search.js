// BC 搜尋區域的唯一讀寫入口；按鈕呈現及插件偏好儲存由各介面負責。
const validSpace = space => space === 'X' || space === '';

/** Resolve the native button at click time: search refreshes can replace it. */
export function joinSearchRoom(room) {
    const button = room?.Order != null
        ? document.getElementById(`chat-search-room-join-button-${room.Order}`) : null;
    if (button) button.click();
    else if (typeof ChatSearchClickRoom === 'function') ChatSearchClickRoom(room);
}

export function playerHasMaleGender() {
    try {
        const genders = typeof Player !== 'undefined' && typeof Player?.GetGenders === 'function'
            ? Player.GetGenders() : [];
        return Array.isArray(genders) && genders.includes('M');
    } catch { return false; }
}

export function getCurrentSpace() {
    if (typeof ChatSearchGetSpace === 'function') {
        const space = ChatSearchGetSpace();
        if (validSpace(space)) return space;
    }
    if (typeof ChatSearchSpace !== 'undefined' && validSpace(ChatSearchSpace)) return ChatSearchSpace;
    const saved = typeof Player !== 'undefined' ? Player?.ChatSearchSettings?.Space : undefined;
    return validSpace(saved) ? saved : 'X';
}

export const getToggleTargetSpace = () =>
    playerHasMaleGender() ? 'X' : (getCurrentSpace() === 'X' ? '' : 'X');

/** 同步 BC 的兩份區域狀態，不觸發搜尋或伺服器偏好保存。 */
export function setSearchSpace(space) {
    if (!validSpace(space)) return false;
    const allowed = playerHasMaleGender() ? 'X' : space;
    if (typeof Player !== 'undefined' && Player?.ChatSearchSettings) Player.ChatSearchSettings.Space = allowed;
    if (typeof ChatSearchSpace !== 'undefined') ChatSearchSpace = allowed;
    return true;
}

/** 原生回應需要 InputSearch；離開搜尋頁後的延遲點擊不能再送查詢。 */
export async function applySpace(space, queryText = '') {
    if (typeof CurrentScreen === 'undefined' || CurrentScreen !== 'ChatSearch'
        || !document.getElementById('InputSearch') || typeof ChatSearchQuery !== 'function') return false;
    try {
        if (!setSearchSpace(space)) return false;
        await ChatSearchQuery(queryText);
        return true;
    } catch (error) {
        console.warn('🐈‍⬛ [LCE] 切換搜尋區域失敗:', error);
        return false;
    }
}
