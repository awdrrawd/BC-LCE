import { faces, knownEchoNames, mappings, targetOnly, senderOnly } from './qol-data.js';

const DEFAULT_EMOTICON_DURATION = 5000;
const SLASH_DURATION_STEP = 1000;
const MAX_SLASH_EMOTICON_DURATION = 30000;

// Single definition of a "slash run" (2+ slashes/backslashes) shared by the blush
// level in emoticonExpression() and the hold time in emoticonDuration().
const SLASH_RUN = /[/\\]{2,}/;
const slashRunLength = token => token.match(SLASH_RUN)?.[0].length ?? 0;

function getPunctuationEffect(str) {
    if (str.includes('?')) {
        return {
            Emoticon: 'Confusion',
            Eyebrows: (str.includes('?!') || str.includes('!?')) ? 'Angry' : 'OneRaised'
        };
    } else if (str.includes('!')) {
        let brows = null;
        if (str.match(/!{3,}/)) brows = 'Angry';
        else if (str.match(/!{2}/)) brows = 'Harsh';
        return { Emoticon: 'Exclamation', Eyebrows: brows };
    } else if (str.includes('#')) {
        return { Emoticon: 'Annoyed' };
    }
    return null;
}

// Chat-QoL feature ideas: Izumii99/BC-Desktop, Scripts/chat-qol.js.
// Rules are kept separate from execution so LCE owns timing and cancellation.
export function emoticonExpression(text) {
    const result = {};
    let lastPunctuation = null;
    let hasTextmojiEyebrows = false;

    // Whole tokens only: URLs, commands and substrings of ordinary words do
    // not accidentally trigger a face. Later textmoji tokens win for the same group.
    // Expressive punctuation is resolved after the loop: the last punctuation token's
    // Emoticon always wins over a textmoji's own Emoticon (Hearts, Tear, ...), and its
    // Eyebrows are only used when no textmoji set Eyebrows, regardless of token order.
    for (const token of String(text).split(/\s+/)) {
        if (/https?:\/\//i.test(token)) continue;

        let match = faces.find(([pattern]) => pattern.test(token));
        let baseToken = token;
        let strippedMarks = '';

        if (!match) {
            const markMatch = baseToken.match(/([?!#~;'",.]+)$/);
            if (markMatch) {
                strippedMarks = markMatch[1];
                baseToken = baseToken.slice(0, -strippedMarks.length);
                match = faces.find(([pattern]) => pattern.test(baseToken));
            }
        }

        if (!match) {
            const slashMatch = baseToken.match(/([/\\]{2,})$/);
            if (slashMatch) {
                baseToken = baseToken.slice(0, -slashMatch[1].length);
                match = faces.find(([pattern]) => pattern.test(baseToken));
            }
        }

        if (!match) {
            const preMatch = baseToken.match(/^([?!#]+)/);
            if (preMatch) {
                baseToken = baseToken.slice(preMatch[1].length);
                match = faces.find(([pattern]) => pattern.test(baseToken));
            }
        }

        if (match) {
            Object.assign(result, match[1]);
            if (match[1].Eyebrows !== undefined) hasTextmojiEyebrows = true;

            const count = slashRunLength(token);
            if (count) {
                const levels = { 2: 'Low', 3: 'Medium', 4: 'High', 5: 'VeryHigh', 6: 'Extreme' };
                result.Blush = levels[count] || 'Extreme';
                if (count >= 5) {
                    result.Emoticon = 'Hearts';
                }
            }

            // Additive sweatdrop: only if trailing marks were stripped and contained a sweatdrop char
            if (/['";]/.test(strippedMarks)) {
                result.Fluids = result.Fluids || 'TearsLow';
                result.Emoticon = 'Tear';
            }

            // Additive floating marks and expressive punctuation
            const allMarks = token.replace(baseToken, '');
            const effect = getPunctuationEffect(allMarks);
            if (effect) lastPunctuation = effect;
        } else {
            // Not a textmoji token, check if it's purely standalone punctuation
            // (Only ! ? and # since they trigger marks)
            const marksOnly = token.replace(/[^?!#]/g, '');
            if (marksOnly === token && marksOnly.length > 0) {
                const effect = getPunctuationEffect(token);
                if (effect) lastPunctuation = effect;
            }
        }
    }

    if (lastPunctuation) {
        result.Emoticon = lastPunctuation.Emoticon;
        if (lastPunctuation.Eyebrows && !hasTextmojiEyebrows) {
            result.Eyebrows = lastPunctuation.Eyebrows;
        }
    }

    return result;
}

// Slash/backslash blushes historically used the number of slashes as their
// hold time. Keep that behavior, while accepting longer runs instead of
// silently losing the blush when someone types more than five slashes.
export function emoticonDuration(text) {
    let duration = 0;
    for (const token of String(text).split(/\s+/)) {
        if (/https?:\/\//i.test(token)) continue;
        if (Object.keys(emoticonExpression(token)).length === 0) continue;
        const count = slashRunLength(token);
        if (count) duration = Math.max(duration, count * SLASH_DURATION_STEP);
    }
    return Math.min(Math.max(duration, DEFAULT_EMOTICON_DURATION), MAX_SLASH_EMOTICON_DURATION);
}

export function echoActivity(data) {
    if (data?.Type !== 'Activity' && data?.Type !== 'Emote' && data?.Type !== 'Action') return null;
    const dict = Array.isArray(data.Dictionary) ? data.Dictionary : [];
    const content = typeof data.Content === 'string' ? data.Content : '';
    
    const nameEntry = dict.find(d => typeof d.ActivityName === 'string');
    const labelEntry = dict.find(d => d.Tag === 'ActivityName' && typeof d.Text === 'string');
    let name = nameEntry?.ActivityName || labelEntry?.Text?.replace(/^Activity/, '');
    
    const isActivity = data?.Type === 'Activity';
    if (!name) {
        if (!isActivity) name = content;
        else name = content.replace(/^Chat(?:Other|Self)-[^-]+-/, '');
    }

    const markerTag = `MISSING TEXT IN "ActivityDictionary.csv": ${content}`;
    const markerEntry = isActivity
        ? dict.find(d => d?.Tag === markerTag && typeof d.Text === 'string')
        : null;

    const known = knownEchoNames.has(name);
    name = [name, markerEntry?.Text].filter(Boolean).join(' ');

    // Legacy fallbacks: older versions and specific mods use known names or the Luzi_ prefix 
    // without the missing-text marker. Retained for backwards compatibility.
    const custom = !isActivity || !!markerEntry || known || /Luzi_/i.test(content) || dict.some(d => /Luzi_/i.test(d.Tag || ''))
        || /Luzi_/i.test(nameEntry?.ActivityName || labelEntry?.Text || '');

    if (isActivity && !custom) return null;

    return { name, group: /^Chat(?:Other|Self)-([^-]+)-/.exec(content)?.[1], custom };
}

export function echoExpressionEvent(data, memberNumber) {
    // 自由文字 Emote/Action 只支援音效（echoSound），不觸發表情，避免 *licks the ice cream* 誤觸
    if (data?.Type !== 'Activity') return null;
    const activity = echoActivity(data);
    if (!activity) return null;
    const testName = activity.name.replace(/([a-z])([A-Z])/g, '$1 $2');
    const event = mappings.find(([, pattern]) => pattern.test(testName))?.[0];
    if (!event) return null;
    if (['LongKiss', 'KissOnLips'].includes(event) && activity.group !== 'ItemMouth') return null;
    const isTarget = data.Dictionary?.some(d => d.TargetCharacter === memberNumber
        || (d.Tag === 'TargetCharacter' && d.MemberNumber === memberNumber));
    const isSender = data.Sender === memberNumber;

    if (targetOnly.has(event)) return isTarget ? event : null;
    if (senderOnly.has(event)) return isSender ? event : null;
    if (!isTarget && !isSender) return null;
    return event;
}

export function echoSound(data) {
    const activity = echoActivity(data);
    if (!activity) return null;
    
    // Separate camelCase names (e.g. 'CustomSlap' -> 'Custom Slap') so boundary checks work
    const testName = activity.name.replace(/([a-z])([A-Z])/g, '$1 $2');
    
    if (/(?:^|[^a-z])(?:whip|鞭打)(?![a-z])/i.test(testName)) return 'WhipCrack';
    if (/(?:^|[^a-z])(?:spank|slap|flick|bap)(?:s|ped|ping)?(?![a-z])/i.test(testName) || /(?:拍打|打屁股|轻拍|轻弹|扇耳光)/.test(testName)) return 'SpankSkin';
    if (/(?:^|[^a-z])(?:pinch|掐|拧)(?![a-z])/i.test(testName)) return 'LeatherStretchingShort';
    if (/(?:^|[^a-z])hit(?:s|ting)?(?![a-z])/i.test(testName)) return 'SmackCrop';
    return null;
}
