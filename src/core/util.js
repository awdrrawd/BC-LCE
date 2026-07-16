// ════════════════════════════════════════════════════════════════════════════
// 通用 DOM / 環境工具
// ════════════════════════════════════════════════════════════════════════════

/** @returns {boolean} 是否為橫向（LCE 只在橫向啟用，與 MPL 直向互補） */
export function isLandscape() { return window.innerWidth >= window.innerHeight; }

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
