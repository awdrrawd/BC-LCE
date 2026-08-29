// ════════════════════════════════════════════════════════════════════════════
// 聊天鏈接與嵌入（augmentChat）＋ 改善顏色可讀性（chatColors）
// 移植自 WCE chatAugments.js / wceStyles.ts。
//   augmentChat：把訊息中的網址轉成連結；可信任網域的圖片直接內嵌；#rrggbb 顯示色塊。
//               非可信任網域只給一顆「(嵌入)」讓使用者本次連線授權（同 WCE）。
//   chatColors ：body 掛 lce-colors class，調整悄悄話對比與深色輸入框。
// ════════════════════════════════════════════════════════════════════════════

import { getFeature } from '../core/feature-settings.js';
import { T } from '../core/i18n.js';
import { shouldLceHandle } from '../core/wce-compat.js';
import { isOriginTrusted, requestOriginTrust, sessionCustomOrigins } from './trusted-domains.js';

const STYLE_ID = 'lce-augment-style';
const HANDLED_ATTR = 'data-lce-handled';
const CHATLOG = 'TextAreaChatLog';

const EMBED = { Image: 'img', None: '', Untrusted: 'none-img' };

// 要處理連結/嵌入的訊息類型（對應 BC 的 ChatMessage${Type} class）。
// Emote(*…*) 與 Action(…) 的網址也轉連結。
const MSG_CLASSES = ['ChatMessageChat', 'ChatMessageWhisper', 'ChatMessageEmote', 'ChatMessageAction'];

// 保留舊 import 路徑，讓已引用 chat-augments 的 LCE 模組不必同步改動。
export { sessionCustomOrigins } from './trusted-domains.js';

const TRUSTED_HOSTS = [
    'cdn.discordapp.com', 'media.discordapp.com', 'i.imgur.com',
    'tenor.com', 'c.tenor.com', 'media.tenor.com',
    'i.redd.it', 'puu.sh', 'fs.kinkop.eu',
    'bondageprojects.elementfx.com', 'www.bondageprojects.elementfx.com',
    'bondage-europe.com', 'www.bondage-europe.com',
    'bondage-asia.com', 'www.bondage-asia.com',
    'bondageprojects.com', 'www.bondageprojects.com',
];

function parseUrl(word) {
    // Emote 整段包在 *…* 內，URL 落在頭/尾時會沾到星號；星號不是合法 URL 邊界字元，去掉再解析。
    const star = word.replace(/^\*+/u, '').replace(/\*+$/u, '');
    if (star !== word) return parseUrl(star);
    // Action 整段包在 (…) 內
    const t = /^\((.+)\)$/.exec(word);
    if (t) return parseUrl(t[1]);
    try {
        const url = new URL(word);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        return url;
    } catch { return false; }
}

// 可內嵌的圖片副檔名（比 WCE 原本的 png/jpg/webp/gif 更廣）：
//   bmp / avif / apng / jfif / ico  瀏覽器 <img> 都支援；svg 以 <img> 載入時不會執行內嵌
//   腳本（沙盒化），且非信任來源仍要先確認，故一併納入。
// 副檔名比對用 url.pathname（不含 ?query#hash），所以帶查詢字串的圖片網址仍能命中。
const IMAGE_EXT_RE = /\/[^/]+\.(png|jpe?g|gif|webp|bmp|avif|apng|jfif|svg|ico)$/iu;

function allowedToEmbed(url) {
    const trusted = TRUSTED_HOSTS.includes(url.host) || isOriginTrusted(url.origin)
        || sessionCustomOrigins.get(url.origin) === 'allowed';
    if (IMAGE_EXT_RE.test(url.pathname)) {
        return trusted ? EMBED.Image : EMBED.Untrusted;
    }
    return EMBED.None;
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.lce-img-link{vertical-align:top;}
/* 邊框吃主題強調色（主題關閉時 fallback 回原本的紅色） */
.lce-img{max-height:25rem;max-width:90%;display:inline;border:1px solid var(--lce-accent,red);padding:0.1rem;}
.lce-color{width:0.8em;height:0.8em;display:inline-block;vertical-align:middle;border:0.1em solid black;margin-right:0.1em;}
/* BIO 的富文本唯讀檢視：跟 BIO 輸入框一樣吃 element 色（主題關閉時 fallback 回原本的羊皮紙色） */
.lce-rich-textarea{overflow-y:scroll;overflow-x:hidden;overflow-wrap:break-word;white-space:pre-wrap;padding:2px;
  background:var(--lce-element,rgb(244,236,216));color:var(--lce-text,rgb(45,35,27));
  border:2px solid var(--lce-accent,black);}
.lce-rich-textarea a{color:rgb(55,55,255);}
#${CHATLOG} a{color:#003f91;cursor:pointer;}
#${CHATLOG} a:visited{color:#380091;}
#${CHATLOG}[data-colortheme="dark"] a,#${CHATLOG}[data-colortheme="dark2"] a{color:#a9ceff;}
#${CHATLOG}[data-colortheme="dark"] a:visited,#${CHATLOG}[data-colortheme="dark2"] a:visited{color:#3d91ff;}
/* chatColors：提高悄悄話與輸入框對比 */
.lce-colors div.ChatMessageWhisper{color:#646464;}
.lce-colors #${CHATLOG}[data-colortheme="dark"] div.ChatMessageWhisper,
.lce-colors #${CHATLOG}[data-colortheme="dark2"] div.ChatMessageWhisper{color:#828282;}
.lce-colors .bce-dark-input{background-color:#111;color:#eee;border-color:#333;}
`;
    document.head.appendChild(s);
}

/**
 * 把一行訊息中的網址/色碼轉成連結、圖片與色塊（移植 WCE processChatAugmentsForLine）。
 * @param {Element} el         訊息內容節點
 * @param {() => void} scrollToEnd
 * @param {boolean} [isChat]
 */
export function processChatAugmentsForLine(el, scrollToEnd, isChat) {
    const newChildren = [];
    let originalText = '';

    for (const node of el.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) { newChildren.push(node); continue; }
        const contents = node.textContent ?? '';
        const words = [contents];
        originalText += contents;

        for (let i = 0; i < words.length; i++) {
            // 依空白切詞
            const wsIdx = words[i].search(/[\s\r\n]/u);
            if (wsIdx >= 1) {
                words.splice(i + 1, 0, words[i].substring(wsIdx));
                words[i] = words[i].substring(0, wsIdx);
            } else if (wsIdx === 0) {
                words.splice(i + 1, 0, words[i].substring(1));
                [words[i]] = words[i];
                newChildren.push(document.createTextNode(words[i]));
                continue;
            }

            const url = parseUrl(words[i]);
            if (url) {
                let domNode;
                const linkNode = document.createElement('a');
                newChildren.push(linkNode);
                const embedType = allowedToEmbed(url);
                if (embedType === EMBED.Image) {
                    const img = document.createElement('img');
                    img.src = url.href;
                    img.alt = url.href;
                    img.onload = scrollToEnd;
                    img.classList.add('lce-img');
                    linkNode.classList.add('lce-img-link');
                    domNode = img;
                } else {
                    domNode = document.createTextNode(url.href);
                    if (embedType !== EMBED.None) {
                        // 非可信任網域：可選永久信任、本次信任或拒絕。
                        const promptTrust = document.createElement('a');
                        promptTrust.href = '#';
                        promptTrust.title = T('augment_trust_session');
                        promptTrust.textContent = T('augment_embed');
                        promptTrust.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const target = e.currentTarget;
                            requestOriginTrust(url.origin, T('domain_image'), { persistent: true }).then((act) => {
                                if (act !== 'submit' && act !== 'always') return;
                                const parent = target.parentElement;
                                if (!parent) return;
                                parent.removeChild(target);
                                // 下面會清空 parent 重建，得先把名稱節點撈出來保住。
                                // 聊天室的名稱是 .ChatMessageName，即時通信的是 .lce-msg-sender —— 兩邊都要認，
                                // 只認前者的話 IM 的名稱會被 innerHTML='' 清掉且補不回來。
                                const name = parent.querySelector('.ChatMessageName, .lce-msg-sender');
                                parent.innerHTML = '';
                                if (name) { parent.appendChild(name); parent.appendChild(document.createTextNode(' ')); }
                                const ogText = (isChat ? parent.parentElement : parent)?.getAttribute('lce-original-text');
                                if (!ogText) return;
                                parent.appendChild(document.createTextNode(ogText));
                                processChatAugmentsForLine(el, scrollToEnd, true);
                            });
                        };
                        newChildren.push(document.createTextNode(' '));
                        newChildren.push(promptTrust);
                    }
                }
                linkNode.href = url.href;
                linkNode.title = url.href;
                linkNode.target = '_blank';
                linkNode.appendChild(domNode);
            } else if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/u.test(words[i])) {
                const color = document.createElement('span');
                color.classList.add('lce-color');
                color.style.background = words[i];
                newChildren.push(color);
                newChildren.push(document.createTextNode(words[i]));
            } else {
                newChildren.push(document.createTextNode(words[i]));
            }
        }
    }

    while (el.firstChild) el.removeChild(el.firstChild);
    for (const child of newChildren) el.appendChild(child);
    (isChat ? el.parentElement : el)?.setAttribute('lce-original-text', originalText);
}

/**
 * 把「連到圖片、允許內嵌、但還是純連結」的 <a> 升級成內嵌圖片。
 * 用途：別的擴充（例如 WCE）可能搶先處理過訊息，卻不認得某些格式（BMP/WEBP…），
 * 只把網址轉成純連結；此時原本的文字節點已變成 <a>，LCE 的逐字處理（只認文字節點）
 * 就碰不到它。這一輪把 LCE 支援、且來源可信任的圖片連結補成真正的圖片，
 * 讓「WCE + LCE 同時裝」時仍能顯示這些格式。對 LCE 自己已內嵌的圖片（anchor 內已有 img）不動。
 */
function upgradeImageAnchors(root) {
    if (!root) return;
    for (const a of root.querySelectorAll('a[href]')) {
        if (a.querySelector('img')) continue;               // 已是圖片，不重複處理
        let url;
        try { url = new URL(a.href); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        if (allowedToEmbed(url) !== EMBED.Image) continue;  // 非圖片、或來源未信任 → 不動
        const img = document.createElement('img');
        img.src = url.href;
        img.alt = url.href;
        img.classList.add('lce-img');
        a.classList.add('lce-img-link');
        while (a.firstChild) a.removeChild(a.firstChild);
        a.appendChild(img);
    }
}

/** 掃描尚未處理的聊天訊息並套用嵌入；同時同步 chatColors 的 body class。 */
function scan() {
    // chatColors：可讀性調色（body class 切換即可，關閉時自動還原）
    document.body?.classList.toggle('lce-colors', !!getFeature('chatColors'));

    if (CurrentScreen !== 'ChatRoom' || !shouldLceHandle('augmentChat')) return;
    const unhandled = document.querySelectorAll(`.ChatMessage:not([${HANDLED_ATTR}=true])`);
    for (const msgEl of unhandled) {
        msgEl.setAttribute(HANDLED_ATTR, 'true');
        if (!MSG_CLASSES.some((c) => msgEl.classList.contains(c))) continue;
        if (msgEl.classList.contains('lce-pending')) continue;

        // 有 msgId 的訊息文字包在 .chat-room-message-content span 內；
        // 沒有 msgId 的 Action/Emote，BC 直接把文字掛在訊息 div 底下，沒有 span，
        // 這時退而處理整個訊息 div（.chat-room-metadata 是元素節點，不會被 linkify）。
        const contentSpan = msgEl.querySelector('.chat-room-message-content');
        const content = contentSpan || msgEl;

        const scrolledToEnd = ElementIsScrolledToEnd(CHATLOG);
        processChatAugmentsForLine(content, () => { if (scrolledToEnd) ElementScrollToEnd(CHATLOG); }, !!contentSpan);
        // 補救別的擴充留下的純圖片連結（例如 WCE 不認得的 BMP/WEBP）——
        // 掃整個訊息 div，把可信任的圖片連結升級成內嵌圖片。
        upgradeImageAnchors(msgEl);
        if (scrolledToEnd) ElementScrollToEnd(CHATLOG);
    }
}

let installed = false;

export function installChatAugments() {
    if (installed) return;
    installed = true;
    injectStyle();
    setInterval(() => { try { scan(); } catch { /* ignore */ } }, 500);
}
