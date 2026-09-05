// Compatibility facade: repositories do not depend on login UI or BC drawing.
export { getCryptoKey, encryptPassword, decryptPassword } from '../storage/credentials.js';
export { loadAccounts, saveAccounts, addOrUpdateAccount, removeAccount, dbGet, dbPut, dbDelete, ACCOUNTS_UPDATED_EVENT } from '../storage/accounts.js';
export { saveWallpaper, loadWallpaper, deleteWallpaper } from '../storage/wallpaper.js';
export { makeAvatarBlob, captureAndSaveProfile, scheduleProfileCapture } from '../loginpage/profile-capture.js';
