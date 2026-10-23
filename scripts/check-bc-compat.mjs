#!/usr/bin/env node
// 偵測 LCE 透過 ModSDK 掛鉤 / patch 的 Bondage Club 函式是否與基準不同（移植自 AEE 的 check-bc-compat.mjs）。
//
//   node scripts/check-bc-compat.mjs --bc-dir <BC 原始碼>            與已提交的基準比對
//   node scripts/check-bc-compat.mjs --bc-dir <BC 原始碼> --update   以該原始碼重寫基準
//
// 檢查三件事：
//   1. 目標函式還在不在（BC 改名 / 移除 → hook 會安裝失敗）。
//   2. 函式本體雜湊有沒有變（ModSDK 同款 CRC32，等於 getPatchingInfo().get(name).originalHash）。
//   3. patchFunction 的取代字串（pattern）是否仍存在於該函式本體 —— 這是 AEE 沒有、但 LCE 有的風險：
//      pattern 不見時 ModSDK 只會在 console 警告「Patch not applied」，功能卻靜默失效。
//
// 原始碼可以是程式碼鏡像（根目錄就有 Scripts/ 與 Screens/），也可以是上游 repo（在 BondageClub/ 底下）。
// `Namespace.method`（class 或物件字面量命名空間）以原始碼文字雜湊，僅用於偵測變動。
// 結束碼：0 = 一致、1 = 有差異、2 = 用法或解析錯誤。
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parse} from 'acorn';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_BASELINE = path.join(ROOT, 'scripts', 'bc-compat-baseline.json');

// LCE 的 hook 入口有好幾種寫法：ModSDK 原生 API、createHook() 回傳的 hook / registerHook、
// 各檔自己包的 patch()，以及 createHook('x')('Name', …) 的行內形式。
const HOOK_CALLEES = new Set(['hookFunction', 'patchFunction', 'removePatches', 'callOriginal', 'getOriginalHash', 'hook', 'registerHook', 'patch']);
const PATCH_CALLEES = new Set(['patch', 'patchFunction']);
const BC_NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
// 這些檔案本身就是 hook 包裝層或 SDK（參數是變數、不是 BC 函式名）。
const SKIPPED_SOURCES = new Set(['src/modsdk.js', 'src/core/hooks.js']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const posix = file => file.split(path.sep).join('/');

/** ModSDK 計算 originalHash 的 CRC32（大寫 8 位十六進位）。 */
export function crc32(text) {
  let crc = -1;
  for (const byte of new TextEncoder().encode(text)) {
    let value = 255 & (crc ^ byte);
    for (let bit = 0; bit < 8; bit++) value = 1 & value ? -306674912 ^ value >>> 1 : value >>> 1;
    crc = crc >>> 8 ^ value;
  }
  return ((-1 ^ crc) >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export const hashSource = source => crc32(source.replaceAll('\r\n', '\n'));

const stringOf = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
};

const calleeName = callee => callee.type === 'Identifier' ? callee.name
  : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : '';

/** createHook('label')('Name', …) 這種行內形式：callee 本身是 createHook(...) 的呼叫。 */
const isInlineCreateHook = callee => callee.type === 'CallExpression' && calleeName(callee.callee) === 'createHook';

/**
 * 以 AST 在單一檔案中找出 BC 函式名稱。
 *  - 字面量名稱：直接收集。
 *  - 迴圈 `for (const fn of ['A', 'B']) hook(fn, …)`：展開成一組「擇一」名稱（BC 改名時兩個名字只會有一個存在）。
 *  - 包裝函式把自己的參數原樣轉手（`function patch(name, patches) { modApi.patchFunction(name, …) }`）：略過，
 *    真正的名稱出現在呼叫它的地方。
 *  - 其他非字面量：列為 dynamic，無法檢查。
 */
export function scanSource(text, relative) {
  const result = {names: [], dynamic: [], patches: [], parseError: undefined};
  let ast;
  try {
    ast = parse(text, {ecmaVersion: 'latest', sourceType: 'module', locations: true});
  } catch (error) {
    result.parseError = `${relative}: ${error.message}`;
    return result;
  }
  // 模組頂層的 `const X = ['a', 'b']`，讓 `for (const fn of X)` 也能展開。
  const constArrays = new Map();
  for (const node of ast.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const item of declaration.declarations) {
      if (item.id.type === 'Identifier' && item.init?.type === 'ArrayExpression') {
        const values = item.init.elements.map(stringOf);
        if (values.length && values.every(value => typeof value === 'string')) constArrays.set(item.id.name, values);
      }
    }
  }
  const parameters = []; // 外層函式的參數名稱堆疊
  const loopVariables = new Map(); // 迴圈變數 → 名稱清單
  const visit = node => {
    if (!node || typeof node.type !== 'string') return;
    const isFunction = /^(?:Function(?:Declaration|Expression)|ArrowFunctionExpression)$/.test(node.type);
    if (isFunction) {
      parameters.push(new Set(node.params.flatMap(param => param.type === 'Identifier' ? [param.name] : param.type === 'AssignmentPattern' && param.left.type === 'Identifier' ? [param.left.name] : [])));
    }
    let loopName;
    if (node.type === 'ForOfStatement' && node.left.type === 'VariableDeclaration' && node.left.declarations[0]?.id.type === 'Identifier') {
      const right = node.right.type === 'ArrayExpression' ? node.right.elements.map(stringOf) : node.right.type === 'Identifier' ? constArrays.get(node.right.name) : undefined;
      if (right?.length && right.every(value => typeof value === 'string')) {
        loopName = node.left.declarations[0].id.name;
        loopVariables.set(loopName, {names: right, line: node.loc.start.line});
      }
    }
    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee);
      if (HOOK_CALLEES.has(name) || isInlineCreateHook(node.callee)) {
        const first = node.arguments[0];
        const literal = stringOf(first);
        const line = node.loc.start.line;
        if (literal !== undefined) {
          if (BC_NAME.test(literal)) result.names.push({name: literal, location: `${relative}:${line}`});
        } else if (first?.type === 'Identifier' && loopVariables.has(first.name)) {
          const group = loopVariables.get(first.name);
          for (const member of group.names) result.names.push({name: member, location: `${relative}:${line}`, group: `${relative}:${group.line}`});
        } else if (first?.type === 'Identifier' && parameters.some(set => set.has(first.name))) {
          // 包裝函式的轉手，略過。
        } else if (first) {
          result.dynamic.push(`${relative}:${line}`);
        }
        if (PATCH_CALLEES.has(name)) {
          const table = node.arguments[1];
          if (literal !== undefined && BC_NAME.test(literal) && table?.type === 'ObjectExpression') {
            for (const property of table.properties) {
              if (property.type !== 'Property' || property.computed) continue;
              const key = property.key.type === 'Identifier' ? property.key.name : stringOf(property.key);
              if (typeof key !== 'string' || !key) continue;
              // 值為 null 代表「移除這個 patch」，不需要 pattern 存在。
              if (property.value.type === 'Literal' && property.value.value === null) continue;
              result.patches.push({name: literal, pattern: key, location: `${relative}:${property.loc.start.line}`});
            }
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
    if (isFunction) parameters.pop();
    if (loopName) loopVariables.delete(loopName);
  };
  visit(ast);
  return result;
}

/** LCE 掛鉤、patch 或呼叫的每個 BC 函式名稱，以及使用位置。 */
export function collectHookedFunctions(srcDir, rootDir = path.dirname(srcDir)) {
  const names = new Map();
  const dynamic = [];
  const patches = [];
  const parseErrors = [];
  for (const file of walk(srcDir)) {
    const relative = posix(path.relative(rootDir, file));
    if (!/\.(?:[cm]?js)$/.test(file) || SKIPPED_SOURCES.has(relative)) continue;
    const scanned = scanSource(fs.readFileSync(file, 'utf8'), relative);
    if (scanned.parseError) parseErrors.push(scanned.parseError);
    for (const {name, location, group} of scanned.names) {
      const entry = names.get(name) ?? {locations: []};
      entry.locations.push(location);
      if (group) entry.groups = [...(entry.groups ?? []), group];
      names.set(name, entry);
    }
    dynamic.push(...scanned.dynamic);
    patches.push(...scanned.patches);
  }
  return {names, dynamic, patches, parseErrors};
}

/** BC 腳本的頂層函式宣告（以及 `var x = function`），也就是可被 hook 的那些。 */
export function loadBcFunctions(bcDir) {
  const base = fs.existsSync(path.join(bcDir, 'Scripts')) ? bcDir : path.join(bcDir, 'BondageClub');
  const files = [...walk(path.join(base, 'Scripts')), ...walk(path.join(base, 'Screens'))].filter(file => file.endsWith('.js')).sort();
  if (!files.length) throw new Error(`No Scripts/ or Screens/ JavaScript found under ${bcDir}`);
  const functions = new Map();
  const duplicates = [];
  const parseErrors = [];
  const register = (name, source, file, line) => {
    const known = functions.get(name);
    if (known) duplicates.push(`${name}: ${known.file} and ${file}`);
    functions.set(name, {hash: hashSource(source), source: source.replaceAll('\r\n', '\n'), file, line});
  };
  for (const file of files) {
    const relative = posix(path.relative(base, file));
    const text = fs.readFileSync(file, 'utf8');
    let ast;
    try {
      ast = parse(text, {ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true});
    } catch (scriptError) {
      try {
        ast = parse(text, {ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true});
      } catch {
        parseErrors.push(`${relative}: ${scriptError.message}`);
        continue;
      }
    }
    for (const node of ast.body) {
      if (node.type === 'ClassDeclaration' && node.id) {
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition' && member.kind === 'method' && !member.computed && member.key.type === 'Identifier') {
            register(`${node.id.name}.${member.key.name}`, text.slice(member.start, member.end), relative, member.loc.start.line);
          }
        }
      } else if (node.type === 'VariableDeclaration') {
        for (const declaration of node.declarations) {
          // `var ToastManager = new class { ... }`：單例實例，方法掛在 window.ToastManager 上，ModSDK 能以 'ToastManager.method' 掛鉤。
          if (declaration.id.type === 'Identifier' && declaration.init?.type === 'NewExpression' && declaration.init.callee.type === 'ClassExpression') {
            for (const member of declaration.init.callee.body.body) {
              if (member.type === 'MethodDefinition' && member.kind === 'method' && !member.computed && !member.static && member.key.type === 'Identifier') {
                register(`${declaration.id.name}.${member.key.name}`, text.slice(member.start, member.end), relative, member.loc.start.line);
              }
            }
          }
          if (declaration.id.type !== 'Identifier' || declaration.init?.type !== 'ObjectExpression') continue;
          for (const property of declaration.init.properties) {
            if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.key.type !== 'Identifier') continue;
            if (property.method || /^(?:Function|ArrowFunction)Expression$/.test(property.value.type)) {
              register(`${declaration.id.name}.${property.key.name}`, text.slice(property.start, property.end), relative, property.loc.start.line);
            }
          }
        }
      }
      if (node.type === 'FunctionDeclaration' && node.id) {
        register(node.id.name, text.slice(node.start, node.end), relative, node.loc.start.line);
      } else if (node.type === 'VariableDeclaration' && node.kind === 'var') {
        for (const declaration of node.declarations) {
          const init = declaration.init;
          if (declaration.id.type === 'Identifier' && init && /^(?:Function|ArrowFunction)Expression$/.test(init.type)) {
            register(declaration.id.name, text.slice(init.start, init.end), relative, node.loc.start.line);
          }
        }
      }
    }
  }
  const versionSource = fs.existsSync(path.join(base, 'Scripts/Game.js')) ? fs.readFileSync(path.join(base, 'Scripts/Game.js'), 'utf8') : '';
  const gameVersion = /var\s+GameVersion\s*=\s*["']([^"']+)["']/.exec(versionSource)?.[1] ?? 'unknown';
  return {functions, gameVersion, duplicates, parseErrors, fileCount: files.length};
}

/** 以目前的掛鉤集合與 BC 原始碼，基準檔應該長什麼樣。 */
export function fingerprint(hooked, bc) {
  const functions = {};
  const missing = [];
  for (const name of [...hooked.names.keys()].sort()) {
    let found = bc.functions.get(name);
    let via;
    if (!found && !name.includes('.')) {
      // 擴充物品的 Load/Draw/Click 由 BC 在執行期依 `<Name>Hook` 函式產生。
      found = bc.functions.get(`${name}Hook`);
      via = found ? 'Hook' : undefined;
    }
    if (found) functions[name] = {hash: found.hash, file: found.file, ...(via ? {via} : {})};
    else missing.push(name);
  }
  // `for (const fn of ['A', 'B']) hook(fn, …)` 是「擇一」：BC 改名時只會有一個存在。
  // 組內至少有一個找得到，其餘缺少的只當作備註，不算差異。
  const optional = [];
  const groupHasMatch = new Set();
  for (const name of Object.keys(functions)) for (const group of hooked.names.get(name)?.groups ?? []) groupHasMatch.add(group);
  const hardMissing = missing.filter(name => {
    const groups = hooked.names.get(name)?.groups ?? [];
    const isOptional = groups.length > 0 && groups.every(group => groupHasMatch.has(group));
    if (isOptional) optional.push(name);
    return !isOptional;
  });
  return {functions, missing: hardMissing, optional};
}

/** patch 的 pattern 是否仍存在於 BC 函式本體（CRLF 已正規化，與 ModSDK 比對方式相同）。 */
export function checkPatchPatterns(hooked, bc) {
  const broken = [];
  for (const {name, pattern, location} of hooked.patches ?? []) {
    const found = bc.functions.get(name) ?? (!name.includes('.') ? bc.functions.get(`${name}Hook`) : undefined);
    if (!found) continue; // 函式不存在已由 missing 回報
    if (!found.source.includes(pattern.replaceAll('\r\n', '\n'))) broken.push({name, pattern, location, file: found.file});
  }
  return broken;
}

export function compare(baseline, current, patchMisses = []) {
  const known = baseline?.functions ?? {};
  const changed = [];
  const unchanged = [];
  const added = [];
  for (const [name, now] of Object.entries(current.functions)) {
    if (!known[name]) added.push(name);
    else if (known[name].hash !== now.hash) changed.push({name, file: now.file, was: known[name].hash, now: now.hash});
    else unchanged.push(name);
  }
  const hookedNow = new Set([...Object.keys(current.functions), ...current.missing]);
  const stale = Object.keys(known).filter(name => !hookedNow.has(name));
  const drift = changed.length + current.missing.length + added.length + stale.length + patchMisses.length > 0;
  return {changed, unchanged, added, stale, missing: current.missing, patchMisses, drift};
}

export function renderReport({result, baseline, bc, hooked, commit, current}) {
  const lines = [];
  const where = name => (hooked.names.get(name)?.locations ?? []).slice(0, 3).join(', ');
  lines.push(`BC source: ${bc.gameVersion}${commit ? ` (${commit.slice(0, 12)})` : ''}; baseline: ${baseline?.gameVersion ?? 'none'}${baseline?.commit ? ` (${baseline.commit.slice(0, 12)})` : ''}.`);
  lines.push(`Checked ${result.unchanged.length + result.changed.length + result.missing.length + result.added.length} hooked BC functions.`);
  if (result.patchMisses.length) {
    lines.push('', `patchFunction pattern no longer found in BC (${result.patchMisses.length}) - these patches silently do nothing:`);
    for (const item of result.patchMisses) lines.push(`- ${item.name} (${item.file}); ${JSON.stringify(item.pattern.length > 70 ? `${item.pattern.slice(0, 67)}...` : item.pattern)} at ${item.location}`);
  }
  if (result.changed.length) {
    lines.push('', `Changed in BC since the baseline (${result.changed.length}) - review these hooks:`);
    for (const item of result.changed) lines.push(`- ${item.name} (${item.file}) ${item.was} -> ${item.now}; used at ${where(item.name)}`);
  }
  if (result.missing.length) {
    lines.push('', `Hooked by LCE but no longer defined by BC (${result.missing.length}) - these hooks will fail to install:`);
    for (const name of result.missing) lines.push(`- ${name}; used at ${where(name)}`);
  }
  if (result.added.length) {
    lines.push('', `Hooked by LCE but not in the baseline yet (${result.added.length}):`);
    for (const name of result.added) lines.push(`- ${name}; used at ${where(name)}`);
  }
  if (result.stale.length) {
    lines.push('', `In the baseline but no longer hooked by LCE (${result.stale.length}):`);
    for (const name of result.stale) lines.push(`- ${name}`);
  }
  if (bc.duplicates.length) lines.push('', `Defined more than once in BC (the later load wins): ${bc.duplicates.join('; ')}`);
  if (bc.parseErrors.length) lines.push('', `Could not parse ${bc.parseErrors.length} BC file(s): ${bc.parseErrors.join('; ')}`);
  if (current?.optional?.length) lines.push('', `Either-or hooks where the other name exists (no action needed): ${current.optional.join(', ')}`);
  if (!result.drift) lines.push('', 'All hooked functions match the baseline.');
  return `${lines.join('\n')}\n`;
}

function parseArguments(argv) {
  const options = {update: false, json: false, bcDir: process.env.BC_DIR, baseline: DEFAULT_BASELINE, report: undefined};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--update') options.update = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--bc-dir') options.bcDir = argv[++index];
    else if (flag === '--baseline') options.baseline = path.resolve(argv[++index]);
    else if (flag === '--report') options.report = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument ${flag}`);
  }
  if (!options.bcDir) {
    const local = path.join(ROOT, 'BondageClub');
    if (fs.existsSync(local)) options.bcDir = local;
  }
  if (!options.bcDir) throw new Error('Pass --bc-dir <path to the BC source> or set BC_DIR.');
  options.bcDir = path.resolve(options.bcDir);
  return options;
}

function gitCommit(directory) {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  } catch {
    return undefined;
  }
}

export function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const hooked = collectHookedFunctions(path.join(ROOT, 'src'), ROOT);
  if (hooked.parseErrors.length) {
    console.error(`Could not parse LCE source (hooks in these files are not checked): ${hooked.parseErrors.join('; ')}`);
    return 2;
  }
  const bc = loadBcFunctions(options.bcDir);
  const current = fingerprint(hooked, bc);
  const patchMisses = checkPatchPatterns(hooked, bc);
  const commit = gitCommit(options.bcDir);
  if (hooked.dynamic.length) console.warn(`Hook names built at runtime cannot be checked: ${hooked.dynamic.join(', ')}`);
  if (bc.parseErrors.length) console.warn(`Could not parse: ${bc.parseErrors.join('; ')}`);
  if (options.update) {
    const missing = current.missing.length ? ` (not defined by BC and left out: ${current.missing.join(', ')})` : '';
    const baseline = {gameVersion: bc.gameVersion, ...(commit ? {commit} : {}), functions: current.functions};
    fs.writeFileSync(options.baseline, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Baseline written for ${bc.gameVersion}: ${Object.keys(current.functions).length} functions${missing}.`);
    if (patchMisses.length) console.warn(`Patch patterns not found in BC: ${patchMisses.map(item => `${item.name} @ ${item.location}`).join(', ')}`);
    return current.missing.length || patchMisses.length ? 1 : 0;
  }
  const baseline = fs.existsSync(options.baseline) ? JSON.parse(fs.readFileSync(options.baseline, 'utf8')) : undefined;
  if (!baseline) {
    console.error(`No baseline at ${options.baseline}; create one with --update.`);
    return 2;
  }
  const result = compare(baseline, current, patchMisses);
  const report = renderReport({result, baseline, bc, hooked, commit, current});
  if (options.report) fs.writeFileSync(options.report, report);
  console.log(options.json ? JSON.stringify({gameVersion: bc.gameVersion, ...result}, null, 2) : report);
  if (bc.parseErrors.length && result.missing.length) return 2;
  return result.drift ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
