import { parseJSON } from '../../core/serialization.js';

export const META = ''; // BcUtil/WCE wire format; retain for interoperability.

export function stripBeepMetadata(message) {
    return String(message ?? '').split(META)[0].trimEnd();
}

export function decodeMessage(message) {
    const lines = String(message ?? '').split('\n');
    const details = parseJSON(lines.find(line => line.startsWith(META))?.substring(1) ?? '{}');
    return {
        messageText: lines.filter(line => !line.startsWith(META)).join('\n').trimEnd(),
        messageType: ['Message', 'Emote', 'Action'].includes(details?.messageType) ? details.messageType : 'Message',
        messageColor: typeof details?.messageColor === 'string' ? details.messageColor : '#ffffff',
    };
}

export function encodeMessage(text, messageType, messageColor) {
    return `${text}\n\n${META}${JSON.stringify({ messageType, messageColor })}`;
}

export function composeMessage(text, color) {
    let messageType = 'Message';
    if (text.startsWith('/me ')) { text = text.substring(4); if (!/^[', ]/u.test(text)) text = ` ${text}`; messageType = 'Emote'; }
    else if (text.startsWith('/action ')) { text = text.substring(8); messageType = 'Action'; }
    else if (/^\*[^*]/u.test(text)) { text = text.substring(1); if (!/^[', ]/u.test(text)) text = ` ${text}`; messageType = 'Emote'; }
    else if (text.startsWith('**')) { text = text.substring(2); messageType = 'Action'; }

    return encodeMessage(text, messageType, color);
}
