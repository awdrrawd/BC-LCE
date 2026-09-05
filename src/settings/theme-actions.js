// Mutate only the draft supplied by runSettingAction. Validation, events and
// persistence belong to the settings transaction, not to these actions.
export function createThemeActions(keys, getSchema) {
    const slotIndex = settings => {
        const slot = Number.parseInt(settings.themeSlot || '1', 10);
        return Number.isFinite(slot) ? Math.max(0, Math.min(2, slot - 1)) : 0;
    };
    return {
        saveThemeSlot(settings) {
            if (!settings) return;
            settings.themeSlots = Array.isArray(settings.themeSlots) ? settings.themeSlots.slice() : [null, null, null];
            settings.themeSlots[slotIndex(settings)] = Object.fromEntries(keys.map(key => [key, settings[key]]));
        },
        loadThemeSlot(settings) {
            if (!settings) return;
            const snapshot = Array.isArray(settings.themeSlots) ? settings.themeSlots[slotIndex(settings)] : null;
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
            for (const key of keys) if (Object.hasOwn(snapshot, key)) settings[key] = snapshot[key];
        },
        resetTheme(settings) {
            if (!settings) return;
            const schema = getSchema();
            for (const key of keys) settings[key] = schema[key].value;
        },
    };
}
