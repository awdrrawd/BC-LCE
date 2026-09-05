/** Send a public action through BC. This is not a local notification. */
export function sendActionText(text) {
    if (!text || typeof ServerSend !== 'function') return;
    ServerSend('ChatRoomChat', {
        Content: 'CUSTOM_SYSTEM_ACTION',
        Type: 'Action',
        Dictionary: [{ Tag: 'MISSING TEXT IN "Interface.csv": CUSTOM_SYSTEM_ACTION', Text: text }],
    });
}
