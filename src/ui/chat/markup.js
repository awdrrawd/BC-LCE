/** Transform text nodes only. Existing links, controls and plugin-owned nodes stay intact. */
export function decorateChatText(element, findCommand) {
    const visit = parent => {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType === 1) {
                if (!node.matches('a,button,input,textarea,script,style,.lceRoom,.lceCmd,[data-liko-processed="1"]')) visit(node);
                continue;
            }
            if (node.nodeType !== 3 || /https?:\/\//i.test(node.textContent)) continue;
            const text = node.textContent;
            const pattern = /#([^#\n\r]{1,50})#|(^|\s)(\/[\p{L}\p{N}_-]+)/gu;
            const fragment = document.createDocumentFragment();
            let offset = 0;
            for (const match of text.matchAll(pattern)) {
                const room = match[1]?.trim();
                const command = match[3] && findCommand(match[3].slice(1));
                if (!room && !command) continue;
                fragment.append(document.createTextNode(text.slice(offset, match.index)));
                const span = document.createElement('span');
                span.style.cursor = 'pointer';
                if (room) {
                    span.className = 'lceRoom';
                    span.style.color = '#65b5ff';
                    span.dataset.room = room;
                    span.textContent = `🚪${match[1]}🚪`;
                } else {
                    fragment.append(document.createTextNode(match[2]));
                    span.className = 'lceCmd';
                    span.style.color = '#ff65f2';
                    span.dataset.cmd = match[3];
                    span.dataset.desc = command.Description || '';
                    span.textContent = match[3];
                }
                fragment.append(span);
                offset = match.index + match[0].length;
            }
            if (offset) {
                fragment.append(document.createTextNode(text.slice(offset)));
                node.replaceWith(fragment);
            }
        }
    };
    visit(element);
}
