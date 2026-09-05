// One observer owns incremental chat work. The lightweight tick only discovers a
// replaced log and feature/compatibility changes; it does not rescan unchanged logs.
const processors = new Set();
let root = null;
let observer = null;
let timer = null;

function run(processor, candidates) {
    for (const element of candidates) {
        if (!root?.contains(element)) continue;
        try { processor.process(element); }
        catch (error) { console.warn('🐈‍⬛ [LCE] 聊天處理失敗:', error); }
    }
}

function collect(node, selector, candidates, descendants = false) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element) return;
    const parent = element.closest(selector);
    if (parent) candidates.add(parent);
    if (descendants) element.querySelectorAll(selector).forEach(match => candidates.add(match));
}

function onMutations(records) {
    for (const processor of processors) {
        if (!processor.active) continue;
        try { if (!processor.enabled()) continue; }
        catch (error) { console.warn('🐈‍⬛ [LCE] 聊天處理狀態失敗:', error); continue; }
        const candidates = new Set();
        for (const record of records) {
            collect(record.target, processor.selector, candidates, record.type === 'attributes');
            for (const node of record.addedNodes || []) collect(node, processor.selector, candidates, true);
        }
        run(processor, candidates);
    }
}

function refresh() {
    const next = document.getElementById('TextAreaChatLog');
    const replaced = next !== root;
    if (replaced) {
        observer?.disconnect();
        root = next;
        if (root) {
            observer = new MutationObserver(onMutations);
            observer.observe(root, { childList: true, subtree: true, characterData: true,
                attributes: true, attributeFilter: ['class'] });
        }
    }
    for (const processor of processors) {
        try {
            processor.sync?.();
            const active = !!processor.enabled();
            if (root && active && (replaced || !processor.active)) {
                run(processor, root.querySelectorAll(processor.selector));
            }
            processor.active = active;
        } catch (error) { console.warn('🐈‍⬛ [LCE] 聊天監聽更新失敗:', error); }
    }
}

export function registerChatProcessor({ selector, enabled, process, sync }) {
    const processor = { selector, enabled, process, sync, active: false };
    processors.add(processor);
    refresh();
    if (timer === null) timer = setInterval(refresh, 500);
    return () => {
        processors.delete(processor);
        if (processors.size) return;
        observer?.disconnect(); observer = null; root = null;
        clearInterval(timer); timer = null;
    };
}
