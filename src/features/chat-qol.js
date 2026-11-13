import { createHook } from '../core/hooks.js';
import { getFeature } from '../core/feature-settings.js';
import { observeResponsive, responsiveOwns } from '../core/responsive-compat.js';
import { T } from '../core/i18n.js';
import { canUseExpressionEngine, cancelExpressionEvent, pushEvent, restoreQolPose, readFace, settleFace } from './expressions/index.js';
import { captureFace, releaseCachedFace } from './expressions/face-cache.js';
import { emoticonExpression, emoticonDuration, echoSound } from './expressions/qol-rules.js';
import { getSpeechDuration, isSimpleChat } from './expressions/char-talk.js';
import { drawAlternatingPetsuit } from './petsuit-render.js';
import { createSocketBinding } from '../core/lifecycle.js';
import modApi from '../modsdk.js';

const hook = createHook('chat-qol');
let installed = false;
let animation = null;
const poses = ['OverTheHead', 'BackElbowTouch'];
// packet -> { face, duration, text }：打字當下（未被口塞等處理改寫前）算出的臉、持有時間與原文。
// ServerSend 只讀這份，不再從封包重算，避免臉與時間來自不同版本的文字。
const outgoingFaces = new WeakMap();
let mouthDelayTimer = null;

const later = (fn, ms) => (typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout(fn, ms) : null);
const cancelLater = timer => { if (timer != null) globalThis.clearTimeout?.(timer); };

// ── 臨時表情 ──
// 寵物服與顏文字都是「暫時改臉」：改之前先寫進表情緩存（已有就不覆蓋），
// 依事件時長排程釋放；最後一個臨時表情釋放時清空緩存，並在引擎收回表情後
// （ENGINE_TICK_MS，引擎每 250ms 一輪）把最終值補送給伺服器。
const ENGINE_TICK_MS = 300;
const faceHolds = new Map();   // 事件類型 -> { player, timer }
const touchedGroups = new Set();   // 這一輪臨時表情碰過的群組，最後一個釋放時一起補送

// 臨時表情的步驟優先權。引擎仲裁只看「步驟」的 Priority：prepareExpressionEvent 會把沒寫的步驟補成 1，
// 所以只在事件層寫 Priority 是無效的 —— 臨時表情會和手動表情平手，平手時後進佇列的贏，
// 任何第三方在臨時表情之後呼叫 CharacterSetFacialExpression（例如鏡射眼睛的模組回寫舊值）
// 都會把眼睛蓋回去，而嘴巴沒人動所以維持得住。必須明確寫在每個步驟上。
const HOLD_PRIORITY = 100;

function holdFace(type, face, duration, event) {
    for (const steps of Object.values(event?.Expression ?? {})) {
        for (const step of steps) step.Priority ??= HOLD_PRIORITY;
    }
    captureFace(readFace, face);
    for (const group of Object.keys(face)) touchedGroups.add(group);
    cancelExpressionEvent(type);
    pushEvent({ Type: type, Duration: duration, Priority: 100, ...event });
    cancelLater(faceHolds.get(type)?.timer);
    faceHolds.set(type, { player: globalThis.Player, timer: later(() => releaseFaceHold(type), duration) });
}

function releaseFaceHold(type) {
    const hold = faceHolds.get(type);
    if (!hold) return;
    cancelLater(hold.timer);
    faceHolds.delete(type);
    cancelExpressionEvent(type);
    if (faceHolds.size) return;   // 還有別的臨時表情撐著，等最後一個
    releaseCachedFace();
    const groups = [...touchedGroups];
    touchedGroups.clear();
    later(() => {
        if (!faceHolds.size && globalThis.Player === hold.player && globalThis.CurrentScreen === 'ChatRoom') settleFace(groups);
    }, ENGINE_TICK_MS);
}

// ── 寵物服同步 ──
// 左右手交替只在「本地」渲染：發動者送一則 Hidden 訊息（間隔 + 組數），每個有裝 LCE 的
// 客戶端各自依時間畫出交替；不必逐步送封包。沒裝 LCE 的人看到的是一般姿勢切換，
// 為避免封包連丟，網路姿勢的步進不低於 NET_MIN_STEP，與本地渲染的間隔脫鉤。
const PETSUIT_MSG = 'LCEPetsuit';
const PETSUIT_MIN_DELAY = 100;
const PETSUIT_MAX_DELAY = 1000;
const PETSUIT_MAX_CYCLES = 20;
const NET_MIN_STEP = 350;
const renderers = new Map();   // MemberNumber -> { char, start, delay, until, timer }

const clampDelay = v => Math.max(PETSUIT_MIN_DELAY, Math.min(PETSUIT_MAX_DELAY, Math.round(Number(v)) || 350));
const clampCycles = v => Math.max(1, Math.min(PETSUIT_MAX_CYCLES, Math.round(Number(v)) || 4));
const wearsPetsuit = c => !!c?.Appearance?.some(i => /petsuit|pet suit|宠物服上/i.test(i.Asset?.Name ?? ''));

function sendPetsuitMessage(payload) {
    try {
        if (typeof ServerSend !== 'function' || !globalThis.Player) return;
        ServerSend('ChatRoomChat', { Type: 'Hidden', Content: PETSUIT_MSG, Dictionary: [{ message: payload }] });
    } catch (e) { console.warn('🐈‍⬛ [LCE]', '寵物服同步訊息送出失敗:', e); }
}

function refreshCharacter(char) {
    if (typeof CharacterRefresh === 'function') CharacterRefresh(char, false, false);   // 純本地重繪，不上傳
}

function startRender(char, delay, cycles, now = Date.now()) {
    const id = char?.MemberNumber;
    if (id == null) return;
    cancelLater(renderers.get(id)?.timer);
    const entry = { char, start: now, delay, until: now + delay * cycles * 2, timer: null };
    renderers.set(id, entry);
    refreshCharacter(char);
    stepRender(id, entry);
}

// 每個相位交替處重繪一次，到期收尾；沒有輪詢。
function stepRender(id, entry) {
    const now = Date.now();
    if (renderers.get(id) !== entry) return;
    if (now >= entry.until || !wearsPetsuit(entry.char)) { stopRender(id); return; }
    entry.timer = later(() => {
        if (renderers.get(id) !== entry) return;
        if (Date.now() < entry.until) refreshCharacter(entry.char);
        stepRender(id, entry);
    }, entry.start + (Math.floor((now - entry.start) / entry.delay) + 1) * entry.delay - now);
}

function stopRender(id) {
    const entry = renderers.get(id);
    if (!entry) return;
    cancelLater(entry.timer);
    renderers.delete(id);
    refreshCharacter(entry.char);
}

/** 其他玩家送來的 Hidden 訊息。對方沒裝或我們沒開此功能時一律忽略。 */
export function onPetsuitMessage(data) {
    if (data?.Type !== 'Hidden' || data.Content !== PETSUIT_MSG) return;
    const id = data.Sender;
    if (!Number.isSafeInteger(id) || id === globalThis.Player?.MemberNumber) return;
    const msg = Array.isArray(data.Dictionary) ? data.Dictionary.find(t => t?.message)?.message : data.Dictionary?.message;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'Stop') { stopRender(id); return; }
    if (msg.type !== 'Start') return;
    // 是否交互晃動由發送者的設定決定；對方停用就維持普通擺動，不做本地渲染。
    if (msg.alternate !== true) { stopRender(id); return; }
    const char = (globalThis.ChatRoomCharacter ?? []).find(c => c.MemberNumber === id);
    if (!char || !wearsPetsuit(char)) return;
    startRender(char, clampDelay(msg.delay), clampCycles(msg.cycles));
}

export function installPetsuitSync() {
    const binding = createSocketBinding({ ChatRoomMessage: onPetsuitMessage });
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
}

function canAnimate() {
    const player = globalThis.Player;
    return getFeature('petsuitAnimation') && canUseExpressionEngine() && globalThis.CurrentScreen === 'ChatRoom'
        && wearsPetsuit(player)
        && typeof PoseCanChangeUnaided === 'function' && poses.every(p => PoseCanChangeUnaided(player, p));
}

export function stopPetsuitAnimation(restore = true) {
    if (!animation) return;
    const previous = animation;
    animation = null;
    cancelLater(previous.timer);
    releaseFaceHold('LcePetsuit');
    if (previous.player?.MemberNumber != null) stopRender(previous.player.MemberNumber);
    if (Date.now() < previous.until) sendPetsuitMessage({ type: 'Stop' });
    if (restore && globalThis.Player === previous.player) restoreQolPose(previous.pose);
    refreshCharacter(previous.player);   // 拿掉合成的畫布；不上傳外觀（避免把還掛著 >.< 的快照送出去）
}

export function togglePetsuitAnimation() {
    if (animation) { stopPetsuitAnimation(); return; }
    if (!canAnimate()) return;
    const delay = clampDelay(getFeature('petsuitAnimationDelay'));
    const cycles = clampCycles(getFeature('petsuitAnimationCycles'));
    const duration = delay * cycles * 2;
    // 網路姿勢（沒裝 LCE 的人看到的）降速；總時長與本地渲染一致。
    const netStep = Math.max(delay, NET_MIN_STEP);
    const netSteps = Math.max(2, Math.ceil(duration / netStep / 2) * 2);
    animation = { player: Player, pose: [...(Player.ActivePose || [])], until: Date.now() + duration,
        timer: later(() => stopPetsuitAnimation(), duration) };
    const lower = animation.pose.filter(name => globalThis.PoseFemale3DCG?.find(p => p.Name === name)?.Category === 'BodyLower');
    holdFace('LcePetsuit', { Eyes: 'Daydream', Eyes2: 'Daydream' }, duration, {
        Expression: { Eyes: [{ Expression: 'Daydream', Duration: duration }] },
        Poses: Array.from({ length: netSteps }, (_, i) => ({ Pose: [poses[i % 2], ...lower], Duration: netStep })),
    });
    const alternate = !!getFeature('petsuitAlternate');
    if (alternate) startRender(Player, delay, cycles);
    sendPetsuitMessage({ type: 'Start', delay, cycles, alternate });
}

// 只檢查「條件失效」（功能被關、引擎停了、寵物服脫掉…）；正常結束由各自的計時器負責。
function updateAnimationState() {
    if (faceHolds.has('LceEmoticon') && (!getFeature('chatEmoticons') || !canUseExpressionEngine())) releaseFaceHold('LceEmoticon');
    if (animation && !canAnimate()) stopPetsuitAnimation();
    if (mouthDelayTimer && (!getFeature('chatEmoticons') || !canUseExpressionEngine())) {
        cancelLater(mouthDelayTimer);
        mouthDelayTimer = null;
    }
}

export function petsuitButtonRect(position = getFeature('petsuitAnimationPosition')) {
    // FCM uses X=955 and 45px buttons within BC's 1000px room half.
    const right = position === 'tr' || position === 'br';
    const top = position === 'tl' || position === 'tr';
    return [right ? 955 : 0, top ? 200 : 800, 45, 45];
}

function showPetsuitButton() {
    return globalThis.CurrentScreen === 'ChatRoom' && !globalThis.CurrentCharacter
        && !globalThis.CommonPhotoMode && !(globalThis.ChatRoomHideIconState >= 2)
        && (!!animation || canAnimate());
}

function drawPetsuitButton() {
    if (!showPetsuitButton()) return;
    const canvas = globalThis.MainCanvas;
    const ctx = canvas?.getContext?.('2d') ?? canvas;
    if (!ctx || typeof DrawButton !== 'function') return;
    const [x, y, w, h] = petsuitButtonRect();
    const alpha = ctx.globalAlpha;
    try {
        ctx.globalAlpha = 0.75;
        DrawButton(x, y, w, h, '', animation ? 'Pink' : 'Gray', '', T(animation ? 'qol_stopAnimation' : 'qol_startAnimation'));
        if (typeof DrawImageResize === 'function') DrawImageResize('Icons/Poses/OverTheHead.png', x + 4, y + 4, w - 8, h - 8);
    } finally { ctx.globalAlpha = alpha; }
}

export function installChatQol() {
    if (installed) return;
    installed = true;
    observeResponsive((next) => {
        if (!next.expressions) return;
        // Responsive now owns the expression surface. Cancel every LCE temporary hold
        // immediately instead of waiting for the 250ms state poll to notice it.
        for (const type of [...faceHolds.keys()]) releaseFaceHold(type);
        if (animation) stopPetsuitAnimation(false);
        cancelLater(mouthDelayTimer);
        mouthDelayTimer = null;
    });
    // Retain the typed text locally even when a gag transforms the packet.
    // Nothing extra is added to the network message or anti-garble protocol.
    hook('ChatRoomGenerateChatRoomChatMessage', 200, (args, next) => {
        const packet = next(args);
        if (getFeature('chatEmoticons') && packet && typeof packet === 'object') {
            const text = args[1];
            outgoingFaces.set(packet, {
                face: emoticonExpression(text),
                duration: emoticonDuration(text),
                text,
            });
        }
        return packet;
    });
    // Run on the final outgoing packet: typing commands or cancelled sends
    // must not change the face. Emotes and whispers may contain textmoji too.
    hook('ServerSend', 5, (args, next) => {
        const [kind, data] = args;
        if (kind === 'ChatRoomChat' && ['Chat', 'Whisper', 'Emote'].includes(data?.Type)
            && getFeature('chatEmoticons') && canUseExpressionEngine()) {
            
            cancelLater(mouthDelayTimer);
            mouthDelayTimer = null;

            // 優先使用打字當下記下的資料；只有封包不是經由我們的 hook 產生時，才退回從封包推算。
            const stored = outgoingFaces.get(data);
            outgoingFaces.delete(data);
            const original = data.Dictionary?.find(d => typeof d.Original === 'string')?.Original;
            const text = stored?.text ?? original ?? data.Content;
            const face = stored?.face ?? emoticonExpression(text);
            const duration = stored?.duration ?? emoticonDuration(text);
            if (Object.keys(face).length) {
                if ('Eyes' in face && !('Eyes2' in face)) face.Eyes2 = face.Eyes;

                // 與 CharTalk 的觸發條件一致：只有真的會播說話動畫時，臉才需要等嘴說完。
                const delay = data.Type === 'Chat'
                    && getFeature('autoMouthOnTalk')
                    && !responsiveOwns('mouth')
                    && isSimpleChat(text)
                        ? getSpeechDuration(text)
                        : 0;

                mouthDelayTimer = later(() => {
                    mouthDelayTimer = null;
                    if (!getFeature('chatEmoticons') || !canUseExpressionEngine() || globalThis.CurrentScreen !== 'ChatRoom') return;
                    
                    holdFace('LceEmoticon', face, duration, { SingleEye: 'Eyes2' in face,
                        Expression: Object.fromEntries(Object.entries(face).map(([group, expression]) =>
                            [group, [{ Expression: expression, Duration: duration }]])),
                    });
                }, delay);
            }
        }
        return next(args);
    });

    // A temporary last-resort AudioActions entry leaves native and other
    // plugins' sounds first. BC still applies its mute/volume/involvement rules.
    hook('AudioPlaySoundForChatMessage', 0, (args, next) => {
        const sound = getFeature('richerActivitySounds') && echoSound(args[0]);
        const actions = globalThis.AudioActions;
        if (!sound || !Array.isArray(actions)) return next(args);
        const fallback = { IsAction: data => data === args[0], GetSoundEffect: () => sound };
        actions.push(fallback);
        try { return next(args); }
        finally { const index = actions.indexOf(fallback); if (index >= 0) actions.splice(index, 1); }
    });

    // Manual pose changes cancel our sequence before the engine records them.
    for (const fn of ['CharacterSetActivePose', 'PoseSetActive']) hook(fn, 50, (args, next) => {
        if (args[0] === globalThis.Player) stopPetsuitAnimation(false);
        return next(args);
    });
    hook('ChatRoomLeave', 50, (args, next) => { 
        stopPetsuitAnimation(); 
        renderers.clear(); 
        cancelLater(mouthDelayTimer);
        mouthDelayTimer = null;
        return next(args); 
    });
    hook('CharacterAppearanceBuildCanvas', 10, (args, next) => {
        const character = args[0];
        const entry = renderers.get(character?.MemberNumber);
        if (!entry || entry.char !== character || Date.now() >= entry.until || !wearsPetsuit(character)) return next(args);
        if (character === globalThis.Player && (!animation || !canAnimate())) return next(args);
        try {
            const raisedLeft = Math.floor((Date.now() - entry.start) / entry.delay) % 2 === 0;
            return drawAlternatingPetsuit(character, raisedLeft, () => next(args));
        } catch (error) {
            // A changed drawing API must not leave the character half-rendered.
            renderers.delete(character.MemberNumber);
            if (character === globalThis.Player) stopPetsuitAnimation(false);
            return next(args);
        }
    });
    hook('DrawProcess', 10, (args, next) => { const result = next(args); drawPetsuitButton(); return result; });
    hook('ChatRoomClick', 20, (args, next) => {
        if (showPetsuitButton() && MouseIn(...petsuitButtonRect())) { togglePetsuitAnimation(); return; }
        return next(args);
    });
    setInterval(updateAnimationState, 250);
}
