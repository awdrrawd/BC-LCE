import { getFeature } from '../../core/feature-settings.js';
import { SETTING_CHANGED_EVENT } from '../../core/constants.js';
import { createSocketBinding } from '../../core/lifecycle.js';
import { createHook } from '../../core/hooks.js';
import modApi from '../../modsdk.js';
import { sendBudget, installSendBudgetHook } from '../../core/send-budget.js';
import { getAnimTypeFromMsg } from './triggers.js';
import { SLOTS, ANIMAL_TYPES, fallbackCycles, clampCycles, clampDelay, sanitizeAnimalState, findSlotItem, applyAnimalState as applyState, animalItemSignature, collectManagedKeys, poseAt } from './actions.js';

const hook = createHook('animal-animations');

const HIDDEN_MSG_PREFIX = 'LCEAnimalAnim_';

const renderers = new Map(); // id+type -> { timer, char, slot, names, managedKeys, state1, serverSig, startedAt, waitStart, maxLife }

const MAX_FRAME_WAIT = 3000;   // 單格等不到發送額度的上限；超過就視為過期，定格 A
const LIFE_SLACK = 3000;       // 整段動畫的存活上限 = total × delay × 2 + 這個緩衝
const RETRY_MIN = 40;          // 閘門不通過時的最短重試間隔
const RETRY_JITTER = 40;       // 重試加上隨機抖動，避免多個部位同時醒來
let autoTriggerInterval = null;

function refreshCharacter(char) {
    if (typeof CharacterRefresh === 'function') CharacterRefresh(char, false, false);
}

/**
 * 提交一格物件更新（同 BCAR 的 ChatRoomCharacterItemUpdate）。
 * 這樣房間裡所有人（包含沒安裝 LCE、沒開啟對應設定的人）都會透過伺服器看到搖晃，
 * 不需要對方做任何事。回傳「是否真的提交給 BC 的發送 API」：
 * BC 在不在房間時會直接 return 而不送任何東西，這種情況回傳 false。
 * 注意這只代表進了 BC 的發送佇列，不代表伺服器已收到或套用；BC 沒有送達確認。
 */
function canPush(char) {
    if (char !== globalThis.Player) return false;
    if (typeof ChatRoomCharacterItemUpdate !== 'function' || !globalThis.ChatRoomData) return false;
    if (typeof ServerPlayerIsInChatRoom === 'function' && !ServerPlayerIsInChatRoom()) return false;
    return true;
}

function pushFrame(char, slot) {
    if (!canPush(char)) return false;
    try {
        sendBudget.withOwnSend(() => ChatRoomCharacterItemUpdate(char, slot));
        sendBudget.markSubmitted();
        return true;
    } catch (e) { console.warn('[LCE] animal frame sync failed', e); return false; }
}

/** 提交並記下「最後提交給 BC 的姿勢簽章」，最終同步以它為準，而不是播放前的起始簽章。 */
function submitFrame(r) {
    if (!pushFrame(r.char, r.slot)) return false;
    r.serverSig = animalItemSignature(findSlotItem(r.char, r.slot));
    return true;
}

// 最終 A 提交失敗時的受控重試：key -> { r, timer, attempt }。
// 「待同步」只代表 LCE 還沒把最終姿勢提交給 BC，不代表伺服器已確認收到。
const pendingFinals = new Map();
const FINAL_RETRY_DELAYS = [200, 600, 1500];

function clearPendingFinal(key) {
    const p = pendingFinals.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    pendingFinals.delete(key);
}

function clearAllPendingFinals() { for (const key of [...pendingFinals.keys()]) clearPendingFinal(key); }

function schedulePendingFinal(r, attempt = 0) {
    if (attempt >= FINAL_RETRY_DELAYS.length) { pendingFinals.delete(r.key); sendBudget.noteFinalFailed(); return; }
    const entry = { r, attempt, timer: null };
    entry.timer = setTimeout(() => {
        pendingFinals.delete(r.key);
        // 新的動畫已接手、離開房間、或部位被脫下／換掉：不再補送，不覆蓋別人的變更
        if (renderers.has(r.key) || globalThis.CurrentScreen !== 'ChatRoom' || !ownsSlot(r)) return;
        if (animalItemSignature(findSlotItem(r.char, r.slot)) === r.serverSig) return;
        if (!submitFrame(r)) schedulePendingFinal(r, attempt + 1);
    }, FINAL_RETRY_DELAYS[attempt]);
    pendingFinals.set(r.key, entry);
}

/**
 * 最終狀態同步：本人部位目前的姿勢與最後提交的不同才補送。
 * 繞過動畫自己的閘門（最終 A 優先），但仍走 BC 的發送佇列，所以可能在佇列中等待。
 * 提交失敗時不會直接丟棄：進入有限次數的重試（見 pendingFinals）。
 * 同步完成後 renderer 已從登記表移除、計時器已清除，所以不會有舊動畫的計時器再覆寫；
 * 重新觸發時新 renderer 會沿用 serverSig，不會誤判伺服器狀態，並取消尚未完成的補送。
 */
function finalSync(r) {
    if (r.char !== globalThis.Player) return true;
    clearPendingFinal(r.key);
    if (animalItemSignature(findSlotItem(r.char, r.slot)) === r.serverSig) return true;
    if (submitFrame(r)) return true;
    schedulePendingFinal(r);
    return false;
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
    finalSync(r);
}

/**
 * 播放用 A → B → A → B …，共 cycles 個完整循環，最後停在 A（靜止姿勢），不還原播放前的物件：
 * 發送者與所有接收者都會停在同一個狀態，不會出現「對方看到 X、本人其實是 A」的落差。
 * 播放中若耳朵／尾巴／翅膀被脫下或換成別的物件，立即停止，不覆蓋對方的變更。
 * 同一個角色、同一個部位再次觸發時，永遠以最新一筆為準：清掉舊計時器後從頭重播，
 * 但沿用最近一次提交的姿勢簽章（serverSig）與管理欄位。
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
    clearPendingFinal(key);

    const startItem = findSlotItem(char, slot);
    const r = {
        char, slot, state1, key, timer: null,
        names: previous?.names ?? new Set(),
        managedKeys: previous?.managedKeys ?? new Set(),
        // 伺服器端最後已知（提交過）的姿勢簽章；還沒提交過時就是播放前的狀態。
        // 重新觸發時沿用上一次的值，不會因為舊動畫被取代而誤判。
        serverSig: previous ? previous.serverSig : animalItemSignature(startItem),
        startedAt: Date.now(), waitStart: null, maxLife: 0,
    };
    for (const name of [state1.Name, state2.Name, startItem?.Asset.Name]) if (name) r.names.add(name);
    collectManagedKeys(r.managedKeys, startItem, state1, state2);
    renderers.set(key, r);

    const total = cycles * 2;
    let frame = 0;
    r.maxLife = total * delay * 2 + LIFE_SLACK;

    // 例外或結束時一定要清掉登記，否則該角色之後的動畫會永遠卡住
    const finish = () => { if (renderers.get(key) === r) renderers.delete(key); };

    function step() {
        try {
            // 已被重新觸發或中止取代的舊動畫，絕不再動該部位（也不送封包）
            if (renderers.get(key) !== r) return;

            // 角色已離開房間：物件已被丟棄，不需要任何處理
            if (char !== globalThis.Player && !(globalThis.ChatRoomCharacter || []).includes(char)) { finish(); return; }

            // 被脫下或換掉 → 停止，保留對方的變更（第一格且原本沒有物件時，視為要穿上，不檢查）
            if ((frame > 0 || startItem) && !ownsSlot(r)) { finish(); return; }

            if (globalThis.CurrentScreen !== 'ChatRoom') { settleOnA(r); finish(); return; }
            if (frame >= total) { finish(); finalSync(r); return; }

            // 本人的每一格都要先取得發送額度，才可以套用姿勢並提交；套用之後再擋就太晚了
            // （本機姿勢先換、伺服器沒收到，兩邊會各走各的）。不通過就整格延後、不推進 frame，
            // 保持 A/B 交替，動畫自然變慢而不是丟幀。
            if (char === globalThis.Player) {
                const now = Date.now();
                if (now - r.startedAt > r.maxLife) { sendBudget.noteTimeout(); settleOnA(r); finish(); return; }
                if (!sendBudget.requestSlot()) {
                    r.waitStart ??= now;
                    const waited = now - r.waitStart;
                    sendBudget.noteWait(waited);
                    if (waited > MAX_FRAME_WAIT) { sendBudget.noteTimeout(); settleOnA(r); finish(); return; }   // 過期的動畫不要繼續播
                    sendBudget.noteDeferral();
                    const wait = Math.max(RETRY_MIN, sendBudget.nextAllowedAt() - now);
                    r.timer = setTimeout(step, wait + Math.floor(Math.random() * RETRY_JITTER));
                    return;
                }
                r.waitStart = null;
                // 提交的環境條件（不在房間等）不成立：BC 會直接忽略，繼續播只會讓本機與伺服器各走各的。
                // 還沒動過部位就靜靜結束；已經播到一半就定格 A（補送由 finalSync 處理）。
                if (!canPush(char)) { if (frame > 0) settleOnA(r); finish(); return; }
            }

            applyState(char, slot, poseAt(frame, total, state1, state2), r.managedKeys);
            refreshCharacter(char);
            // 提交失敗不能默默算成已播放的一格：受控中止，定格 A 並進入補送
            if (char === globalThis.Player && !submitFrame(r)) { settleOnA(r); finish(); return; }

            frame++;
            r.timer = setTimeout(step, delay);
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
    clearAllPendingFinals();   // 別人改了外觀：不再補送，避免覆蓋對方的變更
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
    installSendBudgetHook();
    
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
        clearAllPendingFinals();   // 離房後補送沒有意義
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
