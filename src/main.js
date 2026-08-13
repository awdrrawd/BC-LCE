// Keep this bootstrap free of static imports. Static dependencies are evaluated
// before an entry module's body, which would register LCE with ModSDK before a
// duplicate-load check could run.
window.Liko = window.Liko ?? {};

if (window.Liko.LCE) {
    console.warn('🐈 [LCE] Already loaded, skipping duplicate init.');
} else {
    // Claim the namespace synchronously, before ModSDK or any other LCE module
    // can execute. The namespace itself is the duplicate-load guard.
    const lceNamespace = window.Liko.LCE = {};

    import('./app.js')
        .catch((error) => {
            // Permit a later retry if this attempt still owns the empty guard.
            if (window.Liko.LCE === lceNamespace && !lceNamespace.version) {
                delete window.Liko.LCE;
            }
            console.error('🐈 [LCE] Failed to load:', error);
        });
}
