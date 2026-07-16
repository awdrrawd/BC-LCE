// ════════════════════════════════════════════════════════════════════════════
// Commander —— WCE 指令系統移植（src/functions/commands.ts）
// 排除：toy（buttplug）、uwall/ulist、r/anim/pose（動畫引擎），依需求不搬。
// 保留並改名為 lce 前綴：lcedebug、lcegotoroom；通用指令：exportlooks / importlooks / beep / w / versions。
// 由 misc 的 `commander` 設定開關；於登入後、Commands 就緒時註冊。
// ════════════════════════════════════════════════════════════════════════════

import { MOD_VER, LCE_EXT_KEY } from '../core/constants.js';
import { getFeature } from '../core/feature-settings.js';
import { isExpressionEngineStarted } from '../features/expressions.js';

const LOG = '🐈‍⬛ [LCE]';

function parseJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/** 在聊天室輸出一則本地訊息（不送伺服器）。移植自 WCE fbcChatNotify。 */
export function lceChatNotify(node) {
    const div = document.createElement('div');
    div.setAttribute('class', 'ChatMessage lce-notification');
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

/** 移植自 WCE bceGotoRoom：無視限制切換/離開房間。 */
function gotoRoom(roomName) {
    if (typeof ChatRoomJoinLeash !== 'undefined') ChatRoomJoinLeash = roomName;
    if (typeof DialogLeave === 'function') DialogLeave();
    if (CurrentScreen === 'ChatRoom' && typeof ChatRoomLeave === 'function') ChatRoomLeave(false);
    if (roomName) {
        ChatSearchStart('X', ['Room', 'MainHall'], { Background: 'Introduction', BackgroundTagList: typeof BackgroundsTagList !== 'undefined' ? BackgroundsTagList : [] });
    } else {
        if (typeof ChatRoomSetLastChatRoom === 'function') ChatRoomSetLastChatRoom(null);
        CommonSetScreen('Room', 'MainHall');
    }
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

/** 依大小排序的 [鍵名, 位元組]；編號即此順序（/lcesetdel 可用編號指定）。 */
function extRows(ext) {
    return Object.entries(ext)
        .map(([k, v]) => [k, typeof v === 'string' ? v.length : JSON.stringify(v ?? '').length])
        .sort((a, b) => b[1] - a[1]);
}

/**
 * 從原始指令字串取出參數。
 * 不能用 BC 傳進來的 args —— 那會被正規化成小寫，鍵名（例如 BCC）就對不上了。
 */
const rawArg = (command) => String(command ?? '').replace(/^\s*\/?\S+\s*/, '').trim();

/** 列出目前帳號上所有 ExtensionSettings 及其大小，方便找出誰把空間吃光。 */
function listExtSettings() {
    const ext = extSettings();
    if (!ext) { lceChatNotify('讀不到 Player.ExtensionSettings。'); return; }
    const rows = extRows(ext);
    if (!rows.length) { lceChatNotify('目前沒有任何 ExtensionSettings。'); return; }

    const total = rows.reduce((s, [, n]) => s + n, 0);
    const lines = [`ExtensionSettings（共 ${rows.length} 筆，合計 ${(total / 1024).toFixed(1)}KB）：`];
    rows.forEach(([k, n], i) => lines.push(`${i + 1}. ${k} — ${(n / 1024).toFixed(1)}KB`));
    lines.push('刪除：/lcesetdel <編號或鍵名>（例：/lcesetdel 4 或 /lcesetdel BCC）');

    const wrap = document.createElement('div');
    for (const line of lines) {
        const d = document.createElement('div');
        d.textContent = line;
        wrap.appendChild(d);
    }
    lceChatNotify(wrap);
}

/** 把使用者輸入（編號 / 鍵名 / 大小寫不符的鍵名）解析成實際鍵名。 */
function resolveExtKey(ext, arg) {
    if (!arg) return { error: '用法：/lcesetdel <編號或鍵名>；先用 /lcesetlist 查看有哪些。' };

    if (/^\d+$/.test(arg)) {
        const rows = extRows(ext);
        const key = rows[parseInt(arg, 10) - 1]?.[0];
        return key ? { key } : { error: `編號 ${arg} 超出範圍（目前共 ${rows.length} 筆）。` };
    }
    if (arg in ext) return { key: arg };

    // 指令參數可能被轉小寫，故再做一次不分大小寫比對
    const hits = Object.keys(ext).filter(k => k.toLowerCase() === arg.toLowerCase());
    if (hits.length === 1) return { key: hits[0] };
    if (hits.length > 1) return { error: `"${arg}" 對應到多個鍵（${hits.join(', ')}），請改用編號。` };
    return { error: `找不到 "${arg}"，請用 /lcesetlist 確認（可直接用編號）。` };
}

/**
 * 刪除指定的 ExtensionSettings。
 * 這會動到「其他插件」存在伺服器上的資料且無法復原，所以一律要求二次確認。
 */
function delExtSetting(arg) {
    const ext = extSettings();
    if (!ext) { lceChatNotify('讀不到 Player.ExtensionSettings。'); return; }

    const { key, error } = resolveExtKey(ext, arg);
    if (error) { lceChatNotify(error); return; }

    const size = ((typeof ext[key] === 'string' ? ext[key].length : 0) / 1024).toFixed(1);
    const doDelete = () => {
        try {
            // ServerPlayerExtensionSettingsSync 只能 $set 單一鍵（送 "" 只是把值清空，鍵還在）。
            // 要讓「鍵本身」從伺服器消失，必須整包重送 ExtensionSettings 覆蓋掉整個欄位。
            // 代價是這一次的 AccountUpdate 會比較大（等同目前所有 ExtensionSettings 的總和），
            // 但只有刪除時才發生一次。
            delete Player.ExtensionSettings[key];
            if (typeof ServerSend === 'function') {
                ServerSend('AccountUpdate', { ExtensionSettings: Player.ExtensionSettings });
            }
            const left = extRows(Player.ExtensionSettings).reduce((s, [, n]) => s + n, 0);
            lceChatNotify(`已移除 "${key}"（釋出約 ${size}KB，剩餘合計 ${(left / 1024).toFixed(1)}KB）。`
                + ' 該插件下次載入時會重建自己的預設值。可用 /lcesetlist 確認。');
        } catch (e) {
            console.warn(LOG, '刪除失敗:', e);
            lceChatNotify(`刪除 "${key}" 失敗，詳見 console。`);
        }
    };

    if (typeof FUSAM === 'object' && FUSAM?.modals) {
        FUSAM.modals.open({
            prompt: `確定要刪除 "${key}"（約 ${size}KB）嗎？\n這會清掉該插件存在伺服器上的資料，且無法復原。`,
            callback: (act) => { if (act === 'submit') doDelete(); },
            buttons: { cancel: '取消', submit: '刪除' },
        });
    } else {
        // 沒有 FUSAM 對話框時退回瀏覽器原生確認，確保不會誤刪
        if (window.confirm(`確定要刪除 ExtensionSettings "${key}"（約 ${size}KB）？此操作無法復原。`)) doDelete();
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
        const others = character.FBCOtherAddons?.length
            ? `\nAddons:\n- ${character.FBCOtherAddons.map(m => `${m.name} v${m.version} ${m.repository ?? ''}`).join('\n- ')}`
            : '';
        return `${CharacterNickname(character)} (${character.MemberNumber ?? ''}) club ${bcVersion}${BCXi}${others}`;
    }
    const printList = findDrawnCharacters(args.length > 0 ? args[0] : null, true);
    lceChatNotify(printList.map(modInfo).filter(Boolean).join('\n\n'));
}

// 指令清單（同時供 CommandCombine 註冊與 /lce 說明列出）
const COMMAND_LIST = [
    { Tag: 'lce', Description: '檢視所有 LCE 指令與功能說明', Action: () => { showHelp(); } },
    { Tag: 'lcesetting', Description: '快速前往 LCE 設定頁', Action: () => { openSettings(); } },
    { Tag: 'lcedebug', Description: '取得除錯資訊並複製到剪貼簿', Action: () => { lceDebug(); } },
    { Tag: 'lcesetlist', Description: '列出帳號上所有 ExtensionSettings 與其大小', Action: () => { listExtSettings(); } },
    { Tag: 'lcesetdel', Description: '[編號或鍵名]：刪除指定的 ExtensionSettings（例：/lcesetdel 4 或 /lcesetdel BCC）', Action: (_, command) => { delExtSetting(rawArg(command)); } },
    { Tag: 'lcegotoroom', Description: '[房名或空]：無視限制切換房間，空白則離開', Action: (_, command) => { gotoRoom(command.substring(12).trim()); } },
    { Tag: 'exportlooks', Description: '[會員編號]：複製你或他人的外觀字串（可用 LCE/BCX 匯入）', Action: (_, _c, [target]) => { exportLooks(target); } },
    { Tag: 'importlooks', Description: '從字串匯入外觀（LCE/BCX 匯出）', Action: () => { importLooks(); } },
    { Tag: 'beep', Description: '[會員編號] [訊息]：beep 某人', Action: (_, command, [target]) => { beep(command, target); } },
    { Tag: 'w', Description: '[名稱] [訊息]：悄悄話房間內第一個符合名稱的人', Action: (_, command, args) => { whisper(command, args); } },
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

/** 組出 /lce 的說明內容：只列 Commander 指令。 */
function buildHelpLines() {
    const lines = [`LCE v${MOD_VER} — 指令清單`];
    for (const c of COMMAND_LIST) lines.push(`/${c.Tag} — ${c.Description}`);
    return lines;
}

/** 在聊天室輸出說明（每行一個 div，確保換行）。 */
function showHelp() {
    const wrap = document.createElement('div');
    for (const line of buildHelpLines()) {
        const d = document.createElement('div');
        d.textContent = line;
        wrap.appendChild(d);
    }
    lceChatNotify(wrap);
}

let installed = false;

/** 等 Commands 就緒後註冊 LCE 指令（若 commander 設定關閉則不註冊）。 */
export function installCommander() {
    if (installed) return;
    if (!getFeature('commander')) return;
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
