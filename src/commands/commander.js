// ════════════════════════════════════════════════════════════════════════════
// Commander —— WCE 指令系統移植（src/functions/commands.ts）
// 排除：toy（buttplug）、uwall/ulist、r/anim/pose（動畫引擎），依需求不搬。
// 保留並改名為 lce 前綴：lcedebug、lcegotoroom；通用指令：exportlooks / importlooks / beep / w / versions。
// 由 misc 的 `commander` 設定開關；於登入後、Commands 就緒時註冊。
// ════════════════════════════════════════════════════════════════════════════

import modApi from '../modsdk.js';
import { MOD_VER, LCE_EXT_KEY } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';
import { isExpressionEngineStarted } from '../features/expressions.js';
import { LOCAL_MARKER } from '../features/local-messages.js';
import { allowExtensionSettingsWrite } from '../features/misc.js';

const LOG = '🐈‍⬛ [LCE]';

function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/**
 * 在聊天室輸出一則本地訊息（不送伺服器）。移植自 WCE fbcChatNotify。
 * lce-local 是給 features/local-messages.js 認的標記（淡紫底 + 黑字）。
 */
export function lceChatNotify(node) {
    const div = document.createElement('div');
    div.setAttribute('class', `ChatMessage lce-notification ${LOCAL_MARKER}`);
    div.setAttribute('data-time', typeof ChatRoomCurrentTime === 'function' ? ChatRoomCurrentTime() : '');
    div.setAttribute('data-sender', Player?.MemberNumber?.toString() ?? '');
    if (typeof node === 'string') div.appendChild(document.createTextNode(node));
    else if (Array.isArray(node)) div.append(...node);
    else div.appendChild(node);
    if (typeof ChatRoomAppendChat === 'function') ChatRoomAppendChat(div);
}

/** 依名稱/會員編號找出房間內角色。移植自 WCE findDrawnCharacters。 */
function findDrawnCharacters(target, limitVisible = false) {
    let baseList = limitVisible ? ChatRoomCharacterDrawlist : ChatRoomCharacter;
    if (typeof ChatRoomMapViewIsActive === 'function' && ChatRoomMapViewIsActive()) {
        baseList = baseList.filter(ChatRoomMapViewCharacterIsVisible);
    }
    if (target == null) return baseList;
    let members;
    if (/^\d+$/u.test(target)) {
        members = [baseList.find(c => c.MemberNumber === parseInt(target))];
    } else {
        members = baseList.filter(c =>
            CharacterNickname(c).split(' ')[0]?.toLowerCase() === target?.toLowerCase()
            || c.Name.split(' ')[0].toLowerCase() === target?.toLowerCase());
    }
    return members.filter(Boolean);
}

/**
 * 無視限制切換/離開房間。
 *
 * 不走 WCE 的 ChatRoomJoinLeash + 搜尋那條路 —— 那條路會 race：
 * ChatSearchQuery 是 `await ServerRoomSearch(...)`，而 ServerRoomSearch 對「同一個查詢
 * 還在進行中」會直接回 ServerInProgressError，ChatSearchQuery 收到 err 就 return，
 * 於是 ChatSearchResultResponse 沒被呼叫 → ChatSearchAutoJoinRoom 沒跑 → leash 沒人理，
 * 人離開了房間卻停在搜尋頁。ChatSearchLoad 自己也會送查詢，所以撞不撞得到看運氣，
 * 這就是「有時候可以、有時候不行」的來源。
 *
 * 改用 BC 自己的加入機制 ServerRoomJoin()：直接送 ChatRoomJoin 並等 "JoinedRoom"，
 * 成功後伺服器的 ChatRoomSync 會自己把畫面切進房間。這正是 BC 重新登入時
 * 回到原房間用的流程（見 Server.js 的 ServerRoomJoin 呼叫處），與搜尋完全無關，
 * 房名大小寫也由伺服器比對。
 */
function gotoRoom(roomName) {
    // 確保 BC 的 leash 自動加入不會插手
    if (typeof ChatRoomJoinLeash !== 'undefined') ChatRoomJoinLeash = '';
    if (typeof DialogLeave === 'function') DialogLeave();
    if (CurrentScreen === 'ChatRoom' && typeof ChatRoomLeave === 'function') ChatRoomLeave(false);

    // 我們是刻意要去別的地方，所以把「上一個房間」清掉：
    // 否則 ChatSearchAutoJoinRoom 的 ReturnToChatRoom 分支會搶著把你拉回剛離開的房間。
    if (typeof ChatRoomSetLastChatRoom === 'function') ChatRoomSetLastChatRoom(null);

    if (!roomName) {
        CommonSetScreen('Room', 'MainHall');
        return;
    }

    if (typeof ServerRoomJoin !== 'function') {
        lceChatNotify('此 BC 版本沒有 ServerRoomJoin，無法直接前往房間。');
        CommonSetScreen('Room', 'MainHall');
        return;
    }

    // 先落到大廳畫面再送加入請求：失敗時人就停在搜尋頁，跟 BC 重登的行為一致。
    Promise.resolve(CommonSetScreen('Online', 'ChatSearch'))
        .then(() => ServerRoomJoin(roomName))
        .then((ret) => {
            if (ret?.err) {
                console.warn(LOG, 'gotoroom 加入失敗:', ret.error);
                lceChatNotify(`無法加入房間 "${roomName}"：${ret.error?.message ?? ret.error?.name ?? '未知錯誤'}`);
            }
        })
        .catch(e => console.warn(LOG, 'gotoroom 失敗:', e));
}

/**
 * 直接跳到 LCE 設定頁。
 * 參數必須是 PreferenceRegisterExtensionSetting 時註冊的 Identifier（見 settings-page.js）。
 * 這個函式自己會處理畫面切換，不需要先 CommonSetScreen。
 */
function openSettings() {
    try {
        if (typeof PreferenceSubscreenExtensionsOpen !== 'function') {
            lceChatNotify('此 BC 版本不支援直接開啟擴充設定頁。');
            return;
        }
        PreferenceSubscreenExtensionsOpen(LCE_EXT_KEY);
    } catch (e) {
        console.warn(LOG, '開啟設定頁失敗:', e);
        lceChatNotify('開啟設定頁失敗，請改從偏好設定 → 擴充組件進入。');
    }
}

// ───────────────── ExtensionSettings 維護（伺服器端存檔空間）─────────────────

const extSettings = () => (typeof Player !== 'undefined' && Player?.ExtensionSettings) || null;

/** 依大小排序的 [鍵名, 位元組]。 */
function extRows(ext) {
    return Object.entries(ext)
        .map(([k, v]) => [k, typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length])
        .sort((a, b) => b[1] - a[1]);
}

/** 聊天室裡的小按鈕。chat-room-div 本身就是 DOM 容器，不需要另外開彈窗。 */
function chatButton(label, onClick, cls = 'lce-cmd-btn') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.onclick = (e) => { e.preventDefault(); onClick(b); };
    return b;
}

/** 列出目前帳號上所有 ExtensionSettings 及其大小，每列附一顆刪除鈕。 */
function listExtSettings() {
    const ext = extSettings();
    if (!ext) { lceChatNotify('讀不到 Player.ExtensionSettings。'); return; }
    const rows = extRows(ext);
    if (!rows.length) { lceChatNotify('目前沒有任何 ExtensionSettings。'); return; }

    const total = rows.reduce((s, [, n]) => s + n, 0);
    const wrap = document.createElement('div');

    const head = document.createElement('div');
    head.textContent = `ExtensionSettings（共 ${rows.length} 筆，合計 ${(total / 1024).toFixed(1)}KB）：`;
    wrap.appendChild(head);

    for (const [key, n] of rows) {
        const row = document.createElement('div');
        row.className = 'lce-setlist-row';
        row.appendChild(chatButton('✖', () => confirmDelete(key), 'lce-cmd-btn lce-del-btn'));
        const text = document.createElement('span');
        text.textContent = ` ${key} — ${(n / 1024).toFixed(1)}KB`;
        row.appendChild(text);
        wrap.appendChild(row);
    }
    lceChatNotify(wrap);
}

/**
 * 刪除指定的 ExtensionSettings。
 * 這會動到「其他插件」存在伺服器上的資料且無法復原，所以一律要求二次確認 ——
 * 確認本身也直接輸出成一則本地訊息，用按鈕控制，不開彈窗。
 */
function confirmDelete(key) {
    const ext = extSettings();
    if (!ext) { lceChatNotify('讀不到 Player.ExtensionSettings。'); return; }
    if (!(key in ext)) { lceChatNotify(`"${key}" 已經不存在了，請重新執行 /lcesetlist。`); return; }

    const size = ((typeof ext[key] === 'string' ? ext[key].length : 0) / 1024).toFixed(1);
    const wrap = document.createElement('div');

    const q = document.createElement('div');
    q.textContent = `確定要刪除 "${key}"（約 ${size}KB）嗎？這會清掉該插件存在伺服器上的資料，且無法復原。`;
    wrap.appendChild(q);

    const bar = document.createElement('div');
    bar.className = 'lce-confirm-bar';
    const done = (msg) => { bar.replaceChildren(); const d = document.createElement('span'); d.textContent = msg; bar.appendChild(d); };
    bar.appendChild(chatButton('刪除', () => { doDelete(key, size); done('（已刪除）'); }, 'lce-cmd-btn lce-del-btn'));
    bar.appendChild(chatButton('取消', () => done('（已取消）')));
    wrap.appendChild(bar);

    lceChatNotify(wrap);
}

function doDelete(key, size) {
    try {
        if (Player.ExtensionSettings[key] === undefined) {
            lceChatNotify(`"${key}" 已經不存在了。`); return;
        }
        // 要讓「鍵本身」從伺服器真正消失，得整包重送 ExtensionSettings：BC 伺服器對 AccountUpdate
        // 的 ExtensionSettings 是整個欄位 $set(取代)，缺席的鍵才會被移除。（dot-notation 單鍵同步
        // 只能把值設成 null、鍵仍留著，刷新後又列出來 —— 那不是真的刪掉。）
        //
        // 走 ServerAccountUpdate 佇列（BC 內部同一條），而不是自己裸送 ServerSend：否則 BC 佇列裡
        // 若還排著含舊 ExtensionSettings 的資料，之後 flush 會把剛刪的鍵又寫回去（先前刪不掉的元兇）。
        // Force=true 立即同步，讓整個送出落在 allowExtensionSettingsWrite 的授權窗口內、通過我們
        // 自己的整包守衛（features/misc.js）。本地 Player.ExtensionSettings 在登入時已載入完整，
        // 用它覆蓋不會抹掉別的插件的鍵。
        delete Player.ExtensionSettings[key];
        allowExtensionSettingsWrite(() => {
            if (typeof ServerAccountUpdate?.QueueData === 'function') {
                ServerAccountUpdate.QueueData({ ExtensionSettings: Player.ExtensionSettings }, true);
            } else if (typeof ServerSend === 'function') {
                ServerSend('AccountUpdate', { ExtensionSettings: Player.ExtensionSettings });
            }
        });
        const left = extRows(Player.ExtensionSettings).reduce((s, [, n]) => s + n, 0);
        lceChatNotify(`已移除 "${key}"（釋出約 ${size}KB，剩餘合計 ${(left / 1024).toFixed(1)}KB）。`
            + ' 該插件下次載入時會重建自己的預設值。可用 /lcesetlist 確認。');
    } catch (e) {
        console.warn(LOG, '刪除失敗:', e);
        lceChatNotify(`刪除 "${key}" 失敗，詳見 console。`);
    }
}

function lceDebug() {
    const info = [];
    info.push(`Browser: ${navigator.userAgent}`);
    info.push(`Game Version: ${typeof GameVersion !== 'undefined' ? GameVersion : '?'}`);
    info.push(`LCE Version: ${MOD_VER}`);
    try {
        const mods = window.bcModSdk?.getModsInfo?.() ?? [];
        info.push(`SDK Mods:\n- ${mods.map(m => `${m.name} @ ${m.version}`).join('\n- ')}`);
    } catch { /* ignore */ }
    info.push(`表情引擎: ${isExpressionEngineStarted() ? '已啟動' : '未啟動'}`
        + ` (自動慾望表情=${getFeature('autoArousalExpression')}, 活動表情=${getFeature('activityExpressions')})`);
    const print = info.join('\n');
    lceChatNotify(`${print}\n\n**已複製到剪貼簿。**`);
    navigator.clipboard?.writeText(print).catch(() => {});
    return print;
}

function exportLooks(target) {
    const targetCharacter = (target ? Character.find(c => c.MemberNumber === parseInt(target)) : Player) ?? null;
    if (!targetCharacter) { lceChatNotify(`找不到會員 ${target}`); return; }
    if (!(typeof FUSAM === 'object' && FUSAM?.modals)) { lceChatNotify('需要 FUSAM 對話框支援。'); return; }

    let includeBinds = false, includeLocks = false, includeBase = false;
    FUSAM.modals.openAsync({ prompt: '包含綑綁物品？', buttons: { cancel: 'No', submit: 'Yes' } })
        .then(([bindSubmit]) => {
            includeBinds = bindSubmit === 'submit';
            if (includeBinds) {
                return FUSAM.modals.openAsync({ prompt: '包含鎖？', buttons: { cancel: 'No', submit: 'Yes' } })
                    .then(([lockSubmit]) => { includeLocks = lockSubmit === 'submit'; });
            }
            return null;
        })
        .then(() => FUSAM.modals.openAsync({ prompt: '包含身高、體型、髮型等？', buttons: { cancel: 'No', submit: 'Yes' } }))
        .then(([baseSubmit]) => {
            includeBase = baseSubmit === 'submit';
            const base = targetCharacter.Appearance.filter(a => a.Asset.Group.IsDefault && !a.Asset.Group.Clothing);
            const clothes = targetCharacter.Appearance.filter(a => a.Asset.Group.Category === 'Appearance' && a.Asset.Group.Clothing);
            const binds = targetCharacter.Appearance.filter(a => a.Asset.Group.Category === 'Item' && !a.Asset.Group.BodyCosplay);
            const appearance = [...clothes];
            if (includeBinds) appearance.push(...binds);
            if (includeBase) appearance.push(...base);
            const looks = appearance.map(i => {
                const property = i.Property ? { ...i.Property } : {};
                if (!includeLocks && property.LockedBy) { delete property.LockedBy; delete property.LockMemberNumber; }
                if (property?.LockMemberNumber) property.LockMemberNumber = Player.MemberNumber;
                return { Group: i.Asset.Group.Name, Name: i.Asset.Name, Color: i.Color, Difficulty: i.Difficulty, Property: property, Craft: i.Craft };
            });
            const exportString = LZString.compressToBase64(JSON.stringify(looks));
            FUSAM.modals.openAsync({
                prompt: '複製下方外觀字串', input: { initial: exportString, readonly: true, type: 'textarea' }, buttons: { submit: 'Done' },
            });
            return navigator.clipboard.writeText(exportString).then(() => lceChatNotify('外觀字串已複製到剪貼簿。'));
        })
        .catch(e => console.warn(LOG, 'exportlooks 失敗:', e));
}

function importLooks() {
    if (!Player.CanChangeOwnClothes() || !OnlineGameAllowChange()) {
        lceChatNotify('綑綁中或線上遊戲時無法變更外觀。'); return;
    }
    if (!(typeof FUSAM === 'object' && FUSAM?.modals)) { lceChatNotify('需要 FUSAM 對話框支援。'); return; }
    FUSAM.modals.open({
        prompt: '貼上你的外觀字串', input: { initial: '', readonly: false, type: 'textarea' },
        callback: (act, bundleString) => {
            if (act !== 'submit') return;
            if (!bundleString) { lceChatNotify('未提供外觀字串。'); return; }
            try {
                const bundle = bundleString.startsWith('[') ? parseJSON(bundleString) : parseJSON(LZString.decompressFromBase64(bundleString));
                if (!Array.isArray(bundle) || bundle.length === 0 || !bundle[0].Group) throw new Error('Invalid bundle');
                for (const item of Player.Appearance) {
                    if (item.Property?.LockedBy && !DialogCanUnlock(Player, item)) {
                        const itemBundle = { Group: item.Asset.Group.Name, Name: item.Asset.Name, Color: item.Color, Difficulty: item.Difficulty, Property: item.Property };
                        const idx = bundle.findIndex(v => v.Group === item.Asset.Group.Name);
                        if (idx < 0) bundle.push(itemBundle); else bundle[idx] = itemBundle;
                    }
                }
                ServerAppearanceLoadFromBundle(Player, 'Female3DCG', bundle, Player.MemberNumber);
                ChatRoomCharacterUpdate(Player);
                lceChatNotify('已套用外觀。');
            } catch (e) { console.error(e); lceChatNotify('無法解析外觀字串。'); }
        },
    });
}

function beep(command, target) {
    const [, , ...message] = command.split(' ');
    const msg = message?.join(' ');
    if (!target || !msg || !/^\d+$/u.test(target)) { lceChatNotify('未提供 beep 對象或訊息。'); return; }
    const targetMemberNumber = parseInt(target);
    if (!Player.FriendList?.includes(targetMemberNumber)) { lceChatNotify(`${target} 不在你的好友清單。`); return; }
    const targetName = Player.FriendNames?.get(targetMemberNumber);
    ServerSend('AccountBeep', { BeepType: '', MemberNumber: targetMemberNumber, Message: msg, IsSecret: true });
    FriendListBeepLog.push({ MemberNumber: targetMemberNumber, MemberName: targetName ?? `unknown (${targetMemberNumber})`, Sent: true, Private: false, Time: new Date(), Message: msg });
    const beepId = FriendListBeepLog.length - 1;
    const link = document.createElement('a');
    link.href = `#beep-${beepId}`;
    link.onclick = (e) => { e.preventDefault(); FriendListShowBeep(beepId); };
    link.textContent = `(→ ${targetName ?? 'unknown'} (${targetMemberNumber}): ${msg.length > 150 ? `${msg.substring(0, 150)}...` : msg})`;
    link.classList.add('lce-beep-from');   // 與收件顯示共用主題自適應配色
    lceChatNotify(link);
}

function whisper(command, args) {
    if (args.length < 2) { lceChatNotify('未提供悄悄話對象或訊息。'); return; }
    const [target] = args;
    const [, , ...message] = command.split(' ');
    const msg = message?.join(' ');
    const targetMembers = findDrawnCharacters(target);
    if (!target || !targetMembers || targetMembers.length === 0) {
        lceChatNotify(`找不到悄悄話對象：${target}`);
    } else if (targetMembers.length > 1) {
        lceChatNotify(`找到多個對象：${targetMembers.map(c => `${CharacterNickname(c)} (${c.MemberNumber ?? ''})`).join(', ')}`);
    } else if (targetMembers[0].IsPlayer()) {
        lceChatNotify('不能對自己說悄悄話！');
    } else if (msg) {
        const targetMemberNumber = targetMembers[0].MemberNumber;
        const originalTarget = ChatRoomTargetMemberNumber;
        ChatRoomTargetMemberNumber = targetMemberNumber ?? -1;
        ElementValue('InputChat', `${msg.length > 0 && ['.', '/'].includes(msg[0]) ? '​' : ''}${msg}`);
        ChatRoomSendChat();
        ChatRoomLastMessage.pop();
        ChatRoomTargetMemberNumber = originalTarget;
    } else {
        lceChatNotify('未提供訊息。');
    }
}

function versions(args) {
    function modInfo(character) {
        const bcVersion = character.OnlineSharedSettings?.GameVersion ?? 'R0';
        const BCXi = window.bcx?.getCharacterVersion?.(character.MemberNumber) ? ` BCX ${window.bcx.getCharacterVersion(character.MemberNumber) ?? '?'}` : '';

        // 兩個獨立來源，見 features/hello.js：
        //   FBC ← BCEMsg（WCE 的頻道，我們只收）
        //   LCE ← LCEMsg（我們自己的頻道）
        // 兩個都有值 = 對方同時裝了 WCE 和 LCE，兩行都該列出來。
        // WCE 主版號 1~5 是舊名 FBC，之後才改叫 WCE（判斷方式同 WCE 自己的徽章）。
        const wceLabel = character.FBC && ['1', '2', '3', '4', '5'].includes(character.FBC.split('.')[0]) ? 'FBC' : 'WCE';
        const wce = character.FBC ? `\n${wceLabel} v${character.FBC}` : '';
        const lce = character.LCE ? `\nLCE v${character.LCE}` : '';

        // 兩邊送的都是 bcModSdk.getModsInfo()，內容一樣；有 LCE 的就用 LCE 那份
        const addons = character.LCEOtherAddons ?? character.FBCOtherAddons ?? [];
        const others = addons.length
            ? `\nAddons:\n- ${addons.map(m => `${m.name} v${m.version} ${m.repository ?? ''}`).join('\n- ')}`
            : '';
        return `${CharacterNickname(character)} (${character.MemberNumber ?? ''}) club ${bcVersion}${BCXi}${wce}${lce}${others}`;
    }
    const printList = findDrawnCharacters(args.length > 0 ? args[0] : null, true);
    lceChatNotify(printList.map(modInfo).filter(Boolean).join('\n\n'));
}

// 指令清單（同時供 CommandCombine 註冊與 /lce 說明列出）
// NeedsArg：這些指令要接參數，/lce 的按鈕只把指令填進輸入框讓你接著打，不直接執行。
const COMMAND_LIST = [
    { Tag: 'lce', Description: '檢視所有 LCE 指令與功能說明', Action: () => { showHelp(); } },
    { Tag: 'lcesetting', Description: '快速前往 LCE 設定頁', Action: () => { openSettings(); } },
    { Tag: 'lcedebug', Description: '取得除錯資訊並複製到剪貼簿', Action: () => { lceDebug(); } },
    { Tag: 'lcesetlist', Description: '列出帳號上所有 ExtensionSettings 與其大小（可直接按鈕刪除）', Action: () => { listExtSettings(); } },
    { Tag: 'lcegotoroom', NeedsArg: true, Description: '[房名或空]：無視限制切換房間，空白則離開', Action: (_, command) => { gotoRoom(command.substring(12).trim()); } },
    { Tag: 'exportlooks', NeedsArg: true, Description: '[會員編號]：複製你或他人的外觀字串（可用 LCE/BCX 匯入）', Action: (_, _c, [target]) => { exportLooks(target); } },
    { Tag: 'importlooks', Description: '從字串匯入外觀（LCE/BCX 匯出）', Action: () => { importLooks(); } },
    { Tag: 'beep', NeedsArg: true, Description: '[會員編號] [訊息]：beep 某人', Action: (_, command, [target]) => { beep(command, target); } },
    { Tag: 'w', NeedsArg: true, Description: '[名稱] [訊息]：悄悄話房間內第一個符合名稱的人', Action: (_, command, args) => { whisper(command, args); } },
    { Tag: 'versions', Description: '顯示房間內玩家的俱樂部/BCX/插件版本', Action: (_, _c, args) => { versions(args); } },
    { Tag: 'cum', Description: '引起高潮', Action: () => { doOrgasm(); } },
];

/** 引起高潮（移植自 CRA）。 */
function doOrgasm() {
    try {
        if (typeof ActivityOrgasmStart !== 'function') { lceChatNotify('此 BC 版本不支援。'); return; }
        ActivityOrgasmRuined = false;
        ActivityOrgasmStart(Player);
    } catch (e) { console.warn(LOG, '/cum 失敗:', e); }
}

/**
 * 在聊天室輸出說明：每個指令一顆按鈕，免得要一個字一個字打。
 * 不用帶參數的直接執行；要帶參數的只把 "/指令 " 填進輸入框並聚焦，讓使用者接著打。
 */
function showHelp() {
    const wrap = document.createElement('div');

    const head = document.createElement('div');
    head.textContent = `LCE v${MOD_VER} — 指令清單`;
    wrap.appendChild(head);

    for (const c of COMMAND_LIST) {
        const row = document.createElement('div');
        row.className = 'lce-help-row';
        row.appendChild(chatButton(`/${c.Tag}`, () => {
            if (c.NeedsArg) {
                // 只填指令前綴：參數還得靠使用者自己打
                try {
                    ElementValue('InputChat', `/${c.Tag} `);
                    document.getElementById('InputChat')?.focus();
                } catch { /* ignore */ }
            } else {
                try { c.Action.call(c, '', `/${c.Tag}`, []); }
                catch (e) { console.warn(LOG, `/${c.Tag} 失敗:`, e); }
            }
        }));
        const desc = document.createElement('span');
        desc.textContent = ` — ${c.Description}`;
        row.appendChild(desc);
        wrap.appendChild(row);
    }
    lceChatNotify(wrap);
}

let installed = false;

/** 等 Commands 就緒後註冊 LCE 指令。指令系統是必要功能，沒有開關。 */
export function installCommander() {
    if (installed) return;
    (function wait(n = 240) {
        if (typeof Commands === 'undefined' || !Commands || typeof CommandCombine !== 'function') {
            if (n <= 0) { console.warn(LOG, '找不到 Commands，指令未註冊'); return; }
            setTimeout(() => wait(n - 1), 500);
            return;
        }
        CommandCombine(COMMAND_LIST);
        installed = true;
        console.debug(LOG, '指令系統已註冊');
    })();
}
