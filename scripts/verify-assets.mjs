import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';

const {commit} = JSON.parse(readFileSync('assets.lock.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid assets commit');

const git = (...args) => execFileSync('git', args, {maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const hasGitWorkTree = (() => {
    try { return git('rev-parse', '--is-inside-work-tree').toString().trim() === 'true'; }
    catch { return false; }
})();

// GitHub's source archive ZIPs do not contain .git and therefore cannot fetch or verify the
// pinned assets branch. Building such an archive should still work; the optional login media
// simply remains unavailable unless an assets/ directory was supplied separately.
if (!hasGitWorkTree) {
    const root = resolve('assets');
    if (existsSync(root)) {
        console.warn(`[assets] Git metadata unavailable; skipped verification for ${root}.`);
    } else {
        console.warn('[assets] Git metadata unavailable and assets/ is absent; continuing without optional login media.');
    }
} else {
    try { git('cat-file', '-e', `${commit}^{commit}`); }
    catch { git('fetch', '--depth=1', 'origin', commit); }

    const entries = git('ls-tree', '-rz', commit, '--', 'assets').toString().split('\0').filter(Boolean);
    if (!entries.length) throw Error('Pinned commit contains no assets');
    const root = resolve('assets'), missing = [];
    for (const entry of entries) {
        const match = /^(100644|100755) blob ([a-f0-9]{40})\t(assets\/[^\r\n]+)$/.exec(entry);
        if (!match) throw Error(`Unsupported asset entry: ${entry}`);
        const [, , hash, name] = match, target = resolve(name);
        if (!target.startsWith(root + sep)) throw Error('Unsafe asset path');
        if (!existsSync(target)) { missing.push({hash, target}); continue; }
        const data = readFileSync(target);
        const actual = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
        if (actual !== hash) throw Error(`Asset differs: ${name}. Back up/move it before retrying; no files overwritten.`);
    }
    for (const {hash, target} of missing) {
        mkdirSync(dirname(target), {recursive: true});
        writeFileSync(target, git('cat-file', 'blob', hash), {flag: 'wx'});
    }
    console.log(`[assets] Verified ${entries.length} files at ${commit}; restored ${missing.length}.`);
}
