import { createHook } from '../../core/hooks.js';
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
// WCE richOnlineProfile 啟用時，LCE 整套 BIO 行為避讓（含編輯保護與按鈕）。
// 僅主題 CSS 可染色，不干預 WCE 富文本、輸入框或捲動。
// ════════════════════════════════════════════════════════════════════════════

import { isWceFeatureEnabled, shouldLceHandle } from '../../core/wce-compat.js';
import { createPositionableButton, exposeButton } from '../../core/public-api.js';
import { T } from '../../core/i18n.js';
import { positionElement, injectStyle } from '../../core/util.js';
import { processChatAugmentsForLine } from '../chat/chat-augments.js';

const LCE_OWNS_CLASS = 'lce-owns-bio';     // 掛在 body：LCE 正在管 BIO 時藏掉 WCE 的富文本層
const LCE_EDITING_CLASS = 'lce-bio-editing'; // 掛在 body：編輯狀態，用 !important 強制 textarea 可見（見頂部說明）
const TA_ID = 'DescriptionInput';        // BC 的 BIO 輸入框
const RICH_ID = 'lceRichOnlineProfile';  // 我們的唯讀富文本檢視
const {
    api: editProfileButtonApi,
    getPosition: getEditProfileButtonPosition,
    isHidden: isEditProfileButtonHidden,
    isVisualHidden: isEditProfileButtonVisualHidden,
} = createPositionableButton([90, 60, 90, 90]);
const SAVE_BTN = [1720, 60, 90, 90];     // BC 的「接受並儲存」鈕
const CANCEL_BTN = [1820, 60, 90, 90];   // BC 的「取消/離開」鈕

let ownsBio = false;
let editing = false;                     // false = 檢視/保護中

const hook = createHook('profile');

const richOn = () => shouldLceHandle('richOnlineProfile');
const protectOn = () => shouldLceHandle('profileEditProtect', 'richOnlineProfile');
const anyOn = () => richOn() || protectOn();
// 必須在 fakeViewButtons 暫時覆寫 IsPlayer 之前取得結果。
const editButtonEnabled = () => {
    const target = globalThis.InformationSheetSelection;
    return anyOn() && !!target && (target === globalThis.Player || target.IsPlayer?.() === true);
};

/** LCE 是否正在管 BIO：掛/卸 body class，讓 CSS 藏掉 WCE 的富文本層。 */
function setOwns(on) {
    ownsBio = !!on;
    document.body?.classList.toggle(LCE_OWNS_CLASS, ownsBio);
}

/** 編輯狀態：掛/卸 body class，讓 !important 樣式強制 textarea 可見（擋 WCE 每幀的 display:none）。 */
function setEditingClass(on) {
    document.body?.classList.toggle(LCE_EDITING_CLASS, !!on);
}

// ───────────────────────── 唯讀輸入框（保護） ─────────────────────────
// 只切換 readOnly，不再改 opacity —— 外觀由主題 CSS 依 :read-only 決定：
// 檢視與編輯維持相同底色與文字，編輯僅亮起霓虹邊框（見 styles/inputs.scss）。
function setReadOnly(on) {
    const ta = document.getElementById(TA_ID);
    if (!ta) return;
    ta.readOnly = on;
}

// ───────────────────────── 檢視時隱藏 BC 的「儲存(接受改動)」鈕 ─────────────────────────
// BC 在「編輯自己的檔案」時於 (1720,60) 畫「接受並儲存」鈕。保護／檢視狀態下不該出現它 ——
// 把 IsPlayer / IsFullyOwnedByPlayer 在 BC 繪製/點擊當下暫時當成 false，BC 就改畫「檢視他人檔案」
// 的版面（只剩離開鈕，沒有儲存/取消鈕）。編輯狀態不動、儲存鈕照常出現。
// 僅在 LCE 管理 BIO 時執行；WCE 接管時整個 hook 放行。

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
    setEditingClass(false);
    if (richOn()) enableRich();
    else if (protectOn()) { disableRich(); setReadOnly(true); }
}

/** 進入編輯狀態。 */
function enterEditMode() {
    editing = true;
    setOwns(true);
    setEditingClass(true);
    disableRich();
    setReadOnly(false);
}

function cleanup() {
    if (!ownsBio) return;
    editing = false;
    setOwns(false);
    setEditingClass(false);
    document.getElementById(RICH_ID)?.remove();
    // 交給 WCE 時不改 display，避免打斷其捲動；只解除 LCE 的唯讀狀態。
    if (!isWceFeatureEnabled('richOnlineProfile')) showTextArea(true);
    setReadOnly(false);
}

function syncOwnership() {
    if (!anyOn()) { cleanup(); return false; }
    if (!ownsBio) enterViewMode();
    return true;
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
    exposeButton('EditProfile', { ...editProfileButtonApi, isEnabled: editButtonEnabled });

    // LCE 管 BIO 時藏掉 WCE 的富文本層（用 !important 蓋過它的 inline 樣式），只留我們自己那張染色檢視。
    // 編輯狀態則反過來強制 textarea 可見，壓過 WCE 每幀的 inline display:none（見頂部「卷軸拖不動」說明）。
    injectStyle('lce-profile-style',
        `body.${LCE_OWNS_CLASS} #bceRichOnlineProfile { display: none !important; }\n` +
        `body.${LCE_EDITING_CLASS} #${TA_ID} { display: block !important; }`);

    if (typeof OnlineProfileSetMode === 'function') {
        hook('OnlineProfileSetMode', 10, (args, next) => {
            const result = next(args);
            const ids = OnlineProfile.IDs;
            const mode = OnlineProfile.mode;
            const input = ElementWrap(ids[mode]);
            const save = ElementWrap(ids.saveButton);
            if (!input || !save) return result;
            document.getElementById('lce-profile-edit')?.remove();
            document.getElementById(RICH_ID)?.remove();
            editing = false;
            for (const id of [ids.description, ids.ownersNotes]) ElementWrap(id)?.style.removeProperty('display');
            if (!anyOn()) return result;
            const canEdit = OnlineProfile.canEdit(mode);
            const render = () => {
                setOwns(true);
                input.readOnly = !editing || !canEdit;
                save.hidden = !editing;
                document.getElementById(RICH_ID)?.remove();
                input.style.display = '';
                if (!editing && richOn()) {
                    const preview = document.createElement('div');
                    preview.id = RICH_ID;
                    preview.className = 'lce-rich-textarea';
                    preview.style.cssText = 'overflow:auto;white-space:pre-wrap;height:100%';
                    preview.textContent = input.value;
                    processChatAugmentsForLine(preview, () => false);
                    input.after(preview);
                    input.style.display = 'none';
                }
            };
            if (canEdit && !isEditProfileButtonHidden() && !isEditProfileButtonVisualHidden()) {
                const edit = ElementButton.Create('lce-profile-edit', () => {
                    if (editing) input.value = OnlineProfile[mode]();
                    editing = !editing;
                    render();
                    if (editing) input.focus();
                }, { image: 'Icons/Crafting.png', tooltip: T('profile_edit_off') });
                save.before(edit);
            }
            render();
            return result;
        });
        hook('OnlineProfileExit', 10, (args, next) => {
            if (!editing || !anyOn()) return next(args);
            const mode = OnlineProfile.mode;
            const input = ElementWrap(OnlineProfile.IDs[mode]);
            if (args[0] && OnlineProfile.canEdit(mode)) {
                if (mode === 'description') OnlineProfileSaveDescription(input.value.slice(0, OnlineProfileTextDescMaxLen));
                else CharacterSetOwnersNotes(InformationSheetSelection, input.value.slice(0, OnlineProfileTextOwnersNotesMaxLen));
            } else input.value = OnlineProfile[mode]();
            OnlineProfileSetMode(mode);
        });
        hook('OnlineProfileUnload', 10, (args, next) => {
            editing = false;
            setOwns(false);
            return next(args);
        });
        return;
    }

    hook('OnlineProfileLoad', 10, (args, next) => {
        const ret = next(args);
        try { if (anyOn()) enterViewMode(); else cleanup(); } catch (e) { console.warn('🐈‍⬛ [LCE]', e); }
        return ret;
    });

    hook('OnlineProfileRun', 10, (args, next) => {
        if (!syncOwnership()) return next(args);
        const buttonEnabled = editButtonEnabled();
        const faked = fakeViewButtons();
        try {
            if (buttonEnabled && !isEditProfileButtonHidden() && !isEditProfileButtonVisualHidden()) {
                DrawButton(...getEditProfileButtonPosition(), '', 'White', 'Icons/Crafting.png', T(editing ? 'profile_edit_on' : 'profile_edit_off'));
            }
            const ret = next(args);
            // 在原生繪製後維持 LCE 的檢視／編輯狀態：
            try {
                if (editing) {
                    // LCE 編輯狀態保持輸入框可見、可編輯。
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
        if (!syncOwnership()) return next(args);
        const buttonEnabled = editButtonEnabled();
        const faked = fakeViewButtons();
        try {
            // 編輯鈕：切換編輯／檢視
            if (buttonEnabled && !isEditProfileButtonHidden() && MouseIn(...getEditProfileButtonPosition())) {
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
