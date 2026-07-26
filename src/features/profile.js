// ════════════════════════════════════════════════════════════════════════════
// 個人資料（BIO）
//   richOnlineProfile  ：把 BIO 顯示成可點連結／內嵌圖片的唯讀檢視（移植 WCE）
//   profileEditProtect ：BIO 預設不可編輯，按下編輯鈕才解鎖，避免誤改
//
// 兩者共用「同一顆切換鈕」（位置/圖示同 WCE）：
//   檢視狀態 = 富文本唯讀檢視（richOnlineProfile 開）或唯讀輸入框（僅 profileEditProtect 開）
//   編輯狀態 = BC 原生輸入框，可編輯
//
// ── 與 WCE 並存 ──
// WCE 也有一模一樣的 BIO 富文本／編輯鈕（同位置、同 hook）。之前的做法是「偵測到 WCE 就整個讓位」，
// 但那樣一來檢視畫面變成 WCE 那張未染色的羊皮紙、且「同意/取消」會直接離開 BIO ——都不是我們要的。
// 改成：LCE 一律自己管（畫自己的染色檢視、掌控編輯流程），並用 CSS 把 WCE 的富文本層
// (#bceRichOnlineProfile) 藏起來。WCE（優先權較低、在 next 內層）誤以為仍在檢視、每幀想把輸入框
// 藏起來，我們在 next 之後（外層、最後跑）再把它顯示回來蓋過去，編輯就不會被 WCE 搶著關掉。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { positionElement, injectStyle } from '../core/util.js';
import { processChatAugmentsForLine } from './chat-augments.js';

const LCE_OWNS_CLASS = 'lce-owns-bio';   // 掛在 body：LCE 正在管 BIO 時藏掉 WCE 的富文本層
const TA_ID = 'DescriptionInput';        // BC 的 BIO 輸入框
const RICH_ID = 'lceRichOnlineProfile';  // 我們的唯讀富文本檢視
const BTN = [90, 60, 90, 90];            // 與 WCE 相同的切換鈕位置
const SAVE_BTN = [1720, 60, 90, 90];     // BC 的「接受並儲存」鈕
const CANCEL_BTN = [1820, 60, 90, 90];   // BC 的「取消/離開」鈕

let editing = false;                     // false = 檢視/保護中

function hook(name, priority, fn) {
    try { modApi.hookFunction(name, priority, fn); }
    catch (e) { console.warn('🐈‍⬛ [LCE] profile hook 未掛上:', name, e?.message ?? e); }
}

const richOn = () => !!getFeature('richOnlineProfile');
const protectOn = () => !!getFeature('profileEditProtect');
const anyOn = () => richOn() || protectOn();

/** LCE 是否正在管 BIO：掛/卸 body class，讓 CSS 藏掉 WCE 的富文本層。 */
function setOwns(on) {
    document.body?.classList.toggle(LCE_OWNS_CLASS, !!on);
}

// ───────────────────────── 唯讀輸入框（保護） ─────────────────────────
// 只切換 readOnly，不再改 opacity —— 外觀由主題 CSS 依 :read-only 決定：
// 檢視（唯讀）維持 BC 原色、編輯（可輸入）才染色 + 背景 #6A89A1（見 styles/inputs.scss）。
function setReadOnly(on) {
    const ta = document.getElementById(TA_ID);
    if (!ta) return;
    ta.readOnly = on;
}

// ───────────────────────── 檢視時隱藏 BC 的「儲存(接受改動)」鈕 ─────────────────────────
// BC 在「編輯自己的檔案」時於 (1720,60) 畫「接受並儲存」鈕。保護／檢視狀態下不該出現它 ——
// 把 IsPlayer / IsFullyOwnedByPlayer 在 BC 繪製/點擊當下暫時當成 false，BC 就改畫「檢視他人檔案」
// 的版面（只剩離開鈕，沒有儲存/取消鈕）。編輯狀態不動、儲存鈕照常出現。
// 這段依「輸入框是否可編輯」判斷，與是誰在管理無關 —— WCE 也在時一樣有效。

/** BIO 目前是否處於可編輯狀態（輸入框可見且非唯讀）。 */
function bioEditing() {
    const ta = document.getElementById(TA_ID);
    if (!ta) return false;
    return ta.style.display !== 'none' && !ta.readOnly;
}

/** 檢視狀態時把自己的檔案暫時偽裝成「別人的」，讓 BC 不畫儲存鈕。回傳還原資訊（或 null）。 */
function fakeViewButtons() {
    const sel = typeof InformationSheetSelection !== 'undefined' ? InformationSheetSelection : null;
    if (!sel || typeof sel.IsPlayer !== 'function') return null;
    if (bioEditing()) return null;      // 編輯中 → 保留儲存鈕
    if (!sel.IsPlayer()) return null;   // 不是自己的檔案 → 本來就沒有儲存鈕，不必動
    const own = (k) => (Object.prototype.hasOwnProperty.call(sel, k) ? sel[k] : undefined);
    const saved = { sel, isPlayer: own('IsPlayer'), owned: own('IsFullyOwnedByPlayer') };
    sel.IsPlayer = () => false;
    if (typeof sel.IsFullyOwnedByPlayer === 'function') sel.IsFullyOwnedByPlayer = () => false;
    return saved;
}

function restoreViewButtons(saved) {
    if (!saved) return;
    const { sel, isPlayer, owned } = saved;
    if (isPlayer !== undefined) sel.IsPlayer = isPlayer; else delete sel.IsPlayer;
    if (owned !== undefined) sel.IsFullyOwnedByPlayer = owned; else delete sel.IsFullyOwnedByPlayer;
}

// ───────────────────────── 富文本檢視 ─────────────────────────
function profileText() {
    return OnlineProfileMode === 'Description' ? OnlineProfileTextDesc : OnlineProfileTextOwnersNotes;
}

function showTextArea(show) {
    const ta = document.getElementById(TA_ID);
    if (ta) ta.style.display = show ? '' : 'none';
}

function resizeRich() {
    positionElement(RICH_ID, 36, 100, 160, 1790, 750);
}

function enableRich() {
    showTextArea(false);
    let div = document.getElementById(RICH_ID);
    if (!div) {
        div = document.createElement('div');
        div.id = RICH_ID;
        div.classList.add('lce-rich-textarea');
        document.body.append(div);
    }
    div.textContent = profileText();
    processChatAugmentsForLine(div, () => false);
    resizeRich();
}

function disableRich() {
    document.getElementById(RICH_ID)?.remove();
    showTextArea(true);
}

/** 進入檢視（唯讀）狀態。 */
function enterViewMode() {
    editing = false;
    setOwns(true);
    if (richOn()) enableRich();
    else if (protectOn()) { disableRich(); setReadOnly(true); }
}

/** 進入編輯狀態。 */
function enterEditMode() {
    editing = true;
    setOwns(true);
    disableRich();
    setReadOnly(false);
}

function cleanup() {
    editing = false;
    setOwns(false);
    disableRich();
    setReadOnly(false);
}

// ───────────────────────── 儲存／取消（不離開 BIO 畫面）─────────────────────────
// BC 原生：編輯自己的檔案時，(1720) 接受並儲存、(1820) 取消，兩者都會離開 BIO 畫面。
// 使用者要的是：同意/取消只離開「編輯狀態」、回到檢視，離開 BIO 才靠 EXIT 鈕。
// 所以在編輯狀態攔下這兩顆的點擊，自己做儲存/丟棄，再回檢視、不呼叫 BC 的離開流程。

/** 把輸入框內容存起來並同步伺服器（複製 BC OnlineProfileExit(true) 的儲存段，但不離開畫面）。 */
function saveDesc() {
    try {
        const ev = String(ElementValue(TA_ID) ?? '').trim();
        if (OnlineProfileMode === 'Description') OnlineProfileTextDesc = ev.slice(0, OnlineProfileTextDescMaxLen);
        else OnlineProfileTextOwnersNotes = ev.slice(0, OnlineProfileTextOwnersNotesMaxLen);

        const sel = typeof InformationSheetSelection !== 'undefined' ? InformationSheetSelection : null;
        if (sel && sel.Description !== OnlineProfileTextDesc && sel.IsPlayer?.()) {
            sel.Description = OnlineProfileTextDesc;
            let Description = OnlineProfileTextDesc;
            const magic = typeof ONLINE_PROFILE_DESCRIPTION_COMPRESSION_MAGIC !== 'undefined'
                ? ONLINE_PROFILE_DESCRIPTION_COMPRESSION_MAGIC : '';
            if (magic && typeof LZString !== 'undefined') {
                const comp = magic + LZString.compressToUTF16(Description);
                if (comp.length < Description.length || Description.startsWith(magic)) Description = comp;
            }
            if (typeof ServerAccountUpdate !== 'undefined') ServerAccountUpdate.QueueData({ Description });
        }
        if (typeof CharacterSetOwnersNotes === 'function' && sel) {
            CharacterSetOwnersNotes(sel, OnlineProfileTextOwnersNotes);
        }
    } catch (e) { console.warn('🐈‍⬛ [LCE] 儲存 BIO 失敗:', e); }
}

/** 丟棄本次編輯：用目前 mode 的已存值重載輸入框（BC 的 OnlineProfileLoadTextArea）。 */
function cancelEdit() {
    try {
        const ta = document.getElementById(TA_ID);
        if (ta && typeof OnlineProfileLoadTextArea === 'function') OnlineProfileLoadTextArea(ta);
    } catch (e) { console.warn('🐈‍⬛ [LCE] 取消編輯失敗:', e); }
}

let installed = false;

export function installProfile() {
    if (installed) return;
    installed = true;

    // LCE 管 BIO 時藏掉 WCE 的富文本層（用 !important 蓋過它的 inline 樣式），只留我們自己那張染色檢視。
    injectStyle('lce-profile-style', `body.${LCE_OWNS_CLASS} #bceRichOnlineProfile { display: none !important; }`);

    hook('OnlineProfileLoad', 10, (args, next) => {
        const ret = next(args);
        try { if (anyOn()) enterViewMode(); } catch (e) { console.warn('🐈‍⬛ [LCE]', e); }
        return ret;
    });

    hook('OnlineProfileRun', 10, (args, next) => {
        // 隱藏儲存鈕（檢視狀態）——獨立於下方管理，即使 WCE 也在也生效
        const faked = fakeViewButtons();
        try {
            if (!anyOn()) return next(args);
            DrawButton(...BTN, '', 'White', 'Icons/Crafting.png', T(editing ? 'profile_edit_on' : 'profile_edit_off'));
            const ret = next(args);
            // BC/WCE 每幀可能重建或藏起元素，這裡（最外層、最後跑）把狀態蓋回來：
            try {
                if (editing) {
                    // WCE 誤以為仍在檢視、會把輸入框藏起來 —— 強制顯示、可編輯，蓋過它
                    showTextArea(true); setReadOnly(false);
                } else if (richOn()) {
                    showTextArea(false); resizeRich();
                } else if (protectOn()) {
                    showTextArea(true); setReadOnly(true);
                }
            } catch { /* ignore */ }
            return ret;
        } finally { restoreViewButtons(faked); }
    });

    hook('OnlineProfileClick', 10, (args, next) => {
        const faked = fakeViewButtons();
        try {
            if (!anyOn()) return next(args);
            // 編輯鈕：切換編輯／檢視
            if (MouseIn(...BTN)) {
                if (editing) enterViewMode(); else enterEditMode();
                return true;
            }
            // 編輯狀態時，「接受並儲存 / 取消」只退出編輯、回到檢視，不離開 BIO 畫面。
            // （離開 BIO 仍靠檢視狀態才出現的 EXIT 鈕。）
            if (editing && MouseIn(...SAVE_BTN)) { saveDesc(); enterViewMode(); return true; }
            if (editing && MouseIn(...CANCEL_BTN)) { cancelEdit(); enterViewMode(); return true; }

            const ret = next(args);
            // 切換 Description / Owner notes 後刷新富文本內容
            try {
                if (!editing && richOn() && MouseIn(1620, 60, 90, 90)) {
                    const div = document.getElementById(RICH_ID);
                    if (div) { div.textContent = profileText(); processChatAugmentsForLine(div, () => false); }
                }
            } catch { /* ignore */ }
            return ret;
        } finally { restoreViewButtons(faked); }
    });

    hook('OnlineProfileUnload', 10, (args, next) => { cleanup(); return next(args); });
    // 離開聊天室畫面時 BC 會清元素，順手移除富文本層並卸掉 owns 標記。
    hook('ChatRoomHideElements', 10, (args, next) => { cleanup(); return next(args); });
}
