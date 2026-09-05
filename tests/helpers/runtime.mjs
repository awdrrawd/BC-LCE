import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Deliberately rejects HTML writes in text-renderer tests. Other UI fixtures may opt in.
export class Element {
    constructor(tag = 'div', text = '', strict = false) {
        this.tagName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : tag === '#fragment' ? 11 : 1;
        this.childNodes = []; this.dataset = {}; this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
        this.attributes = {}; this.listeners = new Map(); this.value = ''; this.strict = strict; this._text = text;
        this.classList = {
            contains: c => this.className.split(' ').includes(c),
            add: (...cs) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...cs])].join(' '); },
            remove: (...cs) => { this.className = this.className.split(' ').filter(c => !cs.includes(c)).join(' '); },
            toggle: (c, force) => { const on = force ?? !this.classList.contains(c); this.classList[on ? 'add' : 'remove'](c); return on; },
        };
        this.className = ''; this.scrollHeight = 100; this.scrollTop = 0; this.clientHeight = 100;
    }
    get children() { return this.childNodes.filter(n => n.nodeType === 1); }
    contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
    get firstChild() { return this.childNodes[0]; }
    get previousElementSibling() { const siblings = this.parentElement?.children ?? []; return siblings[siblings.indexOf(this) - 1] ?? null; }
    get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(n => n.textContent).join(''); }
    set textContent(text) { this.childNodes = []; if (String(text)) this.append(new Element('#text', String(text))); }
    set innerHTML(html) { if (this.strict || html) throw Error('Unexpected HTML parsing'); this.replaceChildren(); }
    append(...nodes) {
        for (let node of nodes) {
            if (typeof node === 'string') node = new Element('#text', node);
            if (node.nodeType === 11) { this.append(...Array.from(node.childNodes)); continue; }
            node.remove(); node.parentElement = this; this.childNodes.push(node);
        }
    }
    appendChild(node) { this.append(node); return node; }
    removeChild(node) { node.remove(); return node; }
    replaceChildren(...nodes) { for (const n of [...this.childNodes]) n.remove(); this.append(...nodes); }
    remove() { if (this.parentElement) { const p = this.parentElement; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentElement = null; } }
    replaceWith(fragment) {
        const p = this.parentElement, index = p.childNodes.indexOf(this);
        const nodes = fragment.nodeType === 11 ? [...fragment.childNodes] : [fragment];
        for (const n of nodes) { n.remove(); n.parentElement = p; }
        p.childNodes.splice(index, 1, ...nodes); this.parentElement = null;
    }
    matches(selector) {
        return selector.split(',').some(s => {
            const attrs = [...s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
            s = s.replace(/\[[^\]]+\]/g, '');
            const hit = !s || (s.startsWith('.') ? this.classList.contains(s.slice(1)) : s.startsWith('#') ? this.id === s.slice(1) : this.tagName === s.toUpperCase());
            return hit && attrs.every(([, key, value]) => this.getAttribute(key) != null && (value === undefined || this.getAttribute(key) === value));
        });
    }
    closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) ?? null; }
    querySelectorAll(s) { return this.children.flatMap(n => [...(n.matches(s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
    setAttribute(k, v) { if (k === 'class') this.className = v; else this.attributes[k] = String(v); }
    getAttribute(k) { return k.startsWith('data-') ? this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? this.attributes[k] ?? null : this.attributes[k] ?? null; }
    toggleAttribute(k, force) { if (force) this.setAttribute(k, ''); else delete this.attributes[k]; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatchEvent(event) { for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event); return true; }
    focus() {} blur() {}
}

export function documentFixture(strict = false) {
    const doc = new Element('document');
    doc.body = new Element('body'); doc.head = new Element('head'); doc.documentElement = new Element('html');
    doc.documentElement.append(doc.head, doc.body); doc.append(doc.documentElement);
    doc.createElement = tag => new Element(tag, '', strict);
    doc.createTextNode = text => new Element('#text', text, strict);
    doc.createDocumentFragment = () => new Element('#fragment');
    doc.getElementById = id => doc.querySelector('#' + id);
    return doc;
}

export function runtime({ globals = {}, mocks = {}, append = {} } = {}) {
    const events = [], warnings = [], hooks = new Map(), storage = new Map();
    const doc = documentFixture();
    const window = new Element('window'); window.location = { href: 'https://example.com/R/' };
    window.innerWidth = 1000; window.innerHeight = 700; window.visualViewport = new Element('viewport');
    const originalDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = event => { events.push(event); return originalDispatch(event); };
    const context = vm.createContext({
        window, document: doc, URL, Blob, TextEncoder, TextDecoder, structuredClone, crypto: webcrypto,
        // WebCrypto runs in the host realm. Node 20 rejects foreign-realm
        // ArrayBuffers in decrypt(), so expose matching binary constructors.
        ArrayBuffer, Uint8Array, DataView,
        btoa, atob, console: { debug() {}, info() {}, log() {}, error() {}, warn: (...args) => warnings.push(args) },
        setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        navigator: { storage: {} }, performance, Node: { TEXT_NODE: 3 },
        CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
        ...globals,
    });
    const modApi = {
        hookFunction(name, priority, fn) { hooks.set(name, fn); return () => hooks.delete(name); },
        patchFunction() {}, removePatches() {}, callOriginal() {},
    };
    const replacements = { 'src/modsdk.js': { default: modApi }, 'src/core/i18n.js': { T: k => k }, ...mocks };
    const cache = new Map();
    const getModule = id => {
        if (cache.has(id)) return cache.get(id);
        const mock = replacements[id] || (id.includes('?inline') || id.endsWith('.svg') ? { default: '' } : null);
        const module = mock
            ? new vm.SyntheticModule(Object.keys(mock), function () { for (const [key, value] of Object.entries(mock)) this.setExport(key, value); }, { context, identifier: id })
            : new vm.SourceTextModule(fs.readFileSync(id, 'utf8') + '\n' + (append[id] || ''), {
                context, identifier: id,
                initializeImportMeta(meta) { meta.glob = () => ({}); },
            });
        cache.set(id, module); return module;
    };
    const resolve = (specifier, parent) => specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(parent), specifier)) : specifier;
    return {
        context, events, hooks, storage, warnings, document: doc, window,
        async load(id) {
            const module = getModule(id);
            if (module.status === 'unlinked') await module.link((specifier, parent) => getModule(resolve(specifier, parent.identifier)));
            if (module.status !== 'evaluated') await module.evaluate();
            return module.namespace;
        },
    };
}
