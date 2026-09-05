import { LOCAL_MARKER } from '../../features/chat/local-messages.js';
let listening = false;
function installNotificationEvents() {
    if (listening) return;
    listening = true;
    document.addEventListener('click', event => {
        const button = event.target.closest?.('.lce-notify-close,.lce-notify-collapse');
        const notification = button?.closest('.lce-notification');
        if (!notification) return;
        event.preventDefault();
        if (button.classList.contains('lce-notify-close')) notification.remove();
        else button.textContent = notification.classList.toggle('lce-collapsed') ? '▼' : '▲';
    });
}

export function lceChatNotify(node, opts) {
    installNotificationEvents();
    const div = document.createElement('div');
    div.setAttribute('class', `ChatMessage lce-notification ${LOCAL_MARKER}`);
    div.setAttribute('data-time', typeof ChatRoomCurrentTime === 'function' ? ChatRoomCurrentTime() : '');
    div.setAttribute('data-sender', Player?.MemberNumber?.toString() ?? '');
    if (typeof node === 'string') div.appendChild(document.createTextNode(node));
    else if (Array.isArray(node)) div.append(...node);
    else div.appendChild(node);
    // 很長的訊息（versions、profiles…）右下角補工具列，讓使用者自己收合/刪掉、免得洗版。
    //   closable    → ✖ 刪除整則
    //   collapsible → ▼/▲ 收合本體，只留標記為 .lce-collapse-keep 的元素（通常是標題）與工具列
    if (opts?.closable || opts?.collapsible) {
        div.classList.add('lce-closable');
        const tools = document.createElement('div');
        tools.className = 'lce-notify-tools';
        if (opts?.collapsible) {
            div.classList.add('lce-collapsible');
            const c = document.createElement('button');
            c.type = 'button';
            c.className = 'lce-notify-collapse';
            c.textContent = '▲';
            c.title = '收合／展開';
            tools.appendChild(c);
        }
        if (opts?.closable) {
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'lce-notify-close';
            x.textContent = '✖';
            x.title = '刪除此訊息';
            tools.appendChild(x);
        }
        div.appendChild(tools);
    }
    if (typeof ChatRoomAppendChat === 'function') ChatRoomAppendChat(div);
    // 過一段時間自動移除（例如刪除確認框：只保留 10 秒，避免留在聊天室裡卡著）。
    if (opts?.autoRemoveMs > 0) {
        setTimeout(() => { try { div.remove(); } catch { /* 已被清掉就算了 */ } }, opts.autoRemoveMs);
    }
    return div;
}
