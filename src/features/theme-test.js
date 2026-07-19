// ════════════════════════════════════════════════════════════════════════════
// /lceThemetest —— 除錯用浮空氣球
//
// 用途：在遊戲中即時開/關主題染色，方便比較「有主題 / 無主題」兩種環境下的 UI。
// 行為：
//   • 輸入 /lceThemetest → 生出一顆浮球（可拖動）；再輸入一次 → 收起浮球並還原設定。
//   • 點一下浮球 → 切換主題開/關（第一下關、再一下開…），球色與文字即時反映狀態。
//   • 這只是「當下這次」的臨時覆蓋，不會動到使用者存起來的主題設定（見 theme.js
//     的 setThemeDebugOverride）；收起浮球就完全還原。
// ════════════════════════════════════════════════════════════════════════════

import { isThemeActive, setThemeDebugOverride } from './theme.js';

const BALLOON_ID = 'lce-themetest-balloon';
const STYLE_ID = 'lce-themetest-style';

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#${BALLOON_ID} {
    position:fixed; right:24px; top:120px; z-index:2147483000;
    width:78px; height:78px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; text-align:center;
    font:600 12px/1.15 system-ui,-apple-system,"Segoe UI",sans-serif; color:#fff;
    letter-spacing:.02em; cursor:grab; user-select:none; touch-action:none;
    box-shadow:0 10px 22px rgba(0,0,0,.45),
               inset 0 -7px 13px rgba(0,0,0,.28),
               inset 0 7px 11px rgba(255,255,255,.38);
    /* 用 translate 屬性做漂浮，避開 :active 的 transform，兩者互不覆蓋 */
    animation:lce-tt-float 3.2s ease-in-out infinite;
    transition:transform .12s ease, box-shadow .2s ease;
}
#${BALLOON_ID}::after {   /* 氣球的小繩結 */
    content:""; position:absolute; bottom:-7px; left:50%;
    width:0; height:0; translate:-50% 0;
    border-left:6px solid transparent; border-right:6px solid transparent;
    border-top:9px solid currentColor; opacity:.55;
}
#${BALLOON_ID}[data-on="1"] { background:radial-gradient(circle at 32% 28%, #b982ff, #5a0194 72%); }
#${BALLOON_ID}[data-on="0"] { background:radial-gradient(circle at 32% 28%, #9a9a9a, #333 72%); }
#${BALLOON_ID}:active { cursor:grabbing; transform:scale(.93); }
@keyframes lce-tt-float { 0%,100%{ translate:0 0; } 50%{ translate:0 -10px; } }
@media (prefers-reduced-motion: reduce) { #${BALLOON_ID} { animation:none; } }
`;
    document.head.appendChild(s);
}

/** 生出浮球並掛上「點擊切換 / 拖動搬移」的互動。 */
function buildBalloon() {
    injectStyle();
    const b = document.createElement('div');
    b.id = BALLOON_ID;
    const label = document.createElement('span');
    b.appendChild(label);

    const sync = () => {
        const on = isThemeActive();
        b.dataset.on = on ? '1' : '0';
        label.textContent = on ? 'Theme\nON' : 'Theme\nOFF';
        label.style.whiteSpace = 'pre';
        b.title = `主題目前${on ? '開啟' : '關閉'} — 點擊切換，再次輸入 /lceThemetest 收起`;
    };

    // 拖動與點擊共用一組 pointer 事件：移動超過門檻就算拖動、不觸發切換。
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false, moved = false;
    b.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false;
        startX = e.clientX; startY = e.clientY;
        const r = b.getBoundingClientRect();
        originLeft = r.left; originTop = r.top;
        try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    b.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        b.style.left = `${originLeft + dx}px`;
        b.style.top = `${originTop + dy}px`;
        b.style.right = 'auto';   // 一旦拖動就改用 left 定位，取消初始的 right
    });
    b.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        try { b.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (!moved) { setThemeDebugOverride(!isThemeActive()); sync(); }   // 純點擊 → 切換
    });

    sync();
    document.body.appendChild(b);
}

/** /lceThemetest 進入點：沒浮球就生一顆，有就收起並還原成實際設定。 */
export function toggleThemeTestBalloon() {
    const existing = document.getElementById(BALLOON_ID);
    if (existing) {
        existing.remove();
        setThemeDebugOverride(null);   // 收起除錯浮球 → 還原成使用者真正的主題設定
        return;
    }
    buildBalloon();
}
