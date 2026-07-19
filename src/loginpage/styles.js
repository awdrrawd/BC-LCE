// ════════════════════════════════════════════════════════════════════════════
// 登入頁樣式注入
// ════════════════════════════════════════════════════════════════════════════

import { CANVAS_W, CANVAS_H, Z } from '../core/constants.js';
import { injectStyle } from '../core/util.js';

export function injectLoginStyles() {
    injectStyle('lce-styles', `
/* ══ LCE 橫式登入 UI ══════════════════════════════════════════════════════════
   配色一律走 --lce-login-accent / --lce-login-accent-rgb（見 features/ui-colors.js）。
   這裡的 fallback 只是防呆：ui-colors 一定會先注入變數，真的沒有時才會看到紫色預設。
   ═════════════════════════════════════════════════════════════════════════════ */

/* ── 黑底層 ──
   背景圖是貼著 canvas 鋪的（見下方 #lce-bg-img），而 BC 的 canvas 置中留邊，
   畫面上下緣一定會有一條不屬於 canvas 的區域。這層純黑鋪在最底下，
   讓那條露出來的邊變成黑色而不顯眼，不必把背景圖拉出 canvas 座標系。 */
#lce-bg-base {
    position:fixed; inset:0;
    z-index:${Z.STAGE - 1};
    background:#000;
    pointer-events:auto;   /* 吸收落空的點擊，避免穿透到下面 canvas 上的 BC/WCE 物件 */
}
#lce-bg-base[hidden] { display:none; }

#lce-stage {
    position:fixed; top:0; left:0;
    width:${CANVAS_W}px; height:${CANVAS_H}px;
    transform-origin:0 0;
    pointer-events:none;
    z-index:${Z.STAGE};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;
    color:#fff;
    /* 點7：整體不可選取（輸入框另外開放） */
    user-select:none; -webkit-user-select:none;
}
#lce-stage * { box-sizing:border-box; }
.lce-el { position:absolute; }

/* ── 滿版背景圖（蓋住整個 canvas：角色、感謝名單、WCE 存檔按鈕都被遮住） ──
   刻意從 -1,-1 起、長寬各多 2px：stage 有非整數的縮放，正好切齊 canvas 邊界時
   捨入誤差會在邊緣漏出一條細縫。多鋪 1px 出去就看不到接縫了。 */
#lce-bg-img {
    position:absolute; left:-1px; top:-1px;
    width:${CANVAS_W + 2}px; height:${CANVAS_H + 2}px;
    object-fit:cover; object-position:center;
    pointer-events:none; user-select:none;
}
/* 背景影片：與背景圖同框，疊在圖片上方（DOM 順序在 img 之後、overlay 之前）。
   平常 opacity:0 藏著，載好才由 background.js 設 opacity:1 淡入蓋住圖片。 */
#lce-bg-video {
    position:absolute; left:-1px; top:-1px;
    width:${CANVAS_W + 2}px; height:${CANVAS_H + 2}px;
    object-fit:cover; object-position:center;
    pointer-events:none; user-select:none;
    opacity:0; transition:opacity 0.6s ease;
}
#lce-bg-overlay {
    position:absolute; left:-1px; top:-1px;
    width:${CANVAS_W + 2}px; height:${CANVAS_H + 2}px;
    /* 保持透明以維持桌布原本亮度（不再暗化）。
       仍吸收所有落空的點擊，避免穿透到下方 canvas 上的 BC/WCE 原始物件。 */
    background:transparent;
    pointer-events:auto;
}

/* 點3：三個獨立顯示開關 */
#lce-stage.lce-hide-avatar  .lce-avatar   { display:none; }
#lce-stage.lce-hide-account .lce-acct-acct{ display:none; }
#lce-stage.lce-hide-name    .lce-acct-nm,
#lce-stage.lce-hide-name    .lce-acct-id  { display:none; }

/* ── 文字 ── */
.lce-text {
    display:flex; align-items:center; justify-content:center;
    text-align:center; color:#fff;
    text-shadow:0 2px 8px rgba(0,0,0,0.9);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.lce-title    { font-weight:800; letter-spacing:2px; color:#eaf3ff; text-shadow:0 0 26px rgba(var(--lce-login-accent-rgb,114,20,255),0.55),0 2px 8px rgba(0,0,0,0.9); }
.lce-welcome  { color:#eafff2; }
.lce-status   { color:rgba(210,230,255,0.92); }
.lce-status.error { color:rgba(255,120,120,0.98); }
.lce-note     { color:rgba(200,215,240,0.72); }

/* ── 邊光（淡淡的光暈）──
   兩層陰影疊出「燈管」的感覺：往外散的柔光 + 往內收的一圈內光。
   透明度刻意壓得很低，是要有氛圍而不是要發亮 —— 太強會蓋掉背景圖。
   深底的元件共用這一組，整頁的光感才一致；白底的輸入框另外處理（見 .lce-input），
   內光打在白色上會把欄位染成一片紫。 */
.lce-btn, .lce-select {
    box-shadow:
        0 0 14px rgba(var(--lce-login-accent-rgb,114,20,255),0.22),
        inset 0 0 10px rgba(var(--lce-login-accent-rgb,114,20,255),0.10);
}

/* ── 容器框（帳號密碼區外框）──
   跟按鈕、輸入框吃同一個色系；透明度壓低一點，才不會比裡面的控制項還搶眼。 */
.lce-box {
    border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.55);
    border-radius:14px;
    background:rgba(0,0,0,0.32);
    /* 外框範圍大，光暈跟著放大、再壓淡一點，才不會整塊糊掉 */
    box-shadow:
        0 0 26px rgba(var(--lce-login-accent-rgb,114,20,255),0.16),
        inset 0 0 22px rgba(var(--lce-login-accent-rgb,114,20,255),0.07);
    backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);
}

/* ── 輸入框（帳號用人形圖示、密碼用鎖圖示；圖示放進輸入框內最前面，
      不受背景影響、始終清晰） ── */
.lce-field {
    /* 不要設 position:relative —— 會覆蓋 .lce-el 的 position:absolute 使欄位掉進流內、
       top 變成相對位移而累加偏移。欄位維持 absolute（本身即是圖示的定位容器）。 */
    display:flex; align-items:center;
    pointer-events:auto;
}
.lce-field-icon {
    position:absolute; left:16px; top:50%; transform:translateY(-50%);
    width:32px; height:32px; pointer-events:none;
    display:flex; align-items:center; justify-content:center;
    /* 疊在白色輸入框上，所以要用「壓暗過的色系」才看得清楚；
       色系本身通常偏亮（預設是淡紫），直接拿來畫圖示會糊在白底上。
       兩行 color 是漸進增強：舊瀏覽器吃上面的固定深紫，新的吃 color-mix。 */
    color:#5b3fa8;
    color:color-mix(in srgb, var(--lce-login-accent,#7214ff) 65%, #000);
}
.lce-field-icon svg { width:32px; height:32px; display:block; }
.lce-input {
    flex:1; min-width:0; width:100%; height:100%;
    background:#fff; color:#12121e; -webkit-text-fill-color:#12121e;
    border:1.5px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.5); border-radius:10px;
    padding:0 16px 0 58px; /* 左側留給圖示 */
    font-size:28px; font-family:inherit; outline:none; /* 文字放大 4px */
    user-select:text; -webkit-user-select:text;
    /* 白底：只往外發光，不加內光（內光會把欄位染紫、字也跟著糊） */
    box-shadow:0 0 14px rgba(var(--lce-login-accent-rgb,114,20,255),0.22);
}
/* 聚焦：外圈實邊 + 光暈一起留著，不能只寫實邊 —— 後寫的 box-shadow 會整組蓋掉，
   欄位一被點就突然不發光了。 */
.lce-input:focus {
    border-color:var(--lce-login-accent,#7214ff);
    box-shadow:
        0 0 0 3px rgba(var(--lce-login-accent-rgb,114,20,255),0.22),
        0 0 18px rgba(var(--lce-login-accent-rgb,114,20,255),0.35);
}
/* 密碼遮罩。欄位其實是 type="text"（見 login-ui.js：躲開瀏覽器的密碼管理器），
   靠這個把字遮成圓點；只有在 CSS.supports 通過時才會掛上這個 class。 */
.lce-input.lce-masked { -webkit-text-security:disc; text-security:disc; }

/* ── 按鈕 ── */
.lce-btn {
    pointer-events:auto; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    color:#fff; font-family:inherit; font-weight:700;
    background:rgba(0,0,0,0.5); border:1px solid var(--lce-login-accent,#7214ff); border-radius:12px;
    text-shadow:0 1px 6px rgba(0,0,0,0.7);
    transition:background .15s,border-color .15s,box-shadow .15s;
}
.lce-btn:hover    {
    background:rgba(var(--lce-login-accent-rgb,114,20,255),0.32);
    box-shadow:
        0 0 20px rgba(var(--lce-login-accent-rgb,114,20,255),0.45),
        inset 0 0 12px rgba(var(--lce-login-accent-rgb,114,20,255),0.18);
}
.lce-btn:active   { background:rgba(var(--lce-login-accent-rgb,114,20,255),0.5); }
.lce-btn.primary  { background:rgba(var(--lce-login-accent-rgb,114,20,255),0.28); border-color:rgba(var(--lce-login-accent-rgb,114,20,255),0.85); }
.lce-btn.primary:hover { background:rgba(var(--lce-login-accent-rgb,114,20,255),0.45); }
.lce-btn:disabled { opacity:0.4; cursor:default; box-shadow:none; }

/* ── 語言下拉 ── */
.lce-select {
    pointer-events:auto; cursor:pointer;
    color:#fff; font-family:inherit; font-weight:700;
    background:rgba(0,0,0,0.5); border:1px solid var(--lce-login-accent,#7214ff); border-radius:12px;
    padding:0 12px; outline:none; appearance:auto; -webkit-appearance:auto;
}
.lce-select option { color:#12121e; }

/* ── 帳號區：垂直摩天輪（無外框、無卷軸，按壓拖曳 / 滾輪轉動） ── */
#lce-acct-area {
    pointer-events:auto;
    position:relative; overflow:visible;
    touch-action:none; user-select:none; -webkit-user-select:none;
}
.lce-acct-card {
    position:absolute; left:50%; top:50%;
    width:330px; height:120px;
    transform-origin:center center;
    display:flex; align-items:center; gap:12px;
    padding:10px 14px; border-radius:14px;
    border:1px solid rgba(255,255,255,0.20);
    background:rgba(8,12,22,0.55);
    backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
    cursor:pointer; box-sizing:border-box;
    transition:transform .34s cubic-bezier(.25,.8,.25,1), opacity .34s;
    will-change:transform,opacity;
}
#lce-acct-area.dragging .lce-acct-card { transition:none; }
.lce-acct-card.center {
    border-color:var(--lce-login-accent,#7214ff); background:rgba(var(--lce-login-accent-rgb,114,20,255),0.24);
    box-shadow:
        0 0 22px rgba(var(--lce-login-accent-rgb,114,20,255),0.32),
        inset 0 0 14px rgba(var(--lce-login-accent-rgb,114,20,255),0.12);
}
.lce-acct-card.virtual { cursor:default; }
.lce-acct-card.virtual .lce-avatar { border-style:dashed; color:rgba(255,255,255,0.4); }
.lce-acct-card:not(.center) .lce-acct-del { display:none; }
.lce-avatar {
    flex-shrink:0; width:100px; height:100px; border-radius:12px;
    overflow:hidden; display:flex; align-items:center; justify-content:center;
    background:rgba(var(--lce-login-accent-rgb,114,20,255),0.2); border:1px solid rgba(255,255,255,0.22);
    font-size:46px;
}
.lce-avatar img { width:100%; height:100%; object-fit:cover; display:block; }
.lce-acct-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.lce-acct-acct { font-size:26px; font-weight:700; color:#eaf3ff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lce-acct-nm   { font-size:22px; color:rgba(220,232,255,0.85); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lce-acct-id   { font-size:20px; color:rgba(190,210,240,0.6); }
.lce-acct-del {
    position:absolute; top:6px; right:8px;
    width:26px; height:26px; border-radius:7px;
    background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4);
    color:rgba(255,150,150,0.9); font-size:14px;
    display:flex; align-items:center; justify-content:center; cursor:pointer;
}
.lce-acct-del:hover { background:rgba(239,68,68,0.4); }
.lce-acct-empty {
    color:rgba(255,255,255,0.4); font-size:24px; text-align:center; padding:40px 10px;
}

/* ── 設定浮層（不在 stage 內，固定置中） ── */
#lce-settings-overlay {
    display:none; position:fixed; inset:0; z-index:${Z.SETTINGS};
    background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);
    align-items:center; justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;
    /* 點4：設定頁內容不可選取 */
    user-select:none; -webkit-user-select:none;
}
#lce-settings-overlay.visible { display:flex; }
#lce-settings-box {
    background:rgba(14,16,26,0.97); border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.4);
    border-radius:16px; padding:22px; width:min(420px,90vw);
    display:flex; flex-direction:column; gap:16px;
    box-shadow:0 16px 44px rgba(0,0,0,0.55);
}
.lce-sett-title { font-size:22px; font-weight:700; color:#eaf3ff; }
.lce-sett-row {
    display:flex; align-items:center; justify-content:space-between; gap:12px;
    font-size:17px; color:rgba(220,232,255,0.9);
}
.lce-sett-row input[type=checkbox] { accent-color:var(--lce-login-accent,#7214ff); cursor:pointer; width:20px; height:20px; }
.lce-sett-row select {
    background:rgba(255,255,255,0.06); color:#fff; font-family:inherit; font-size:15px;
    border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.5); border-radius:8px; padding:6px 10px; cursor:pointer; outline:none;
}
.lce-sett-row select option { color:#12121e; }
.lce-sett-color {
    width:52px; height:30px; padding:0; cursor:pointer;
    background:none; border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.5);
    border-radius:8px;
}
.lce-sett-sub { padding-left:14px; }
/* 自訂桌布：網址欄 + 上傳/清除小鈕 + 狀態提示 */
.lce-sett-text {
    width:100%; box-sizing:border-box;
    background:rgba(255,255,255,0.06); color:#fff; font-family:inherit; font-size:14px;
    border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.5); border-radius:8px;
    padding:7px 10px; outline:none;
}
.lce-sett-text:focus { border-color:var(--lce-login-accent,#7214ff); }
.lce-sett-btnrow { display:flex; gap:8px; }
.lce-sett-mini {
    flex:1; padding:7px 10px; cursor:pointer;
    background:rgba(var(--lce-login-accent-rgb,114,20,255),0.18);
    border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.55);
    border-radius:8px; color:#eaf3ff; font-family:inherit; font-size:14px;
}
.lce-sett-mini:hover { background:rgba(var(--lce-login-accent-rgb,114,20,255),0.35); }
.lce-sett-hint { font-size:12px; color:rgba(220,232,255,0.6); min-height:15px; }
.lce-sett-close {
    width:100%; padding:11px; margin-top:4px;
    background:rgba(var(--lce-login-accent-rgb,114,20,255),0.24); border:1px solid rgba(var(--lce-login-accent-rgb,114,20,255),0.6);
    border-radius:10px; color:#eaf3ff; font-size:17px; font-family:inherit; cursor:pointer;
}
.lce-sett-close:hover { background:rgba(var(--lce-login-accent-rgb,114,20,255),0.4); }

/* ══ LCE 直式登入 UI（verticalLogin）════════════════════════════════════════
   直向時 canvas 會被壓成一條，貼著它的 2000×1000 座標系整個版面就爛了。
   所以這裡把 stage 從 canvas 座標系整個拆下來，改成滿版 flex 直排。
   尺寸對齊 MPL 直式版面（卡寬 84 / 表單 420 / 帳號列 560 / 標題 28px …）。

   buildUI() 用 place() 寫的是 inline style（left/top/width/height/font-size），
   優先級比 class 高，所以下面必須用 !important 才蓋得過。DOM 順序與視覺順序不同，
   靠 order 重排：標題 → 狀態 → 帳號列 → 表單 → 按鈕 → 建立角色 → 底部。
   ═════════════════════════════════════════════════════════════════════════ */
#lce-stage[data-orient="portrait"] {
    position:fixed; inset:0;
    width:100%; height:100%;
    transform:none !important;
    display:flex; flex-direction:column; align-items:center;
    justify-content:flex-start; gap:0;
    padding:0; overflow:hidden;
    pointer-events:auto;
}
/* 解除 place() 的絕對定位，交給 flex 排 */
#lce-stage[data-orient="portrait"] .lce-el {
    position:static !important;
    left:auto !important; top:auto !important;
    width:auto !important; height:auto !important;
    font-size:inherit !important;
    flex-shrink:0;
}
/* 背景圖與遮罩維持絕對定位、滿版（直向的 stage 本身就是滿版，不吃 canvas 座標） */
#lce-stage[data-orient="portrait"] #lce-bg-img,
#lce-stage[data-orient="portrait"] #lce-bg-video,
#lce-stage[data-orient="portrait"] #lce-bg-overlay {
    position:absolute !important; inset:0 !important;
    width:100% !important; height:100% !important;
    object-fit:cover; object-position:center;
}
#lce-stage[data-orient="portrait"] #lce-bg-overlay { background:rgba(0,0,0,0.38); z-index:0; }
#lce-stage[data-orient="portrait"] > *:not(#lce-bg-img):not(#lce-bg-video):not(#lce-bg-overlay) { position:relative; z-index:1; }

/* ── 頂部：標題 + 歡迎 + 狀態 ──
   標題與底部列各掛一個 margin-top:auto：flex 會把剩餘空間平均分給所有 auto 邊距，
   於是內容整塊垂直置中、底部列貼底，不會像單一個 auto 那樣把留白全堆在底部列上方。
   padding-top 保底，畫面很矮時仍留得住上緣間距。 */
#lce-stage[data-orient="portrait"] .lce-title {
    order:1; margin-top:auto; padding-top:20px;
    font-size:28px !important; font-weight:700; letter-spacing:2px;
    text-shadow:0 0 24px rgba(var(--lce-login-accent-rgb,114,20,255),0.50);
}
#lce-stage[data-orient="portrait"] .lce-welcome {
    order:2; margin-top:8px; font-size:17px !important; opacity:0.8;
}
#lce-stage[data-orient="portrait"] .lce-status {
    order:3; margin-top:8px; min-height:26px; font-size:19px !important;
}

/* ── 帳號列：水平摩天輪（軸向由 setCarouselAxis('x') 切換，輪徑見 account-carousel.js） ──
   卡片沿用橫式的設計（頭像 + 資訊橫排），但橫式的 330×120 是 canvas 單位、會被 stage
   縮放；直向沒有縮放，直接用會整張佔滿手機寬度，所以這裡重新給一組 px 尺寸。 */
#lce-stage[data-orient="portrait"] #lce-acct-area {
    order:4;
    width:100% !important; max-width:560px;
    height:132px !important;
    margin:12px 0 6px;
    position:relative !important;
}
#lce-stage[data-orient="portrait"] .lce-acct-card {
    width:160px !important; height:60px !important;
    padding:6px 8px !important; gap:7px !important;
    border-radius:11px !important;
}
#lce-stage[data-orient="portrait"] .lce-avatar {
    width:44px !important; height:44px !important; border-radius:8px !important;
}
#lce-stage[data-orient="portrait"] .lce-acct-nm   { font-size:13px !important; }
#lce-stage[data-orient="portrait"] .lce-acct-acct,
#lce-stage[data-orient="portrait"] .lce-acct-id   { font-size:10px !important; }
#lce-stage[data-orient="portrait"] .lce-acct-del  {
    width:16px !important; height:16px !important; font-size:9px !important;
    top:3px !important; right:3px !important;
}
#lce-stage[data-orient="portrait"] .lce-acct-empty { font-size:14px !important; }

/* ── 表單 ── */
#lce-stage[data-orient="portrait"] .lce-box { display:none !important; }  /* 橫式的裝飾外框，直向不需要 */
/* 兩個欄位同 order，flex 會照 DOM 順序排（帳號 → 密碼），不必個別指定。
   position 必須是 relative 而非上面的 static —— .lce-field-icon 是 absolute 定位，
   要靠欄位當定位容器；設成 static 的話圖示會改去對齊 stage，直接飛到畫面角落。 */
#lce-stage[data-orient="portrait"] .lce-field {
    order:5; position:relative !important;
    width:min(88vw,420px) !important; height:52px !important;
    margin-top:10px;
}
#lce-stage[data-orient="portrait"] .lce-field-icon { left:14px; width:26px; height:26px; }
#lce-stage[data-orient="portrait"] .lce-field-icon svg { width:26px; height:26px; }
#lce-stage[data-orient="portrait"] .lce-input { font-size:18px !important; padding:0 14px 0 48px !important; }

#lce-stage[data-orient="portrait"] #lce-btn-login {
    order:7; width:min(88vw,420px) !important; margin-top:18px;
    padding:12px !important; font-size:21px !important; font-weight:700;
}

/* 保存 / 重設：靠 #lce-row-save 併成一列 */
#lce-stage[data-orient="portrait"] #lce-row-save {
    order:8; display:flex; gap:10px; margin-top:10px;
    width:min(88vw,420px);
}
#lce-stage[data-orient="portrait"] #lce-row-save .lce-btn {
    flex:1; min-width:0; padding:11px !important; font-size:14px !important;
}

#lce-stage[data-orient="portrait"] #lce-btn-register {
    order:9; width:min(70vw,340px) !important;
    padding:11px !important; font-size:18px !important; margin-top:16px;
}
#lce-stage[data-orient="portrait"] .lce-note {
    order:10; margin-top:14px; font-size:13px !important; opacity:0.55; padding:0 20px;
}

/* ── 底部：語言 + 設定。第二個 margin-top:auto（另一個在標題上），兩者平分剩餘空間 ── */
#lce-stage[data-orient="portrait"] #lce-row-bottom {
    order:11; display:flex; gap:10px; align-items:center; justify-content:center;
    margin-top:auto; margin-bottom:20px; padding-top:16px;
    width:min(92vw,560px);
}
#lce-stage[data-orient="portrait"] #lce-lang-select {
    font-size:16px !important; padding:7px 20px 7px 10px !important;
}
#lce-stage[data-orient="portrait"] #lce-btn-settings {
    padding:0 18px !important; height:38px !important; font-size:16px !important;
}
/* row 在橫式必須完全透明：不佔位、不攔點擊，子元素照舊絕對定位 */
#lce-stage[data-orient="landscape"] .lce-row { position:static; pointer-events:none; }
    `);
}
