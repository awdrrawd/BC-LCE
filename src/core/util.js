// ════════════════════════════════════════════════════════════════════════════
// 通用 DOM / 環境工具
// ════════════════════════════════════════════════════════════════════════════

/** @returns {boolean} 是否為橫向 */
export function isLandscape() { return window.innerWidth >= window.innerHeight; }

/** @returns {boolean} 是否為直向。與 isLandscape() 恰為互補，兩者不會同時成立或同時不成立。 */
export function isPortrait() { return window.innerWidth < window.innerHeight; }

/**
 * 取得排除軟體鍵盤後的視窗高度。
 * 手機鍵盤彈出時 innerHeight 不會變，但 visualViewport.height 會縮小；
 * 直式版面靠這個值算高度才不會被鍵盤推爆。
 */
export function getLockedVH() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
}

/** @returns {HTMLCanvasElement|null} 主 canvas 元素 */
export function getCanvas() {
    return document.getElementById('MainCanvas') || document.querySelector('canvas');
}

/** 建立元素小工具 */
export function mk(tag, cssText, props) {
    const el = document.createElement(tag);
    if (cssText) el.style.cssText = cssText;
    if (props) Object.assign(el, props);
    return el;
}

/**
 * 定位 BC 的 DOM 元素；元素不存在就跳過。
 *
 * BC 的 ElementPositionFix 對找不到的元素會印警告
 * （"A call to ElementPositionFix was made on non-existent element with ID undefined"
 *   —— 訊息裡的 undefined 是它拿 null 元素的 .id 印出來的，不是我們傳錯值）。
 * 我們幾個呼叫點都在每幀跑的 *Run / DrawProcess 裡，元素還沒建立或已被移除的那些
 * frame 就會洗版，所以統一在這裡擋掉。
 */
export function positionElement(id, font, x, y, w, h) {
    if (typeof ElementPositionFix !== 'function') return;
    if (!id || !document.getElementById(id)) return;
    ElementPositionFix(id, font, x, y, w, h);
}

/** 注入 / 更新 <style> */
export function injectStyle(id, css) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = css;
}

/** 移除指定 id 的 <style> */
export function removeStyle(id) { document.getElementById(id)?.remove(); }

/**
 * 依 canvas 邏輯座標放置一個 stage 元素。
 * @param {HTMLElement} el
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [fontSize]
 */
export function place(el, x, y, w, h, fontSize) {
    el.classList.add('lce-el');
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    if (fontSize) el.style.fontSize = fontSize + 'px';
    return el;
}
