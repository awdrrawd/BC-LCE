// ════════════════════════════════════════════════════════════════════════════
// 聊天與社交
//   changeOthersPose        替他人改姿勢（點選角色 → 左上姿勢選單）
//   chatInputHistory        上/下鍵叫回歷史發言
//   atMentionSelfName       @ 開頭＝動作訊息並自帶自己名字（@@＝不帶名字）
//   profileTimezoneOverhead 對方 BIO 有 GMT/UTC±N 時，頭頂顯示其當地時間
//   commandButtons          聊天中的 /指令(粉) 與 #房間#(藍) 轉可點按鈕
//   whisperItalic           悄悄話模式時輸入框改斜體
// 前五項移植自 Liko - CRA；whisperItalic 同 WCE（.bce-whisper-input → font-style: italic）。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';

const LOG = '🐈‍⬛ [LCE]';
const STYLE_ID = 'lce-chat-style';
const HIST_CLASS = 'lce-hist-input';
const WHISPER_CLASS = 'lce-whisper-input';

// ───────────────────────── 常數（沿用 CRA 的幾何與設定）─────────────────────────
const CFG = {
    ANCHOR_X: 400, ANCHOR_Y: 10, TOGGLE_W: 64, TOGGLE_H: 64,
    ICON_SIZE: 64, ICON_PAD: 3, ICON_GAP: 6, ICON_COL_X: 400, ICON_START_Y: 84,
    POSE_COOLDOWN: 800,
    HISTORY_MAX: 80,
    SCAN_INTERVAL: 500,
    TZ_RE: /(?:gmt|utc)\s*([+-])\s*(\d{1,2})/i,
};

const POSES = [
    'BaseUpper', 'Yoked', 'OverTheHead', 'BackBoxTie', 'BackElbowTouch', 'BackCuffs',
    'BaseLower', 'LegsClosed', 'Kneel', 'KneelingSpread', 'AllFours',
];

function iconsPath() {
    let href = window.location.href;
    if (!href.endsWith('/')) href = href.substring(0, href.lastIndexOf('/') + 1);
    return `${href}Icons/`;
}
const poseIconURL = (name) => `${iconsPath()}Poses/${name}.png`;

// ───────────────────────── 狀態 ─────────────────────────
let poseCooldown = 0;
let poseExpanded = false;
let descElement = null;
let scanTimer = null;
const hist = { list: [], index: null, draft: '' };
const tzCache = new Map();   // MemberNumber -> { desc, off }

// ───────────────────────── 工具 ─────────────────────────
function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn(LOG, 'chat hook 未掛上:', name, e?.message ?? e); }
}

function nick(c) {
    try { return (typeof CharacterNickname === 'function') ? CharacterNickname(c) : (c.Nickname || c.Name); }
    catch { return (c && (c.Nickname || c.Name)) || '?'; }
}

const getChatInput = () => document.getElementById('InputChat');

/** 送出一則自訂動作訊息（CRA 的 sendActionText）。 */
function sendActionText(text) {
    if (!text || typeof ServerSend !== 'function') return;
    ServerSend('ChatRoomChat', {
        Content: 'CUSTOM_SYSTEM_ACTION',
        Type: 'Action',
        Dictionary: [{ Tag: 'MISSING TEXT IN "Interface.csv": CUSTOM_SYSTEM_ACTION', Text: text }],
    });
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#InputChat.${HIST_CLASS}{background:#1c1230 !important;color:#ffcf6b !important;outline:2px solid #9d4edd !important;outline-offset:-2px;}
.${WHISPER_CLASS}{font-style:italic;}
`;
    document.head.appendChild(s);
}

// ───────────────────────── 替他人改姿勢 ─────────────────────────
function poseDisabled(target, name) {
    if (poseCooldown > Date.now()) return true;
    try {
        if (target.Pose && target.Pose.includes(name)) return true;
        if (typeof PoseCanChangeUnaided === 'function' && !PoseCanChangeUnaided(target, name)) return true;
    } catch { /* ignore */ }
    return false;
}

function changePoseOnTarget(target, poseName) {
    const now = Date.now();
    try {
        if (poseCooldown > now) return false;
        if (typeof Player === 'undefined' || !Player.CanInteract()) return false;
        if (!target || target.IsPlayer()) return false;
        if (target.HasOnBlacklist && target.HasOnBlacklist(Player)) return false;
        if (typeof ServerChatRoomGetAllowItem === 'function' && !ServerChatRoomGetAllowItem(Player, target)) return false;
        if (typeof PoseCanChangeUnaided === 'function' && !PoseCanChangeUnaided(target, poseName)) return false;
        if (target.Pose && target.Pose.includes(poseName)) return false;

        PoseSetActive(target, poseName, false, true);
        if (typeof ChatRoomCharacterUpdate === 'function') ChatRoomCharacterUpdate(target);
        poseCooldown = now + CFG.POSE_COOLDOWN;

        sendActionText(T('pose_action')
            .replace('{src}', nick(Player))
            .replace('{tgt}', nick(target))
            .replace('{pose}', T(`pose_${poseName}`)));
        return true;
    } catch (e) { console.warn(LOG, '改姿勢失敗', e); return false; }
}

const poseIconRect = (i) => [CFG.ICON_COL_X, CFG.ICON_START_Y + i * (CFG.ICON_SIZE + CFG.ICON_GAP), CFG.ICON_SIZE, CFG.ICON_SIZE];

function isPoseTarget() {
    return typeof CurrentCharacter !== 'undefined' && CurrentCharacter
        && !CurrentCharacter.IsPlayer() && CurrentCharacter.IsOnline && CurrentCharacter.IsOnline();
}

function drawPoseMenu() {
    if (typeof DrawButton !== 'function' || !isPoseTarget()) return;
    DrawButton(CFG.ANCHOR_X, CFG.ANCHOR_Y, CFG.TOGGLE_W, CFG.TOGGLE_H, T('pose_label'),
        poseExpanded ? '#5323a1' : 'White', '', T(poseExpanded ? 'pose_toggle_on' : 'pose_toggle_off'));
    if (!poseExpanded) return;
    for (let i = 0; i < POSES.length; i++) {
        const [x, y, w, h] = poseIconRect(i);
        const disabled = poseDisabled(CurrentCharacter, POSES[i]);
        DrawButton(x, y, w, h, '', disabled ? 'Grey' : 'White', '', T(`pose_${POSES[i]}`), disabled);
        if (typeof DrawImageResize === 'function') {
            const p = CFG.ICON_PAD;
            DrawImageResize(poseIconURL(POSES[i]), x + p, y + p, w - 2 * p, h - 2 * p);
        }
    }
}

function clickPoseMenu() {
    if (typeof MouseIn !== 'function' || !isPoseTarget()) return false;
    if (MouseIn(CFG.ANCHOR_X, CFG.ANCHOR_Y, CFG.TOGGLE_W, CFG.TOGGLE_H)) { poseExpanded = !poseExpanded; return true; }
    if (poseExpanded) {
        for (let i = 0; i < POSES.length; i++) {
            const [x, y, w, h] = poseIconRect(i);
            if (MouseIn(x, y, w, h)) { changePoseOnTarget(CurrentCharacter, POSES[i]); return true; }
        }
    }
    return false;
}

// ───────────────────────── 輸入歷史 ─────────────────────────
function setHistMode(on) { getChatInput()?.classList.toggle(HIST_CLASS, !!on); }
function resetHistoryNav() { hist.index = null; setHistMode(false); }

function pushHistory(text) {
    text = (text || '').trim();
    if (!text) return;
    if (hist.list[hist.list.length - 1] === text) return;   // 不記連續重複
    hist.list.push(text);
    if (hist.list.length > CFG.HISTORY_MAX) hist.list.shift();
}

function handleHistoryKey(e) {
    if (!getFeature('chatInputHistory')) return;
    const ic = getChatInput();
    if (!ic || e.target !== ic) return;
    if (e.shiftKey || e.ctrlKey || e.altKey) return;
    if (hist.list.length === 0) return;

    if (e.key === 'ArrowUp') {
        // 僅在游標位於開頭、或已在瀏覽歷史時接管（避免干擾多行編輯）
        if (hist.index === null && ic.selectionStart !== 0) return;
        if (hist.index === null) { hist.draft = ic.value; hist.index = hist.list.length; }
        if (hist.index > 0) hist.index--;
        ic.value = hist.list[hist.index] ?? '';
        ic.selectionStart = ic.selectionEnd = ic.value.length;
        setHistMode(true);
        e.preventDefault(); e.stopPropagation();
    } else if (e.key === 'ArrowDown') {
        if (hist.index === null) return;
        hist.index++;
        if (hist.index >= hist.list.length) {
            hist.index = null; ic.value = hist.draft; setHistMode(false);
        } else {
            ic.value = hist.list[hist.index]; setHistMode(true);
        }
        ic.selectionStart = ic.selectionEnd = ic.value.length;
        e.preventDefault(); e.stopPropagation();
    }
}

// ───────────────────────── @ 動作自帶名字 ─────────────────────────
/** 回傳 true = 已攔截，不要走原本送出流程。 */
function handleAtActivity(raw, ic) {
    if (!getFeature('atMentionSelfName')) return false;
    if (!ic || !raw || raw[0] !== '@') return false;
    if (raw.startsWith('@@@')) return false;              // 保留：@@@ 不處理

    let text;
    if (raw.startsWith('@@')) text = raw.slice(2).trim(); // @@ = 純動作，不帶名字
    else {
        const body = raw.slice(1).trim();                 // @ = 動作並在前面加上自己的名字
        text = body ? `${nick(Player)} ${body}` : '';
    }
    if (!text) return false;

    sendActionText(text);
    ic.value = '';
    return true;
}

// ───────────────────────── 頭頂時區 ─────────────────────────
function detectTimezone(C) {
    try {
        if (!C || typeof C.MemberNumber === 'undefined') return null;
        const desc = C.Description || '';
        const cached = tzCache.get(C.MemberNumber);
        if (cached && cached.desc === desc) return cached.off;

        let off = null;
        const m = CFG.TZ_RE.exec(desc);
        if (m) {
            const n = parseInt(m[1] + m[2], 10);
            if (!isNaN(n) && n >= -12 && n <= 12) off = n;
        }
        tzCache.set(C.MemberNumber, { desc, off });
        return off;
    } catch { return null; }
}

function drawTimezoneOverlay(C, charX, charY, zoom) {
    try {
        if (!getFeature('profileTimezoneOverhead')) return;
        if (typeof ChatRoomHideIconState !== 'undefined' && ChatRoomHideIconState >= 1) return;
        const off = detectTimezone(C);
        if (typeof off !== 'number') return;
        const d = new Date(Date.now() + off * 3600000);
        const txt = String(d.getUTCHours()).padStart(2, '0');   // 只顯示兩位數小時
        if (typeof DrawTextFit === 'function') {
            DrawTextFit(txt, charX + 200 * zoom, charY + 25 * zoom, 46 * zoom, 'white', 'black');
        }
    } catch { /* ignore */ }
}

// ───────────────────────── 指令 / 房間 轉按鈕 ─────────────────────────
function createDescElement() {
    if (descElement) return;
    descElement = document.createElement('div');
    descElement.id = 'lceChatDesc';
    Object.assign(descElement.style, {
        position: 'fixed', left: '0px', top: '0px', color: 'white',
        background: 'rgb(96, 10, 182)', fontSize: '20px', fontFamily: 'Comfortaa',
        padding: '8px', textAlign: 'center', width: '100%', display: 'none', zIndex: 1000,
    });
    document.body.appendChild(descElement);
}
function showDesc(html) { if (descElement) { descElement.innerHTML = html; descElement.style.display = 'block'; } }
function hideDesc() { if (descElement) descElement.style.display = 'none'; }

const normalizeCmd = (s) => s.normalize('NFKC').trim().toLowerCase();
function findCommand(cmdKey) {
    if (!Array.isArray(window.Commands)) return null;
    return Commands.find(c => normalizeCmd(c.Tag) === normalizeCmd(cmdKey) || c.Tag === cmdKey);
}

function joinRoom(name) {
    const clean = (name || '').trim();
    try {
        if (typeof ChatRoomLeave === 'function') ChatRoomLeave();
        if (typeof CommonSetScreen === 'function') CommonSetScreen('Online', 'ChatSearch');
        if (typeof ServerSend === 'function') ServerSend('ChatRoomJoin', { Name: clean });
    } catch (e) { console.warn(LOG, '加入房間失敗', e); }
}

function bindSpanEvents(element) {
    element.querySelectorAll('.lceCmd[data-cmd]').forEach(el => {
        if (el.dataset.bound) return;
        el.dataset.bound = '1';
        const cmd = el.dataset.cmd, desc = el.dataset.desc;
        el.addEventListener('click', () => {
            const input = getChatInput();
            if (input) { input.value = `${cmd} `; input.focus(); }
        });
        el.addEventListener('mouseenter', () => showDesc(`${desc || cmd}<br>${T('desc_paste_cmd')}`));
        el.addEventListener('mouseleave', hideDesc);
    });
    element.querySelectorAll('.lceRoom[data-room]').forEach(el => {
        if (el.dataset.bound) return;
        el.dataset.bound = '1';
        const room = el.dataset.room;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); joinRoom(room); });
        el.addEventListener('mouseenter', () => showDesc(T('desc_join_room').replace('{room}', room)));
        el.addEventListener('mouseleave', hideDesc);
    });
}

function processMessage(element) {
    if (!element || element.dataset.lceDone === '1') return;
    if (element.dataset.likoProcessed === '1') { element.dataset.lceDone = '1'; return; }  // 避免與其他插件重複處理
    if (element.closest && element.closest('a')) return;

    let html = element.innerHTML;
    if (/https?:\/\//i.test(html)) return;
    let changed = false;

    // #房間# → 藍色
    html = html.replace(/#([^#\n\r]{1,50})#/g, (match, room) => {
        if (room && room.trim().length > 0) {
            changed = true;
            return `<span class="lceRoom" style="color:#65b5ff;cursor:pointer;" data-room="${room.trim()}">🚪${room}🚪</span>`;
        }
        return match;
    });

    // /指令 → 粉色（需為已註冊指令）
    html = html.replace(/(^|\s)(\/[\p{L}\p{N}_-]+)/gu, (match, prefix, cmdText) => {
        const cmdObj = findCommand(cmdText.slice(1));
        if (cmdObj) {
            changed = true;
            const desc = (cmdObj.Description || '').replace(/"/g, '&quot;');
            return `${prefix}<span class="lceCmd" style="color:#ff65f2;cursor:pointer;" data-cmd="${cmdText}" data-desc="${desc}">${cmdText}</span>`;
        }
        return match;
    });

    if (changed) { element.innerHTML = html; bindSpanEvents(element); }
    element.dataset.lceDone = '1';
}

function scanChat() {
    if (!getFeature('commandButtons')) return;
    try { document.querySelectorAll('.chat-room-message-content').forEach(processMessage); }
    catch { /* ignore */ }
}

// ───────────────────────── 悄悄話斜體 ─────────────────────────
function updateWhisperItalic() {
    const ic = getChatInput();
    if (!ic) return;
    const whispering = typeof ChatRoomTargetMemberNumber !== 'undefined'
        && ChatRoomTargetMemberNumber != null && ChatRoomTargetMemberNumber >= 0;
    ic.classList.toggle(WHISPER_CLASS, !!(whispering && getFeature('whisperItalic')));
}

// ───────────────────────── 安裝 ─────────────────────────
let installed = false;

export function installChat() {
    if (installed) return;
    installed = true;
    injectStyle();
    createDescElement();

    // 姿勢選單：畫在點選角色的對話框
    hook('DialogDraw', 4, (args, next) => {
        const r = next(args);
        try { if (getFeature('changeOthersPose')) drawPoseMenu(); } catch (e) { console.warn(LOG, e); }
        return r;
    });
    hook('DialogClick', 4, (args, next) => {
        try { if (getFeature('changeOthersPose') && clickPoseMenu()) return; } catch (e) { console.warn(LOG, e); }
        return next(args);
    });
    hook('DialogLeave', 4, (args, next) => { poseExpanded = false; return next(args); });

    // 頭頂時區
    if (typeof ChatRoomCharacterViewDrawOverlay !== 'undefined') {
        hook('ChatRoomCharacterViewDrawOverlay', 4, (args, next) => {
            const r = next(args);
            try { drawTimezoneOverlay(args[0], args[1], args[2], args[3]); } catch { /* ignore */ }
            return r;
        });
    }

    // 送出攔截：記錄歷史 + @ 動作
    hook('ChatRoomSendChat', 4, (args, next) => {
        try {
            const ic = getChatInput();
            const raw = ic ? ic.value : '';
            if (raw && raw.trim() && getFeature('chatInputHistory')) pushHistory(raw);
            resetHistoryNav();
            if (handleAtActivity(raw, ic)) return;   // @ → 動作訊息，攔截原送出
        } catch (e) { console.warn(LOG, e); }
        return next(args);
    });

    // 悄悄話斜體：每幀依目標更新
    hook('ChatRoomRun', 4, (args, next) => {
        const r = next(args);
        try { updateWhisperItalic(); } catch { /* ignore */ }
        return r;
    });

    // 輸入歷史：方向鍵（capture 攔截，避免與原生衝突）
    document.addEventListener('keydown', (e) => { try { handleHistoryKey(e); } catch { /* ignore */ } }, true);
    // 使用者真的打字時離開歷史模式（programmatic 設值不會觸發 input）
    document.addEventListener('input', (e) => { if (e.target && e.target.id === 'InputChat') resetHistoryNav(); });
    document.addEventListener('click', hideDesc);

    // 指令 / 房間 轉按鈕
    scanTimer = setInterval(scanChat, CFG.SCAN_INTERVAL);
}
