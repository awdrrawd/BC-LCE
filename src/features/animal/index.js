import { getFeature } from '../../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';
import { createSocketBinding } from '../../core/lifecycle.js';
import { createHook } from '../../core/hooks.js';
import modApi from '../../modsdk.js';
import { getAnimTypeFromMsg } from './triggers.js';
import { SLOTS, ANIMAL_TYPES, fallbackCycles, clampCycles, clampDelay, sanitizeAnimalState, findSlotItem, applyAnimalState as applyState, animalItemSignature, collectManagedKeys, poseAt } from './actions.js';

const hook = createHook('animal-animations');

const HIDDEN_MSG_PREFIX = 'LCEAnimalAnim_';

const renderers = new Map(); // id+type -> { timer, char, slot, names, managedKeys, state1, startSig }
let autoTriggerInterval = null;

function refreshCharacter(char) {
    if (typeof CharacterRefresh === 'function') CharacterRefresh(char, false, false);
}

/**
 * 本人播放時每一格都送一個物件更新封包（同 BCAR 的 ChatRoomCharacterItemUpdate）。
 * 這樣房間裡所有人（包含沒安裝 LCE、沒開啟對應設定的人）都會透過伺服器看到搖晃，
 * 不需要對方做任何事。回傳是否成功送出。
 */
function pushFrame(char, slot) {
    if (char !== globalThis.Player) return false;
    if (typeof ChatRoomCharacterItemUpdate !== 'function' || !globalThis.ChatRoomData) return false;
    try { ChatRoomCharacterItemUpdate(char, slot); return true; }
    catch (e) { console.warn('[LCE] animal frame sync failed', e); return false; }
}

/**
 * 最後一格沒有成功送出時（離開畫面、離開房間、送出失敗）的補送：
 * 本人部位的最終狀態與播放前不同才送，讓伺服器上的狀態停在 A。
 */
function syncToServer(char, slot, startSig) {
    if (char !== globalThis.Player) return;
    if (typeof ChatRoomCharacterItemUpdate !== 'function' || !globalThis.ChatRoomData) return;
    if (animalItemSignature(findSlotItem(char, slot)) === startSig) return;
    try { ChatRoomCharacterItemUpdate(char, slot); }
    catch (e) { console.warn('[LCE] animal sync failed', e); }
}

/** 該部位目前仍是這次動畫的物件（沒有被脫下、也沒有換成別的）。 */
function ownsSlot(r) {
    const item = findSlotItem(r.char, r.slot);
    return !!item && r.names.has(item.Asset.Name);
}

/** 定格在 A 並補送最終狀態；離開畫面、離開房間時共用。 */
function settleOnA(r, { refresh = true } = {}) {
    applyState(r.char, r.slot, r.state1, r.managedKeys);
    if (refresh) refreshCharacter(r.char);
    syncToServer(r.char, r.slot, r.startSig);
}

/**
 * 播放用 A → B → A → B …，共 cycles 個完整循環，最後停在 A（靜止姿勢），不還原播放前的物件：
 * 發送者與所有接收者都會停在同一個狀態，不會出現「對方看到 X、本人其實是 A」的落差。
 * 播放中若耳朵／尾巴／翅膀被脫下或換成別的物件，立即停止，不覆蓋對方的變更。
 * 同一個角色、同一個部位再次觸發時，永遠以最新一筆為準：清掉舊計時器後從頭重播，
 * 但沿用最初的起始簽章與管理欄位。
 * 本人播放時每格都送物件更新（見 pushFrame），所以別人不需要安裝 LCE 也看得到；
 * 遠端角色的播放只來自舊版 LCE 送出的 Hidden 觸發封包（見 onAnimalMessage），且從不送封包。
 */
function startRender(char, type, state1, state2, delay, cycles) {
    const id = char.MemberNumber;
    if (!id) return;

    const slot = SLOTS[type];
    const key = id + type;
    const previous = renderers.get(key);
    if (previous) clearTimeout(previous.timer);

    const startItem = findSlotItem(char, slot);
    const r = {
        char, slot, state1, timer: null,
        names: previous?.names ?? new Set(),
        managedKeys: previous?.managedKeys ?? new Set(),
        startSig: previous ? previous.startSig : animalItemSignature(startItem),   // 重新觸發時仍以最初狀態為準
        lastFrameSent: false,
    };
    for (const name of [state1.Name, state2.Name, startItem?.Asset.Name]) if (name) r.names.add(name);
    collectManagedKeys(r.managedKeys, startItem, state1, state2);
    renderers.set(key, r);

    const total = cycles * 2;
    let frame = 0;

    // 例外或結束時一定要清掉登記，否則該角色之後的動畫會永遠卡住
    const finish = () => { if (renderers.get(key) === r) renderers.delete(key); };

    function step() {
        try {
            // 角色已離開房間：物件已被丟棄，不需要任何處理
            if (char !== globalThis.Player && !(globalThis.ChatRoomCharacter || []).includes(char)) { finish(); return; }

            // 被脫下或換掉 → 停止，保留對方的變更（第一格且原本沒有物件時，視為要穿上，不檢查）
            if ((frame > 0 || startItem) && !ownsSlot(r)) { finish(); return; }

            if (globalThis.CurrentScreen !== 'ChatRoom') { settleOnA(r); finish(); return; }
            if (frame >= total) { finish(); if (!r.lastFrameSent) syncToServer(char, slot, r.startSig); return; }

            applyState(char, slot, poseAt(frame, total, state1, state2), r.managedKeys);
            refreshCharacter(char);
            r.lastFrameSent = pushFrame(char, slot);

            frame++;
            // 當本人有多個部位同時播放時，動態調配間隔以確保整體發送率不超過 10 封包/秒（BC 伺服器上限為 14 封包/1.2 秒）
            let nextDelay = delay;
            if (char === globalThis.Player) {
                let activeCount = 0;
                for (const item of renderers.values()) if (item.char === globalThis.Player) activeCount++;
                if (activeCount > 1) nextDelay = Math.max(delay, activeCount * 100);
            }
            r.timer = setTimeout(step, nextDelay);
        } catch (e) {
            console.warn('[LCE] animal animation failed', e);
            finish();
        }
    }

    step();
}

// 開始本人的動畫（開關與姿勢檢查在這裡，決定的是「自己要不要搖」）
function triggerAnimation(type, { auto = false } = {}) {
    const player = globalThis.Player;
    if (!player) return;

    // 設定檔內容也走同一套驗證，本地播放與送出的封包一致
    const state1 = sanitizeAnimalState(getFeature(`animal${type}State1`));
    const state2 = sanitizeAnimalState(getFeature(`animal${type}State2`));
    if (!state1 || !state2) return;

    const slot = SLOTS[type];
    const currentItem = findSlotItem(player, slot);

    // 自動觸發：使用者脫掉的部位不要被動畫穿回去
    if (auto && !currentItem) return;

    let cycles = clampCycles(getFeature(`animal${type}Cycles`), fallbackCycles(type));
    let delay = clampDelay(getFeature(`animal${type}Delay`) || 250);

    // Randomize cycles (+/- 1) and delay (+/- 20ms) for a more natural, less rigid feel.
    // 隨機化後再夾限一次，上限與接收端相同。
    const cyclesVary = 1;
    cycles = clampCycles(cycles - cyclesVary + Math.floor(Math.random() * (cyclesVary * 2 + 1)));

    const delayVary = 20;
    delay = clampDelay(delay - delayVary + Math.floor(Math.random() * (delayVary * 2 + 1)));

    // 本機播放；本人的每一格同時送物件更新，所有人（含沒裝 LCE 的）都看得到
    startRender(player, type, state1, state2, delay, cycles);
}

let lastTriggers = { Ears: Date.now(), Tails: Date.now(), Wings: Date.now() };

/** 依目前設定啟動或停止自動觸發計時器。可重複呼叫。 */
export function syncAutoTimer() {
    const anyEnabled = ANIMAL_TYPES.some(type => getFeature(`animal${type}`));
    if (anyEnabled && !autoTriggerInterval) {
        autoTriggerInterval = setInterval(checkTriggers, 1000);
    } else if (!anyEnabled && autoTriggerInterval) {
        clearInterval(autoTriggerInterval);
        autoTriggerInterval = null;
    }
}

function checkTriggers() {
    if (globalThis.CurrentScreen !== 'ChatRoom' || globalThis.CurrentCharacter !== null) return;
    
    const now = Date.now();
    for (const type of ANIMAL_TYPES) {
        if (!getFeature(`animal${type}`)) continue;
        
        const intervalMs = (getFeature(`animal${type}Interval`) || 30) * 1000;
        if (now - lastTriggers[type] > intervalMs) {
            // 20% chance per second after interval elapses (~+5s on average)
            if (Math.random() < 0.2) { 
                lastTriggers[type] = now;
                triggerAnimation(type, { auto: true });
            }
        }
    }
}

/**
 * 當遠端玩家變更本人外觀或部位時（例如在 Wardrobe 換衣服點 OK、或在 Dialog 穿脫/改色），
 * 立即停止本人的所有動物動畫，不再送出後續 frame，避免覆蓋對方的變更或造成伺服器 diff 衝突。
 */
export function stopPlayerAnimations() {
    for (const [key, r] of renderers.entries()) {
        if (r.char === globalThis.Player) {
            clearTimeout(r.timer);
            renderers.delete(key);
            try {
                if (ownsSlot(r)) {
                    applyState(r.char, r.slot, r.state1, r.managedKeys);
                    refreshCharacter(r.char);
                }
            } catch (e) {
                console.warn('[LCE] animal abort settle failed', e);
            }
        }
    }
}

export function onSyncItem(data) {
    if (data?.Item?.Target === globalThis.Player?.MemberNumber && data?.Source !== globalThis.Player?.MemberNumber) {
        stopPlayerAnimations();
    }
}

export function onSyncCharacter(data) {
    const charId = data?.Character?.MemberNumber ?? data?.MemberNumber;
    const source = data?.SourceMemberNumber ?? data?.Source;
    if (charId === globalThis.Player?.MemberNumber && source !== globalThis.Player?.MemberNumber) {
        stopPlayerAnimations();
    }
}

/**
 * 舊版 LCE 送出的 Hidden 觸發封包（向下相容）。新版送出端改為逐格物件更新，不再送這種封包。
 * 對應設定只決定「自己要不要搖」，不決定「看不看得到別人搖」，所以這裡不檢查開關。
 */
export function onAnimalMessage(data) {
    if (data?.Type !== 'Hidden' || !data.Content?.startsWith(HIDDEN_MSG_PREFIX)) return;
    
    const id = data.Sender;
    if (!Number.isSafeInteger(id) || id === globalThis.Player?.MemberNumber) return;


    const dict = Array.isArray(data.Dictionary) ? data.Dictionary[0] : data.Dictionary;
    if (!dict || !dict.type || !dict.state1 || !dict.state2) return;
    if (!ANIMAL_TYPES.includes(dict.type)) return;

    // 同一個部位再次觸發：永遠以最新一筆為準（startRender 會清掉舊的重新播放）；上限只擋新增的登記
    if (!renderers.has(id + dict.type) && renderers.size >= 20) return;
    const char = (globalThis.ChatRoomCharacter || []).find(c => c.MemberNumber === id);
    if (!char) return;
    
    const delay = clampDelay(dict.delay, 250);
    const cycles = clampCycles(dict.cycles, 2);

    // 資產必須存在於該部位；其餘欄位由共用的 sanitizeAnimalState 驗證（白名單、型別、深度、大小）
    const buildState = s => {
        const state = sanitizeAnimalState(s);
        if (!state) return null;
        if (!AssetGet('Female3DCG', SLOTS[dict.type], state.Name)) return null;
        return state;
    };

    const state1 = buildState(dict.state1);
    const state2 = buildState(dict.state2);

    if (!state1 || !state2) return;

    startRender(char, dict.type, state1, state2, delay, cycles);
}

let installed = false;
export function installAnimalAnimations() {
    if (installed) return;
    installed = true;
    
    // Receive network anims & yield when others dress or modify the player
    const binding = createSocketBinding({
        ChatRoomMessage: onAnimalMessage,
        ChatRoomSyncItem: onSyncItem,
        ChatRoomSyncCharacter: onSyncCharacter,
        ChatRoomSyncSingle: onSyncCharacter,
    });
    const bind = () => binding.bind(typeof ServerSocket === 'undefined' ? null : ServerSocket);
    (function wait(n = 240) {
        if (typeof ServerSocket === 'undefined' || !ServerSocket) {
            if (n > 0) setTimeout(() => wait(n - 1), 500);
            return;
        }
        bind();
        try { modApi.hookFunction('ServerInit', 10, (args, next) => { const r = next(args); bind(); return r; }); }
        catch { /* ignore */ }
    })();

    hook('ChatRoomLeave', 10, (args, next) => {
        for (const r of renderers.values()) {
            clearTimeout(r.timer);
            // 定格在 A；被脫下或換掉的部位不動
            try { if (ownsSlot(r)) settleOnA(r, { refresh: false }); }
            catch (e) { console.warn('[LCE] animal finalize failed', e); }
        }
        renderers.clear();
        return next(args);
    });

    // 聊天文字觸發（七種語言的詞，見 triggers.js）：照常送出訊息，送出後播放
    hook('ChatRoomSendChat', 5, (args, next) => {
        let type = null;
        try {
            type = getAnimTypeFromMsg(typeof ElementValue === 'function' ? ElementValue('InputChat') : '');
            if (type && !getFeature(`animal${type}`)) type = null;
        } catch { type = null; }
        const result = next(args);
        if (type) { try { triggerAnimation(type); } catch (e) { console.warn('[LCE] animal trigger failed', e); } }
        return result;
    });

    // 自動觸發的計時器只在至少一個部位開啟時才跑；全部關閉時不佔任何計時器
    syncAutoTimer();
    window.addEventListener(SETTING_CHANGED_EVENT, syncAutoTimer);
}
