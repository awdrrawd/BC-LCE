// 哪些圖示可以上色（移植 Themed utilities/drawing.ts 的 _Image 名單）：
// 角色素材、背景、場景圖不能碰；本身已有配色的圖示也排除。
const CANVAS_NO_PREFIX = ['Assets/Female3DCG/', 'Backgrounds/', 'Icons/Struggle/', 'Icons/LARP/', 'Icons/MagicBattle/', 'Screens/', 'http'];
const HTML_NO_PREFIX = [...CANVAS_NO_PREFIX, 'data:'];

const BASE_NO_FILES = [
    'Icons/Accept.png', 'Icons/Activity.png', 'Icons/Arousal.png', 'Icons/Audio.png', 'Icons/BlindToggle2.png',
    'Icons/Cancel.png', 'Icons/Cell.png', 'Icons/Checked.png', 'Icons/ClubCard.png', 'Icons/Controller.png',
    'Icons/Crafting.png', 'Icons/Exit.png', 'Icons/Explore.png', 'Icons/Gavel.png', 'Icons/Gender.png',
    'Icons/Infiltration.png', 'Icons/Lock.png', 'Icons/LockMenu.png', 'Icons/MagicSchool.png', 'Icons/Online.png',
    'Icons/Platform.png', 'Icons/Poker.png', 'Icons/Search.png', 'Icons/Security.png', 'Icons/ServiceBell.png',
    'Icons/Title.png', 'Icons/Use.png', 'Icons/WinkNone.png', 'Icons/Color.png', 'Icons/ColorChange.png',
    'Icons/ColorChangeMulti.png', 'Icons/Small/ColorBlocked.png', 'Icons/Small/ColorChange.png',
    'Icons/Small/ColorChangeMulti.png', 'Icons/Small/Naked.png', 'Icons/Small/Use.png', 'Icons/Small/YouTube.png',
];
const CANVAS_NO_FILES = new Set(BASE_NO_FILES);
const HTML_NO_FILES = new Set([
    ...BASE_NO_FILES,
    'Icons/Information.svg', 'Icons/CaretUp.svg', 'Icons/cross.svg',
    'Icons/RoomTypeNormal.svg', 'Icons/RoomTypeHybrid.svg', 'Icons/RoomTypeMap.svg',
    'Icons/Female.svg', 'Icons/Gender.svg', 'Icons/Male.svg',
]);

function canColorize(src, prefixes, files) {
    if (typeof src !== 'string' || !src) return false;
    // Preserve the original renderer-specific policy: canvas may receive generated
    // data/blob images, while HTML excludes data URLs through HTML_NO_PREFIX.
    if (src.startsWith('//')) return false;
    src = src.split(/[?#]/, 1)[0].replace(/^(?:\.\/)+/, '');
    if (prefixes.some(p => src.startsWith(p))) return false;
    if (files.has(src)) return false;
    return true;
}
export const doColorizeImage     = (src) => canColorize(src, CANVAS_NO_PREFIX, CANVAS_NO_FILES);
export const doColorizeHTMLImage = (src) => canColorize(src, HTML_NO_PREFIX, HTML_NO_FILES);
