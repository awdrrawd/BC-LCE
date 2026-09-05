// Compatibility facade. Login UI owns its state; root persistence is independent.
export { S, loadSettings, saveSettings, reloadSettings } from '../loginpage/state.js';
export { readRoot } from './settings-root.js';
