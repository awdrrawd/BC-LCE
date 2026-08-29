const STYLE_ID = 'lce-modal-style';
const ROOT_ID = 'lce-modal-root';

function pcmModals() {
    const api = window.Liko?.PCMApi?.modals;
    return api && (typeof api.open === 'function' || typeof api.openAsync === 'function') ? api : null;
}

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;padding:12px;background:#0005;font:16px Arial,sans-serif}
.lce-modal{width:min(900px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:18px 20px;border:1px solid var(--lce-accent,#8ab4f8);border-radius:0 0 16px 16px;background:var(--lce-main,#202124);color:var(--lce-text,#f2f2f2);box-shadow:0 18px 55px #0009;animation:lce-modal-in .24s ease-out both}.lce-modal.closing{animation:lce-modal-out .2s ease-in both}.lce-modal-prompt{line-height:1.5;overflow-wrap:anywhere}.lce-modal-input{box-sizing:border-box;width:100%;margin-top:14px;padding:10px;border:1px solid #ffffff35;border-radius:8px;background:#0004;color:inherit;font:inherit}.lce-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:15px;flex-wrap:wrap}.lce-modal-actions button{min-width:120px;padding:10px 16px;border:0;border-radius:9px;background:#ffffff20;color:inherit;font:inherit;font-weight:700;cursor:pointer}.lce-modal-actions button:hover{filter:brightness(1.2)}.lce-modal-actions [data-action="always"]{background:var(--lce-accent,#4d86c6);color:#fff}.lce-modal-actions [data-action="cancel"]{background:#b04444;color:#fff}
@keyframes lce-modal-in{from{transform:translateY(-130%);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes lce-modal-out{from{transform:translateY(0);opacity:1}to{transform:translateY(-130%);opacity:0}}
`;
    document.head.appendChild(style);
}

const localQueue = [];
let localActive = false;

function drainLocalQueue() {
    if (localActive || !localQueue.length) return;
    localActive = true;
    const { options, resolve } = localQueue.shift();
    injectStyle();
    const root = document.createElement('div'); root.id = ROOT_ID;
    const modal = document.createElement('section'); modal.className = 'lce-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    const prompt = document.createElement('div'); prompt.className = 'lce-modal-prompt';
    if (typeof options.prompt === 'string') prompt.textContent = options.prompt;
    else if (options.prompt instanceof Node) prompt.append(options.prompt);
    modal.appendChild(prompt);

    let input = null;
    if (options.input) {
        input = document.createElement(options.input.type === 'textarea' ? 'textarea' : 'input');
        input.className = 'lce-modal-input';
        if (input instanceof HTMLTextAreaElement) input.rows = 8;
        input.value = String(options.input.initial ?? '');
        input.readOnly = !!options.input.readonly;
        input.addEventListener('keydown', event => event.stopPropagation());
        modal.appendChild(input);
    }

    const actions = document.createElement('div'); actions.className = 'lce-modal-actions';
    const labels = options.buttons && typeof options.buttons === 'object' ? options.buttons : {};
    const buttons = [['submit', labels.submit || 'OK'], ...Object.entries(labels).filter(([action]) => action !== 'submit')];
    let settled = false;
    const finish = action => {
        if (settled) return;
        settled = true;
        actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
        modal.classList.add('closing');
        const remove = () => {
            if (!root.isConnected) return;
            root.remove();
            try { options.callback?.(action, input?.value); }
            finally { resolve([action, input?.value ?? null]); localActive = false; queueMicrotask(drainLocalQueue); }
        };
        modal.addEventListener('animationend', remove, { once: true });
        setTimeout(remove, 260);
    };
    for (const [action, label] of buttons) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action;
        button.textContent = String(label); button.addEventListener('click', () => finish(action)); actions.appendChild(button);
    }
    root.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Escape' && Object.prototype.hasOwnProperty.call(labels, 'cancel')) { event.preventDefault(); finish('cancel'); }
    });
    modal.appendChild(actions); root.appendChild(modal); document.body.appendChild(root);
    (input || actions.querySelector('button'))?.focus();
}

function openLocalAsync(options) {
    return new Promise(resolve => { localQueue.push({ options, resolve }); drainLocalQueue(); });
}

/** PCM 有原生 modal 時使用 PCM；否則使用 LCE 完整本地後備。 */
export async function openModalAsync(options) {
    const api = pcmModals();
    if (api) {
        try {
            if (typeof api.openAsync === 'function') return await api.openAsync(options);
            return await new Promise(resolve => api.open({ ...options, callback: (action, value) => resolve([action, value ?? null]) }));
        } catch (error) { console.warn('🐈‍⬛ [LCE] PCM modal 失敗，改用本地對話框:', error); }
    }
    return openLocalAsync(options);
}

export function openModal(options) {
    const api = pcmModals();
    if (api && typeof api.open === 'function') {
        try { api.open(options); return; }
        catch (error) { console.warn('🐈‍⬛ [LCE] PCM modal 失敗，改用本地對話框:', error); }
    }
    void openLocalAsync(options).catch(error => console.warn('🐈‍⬛ [LCE] modal 失敗:', error));
}

export async function confirmModal(prompt, { confirm = 'OK', cancel = 'Cancel' } = {}) {
    const [action] = await openModalAsync({ prompt, buttons: { submit: confirm, cancel } });
    return action === 'submit';
}
