// Shared infrastructure for LCE's public API. Keep every endpoint below the existing
// `window.Liko.LCE` namespace so LCE never competes with WCE or unrelated global names.
window.Liko = window.Liko ?? {};
window.Liko.LCE = window.Liko.LCE ?? {};

export const LCE_API = window.Liko.LCE;

export function createPositionableButton(defaultPosition) {
    let position = [...defaultPosition];
    let hidden = false;
    let visualHidden = false;

    const api = {
        getPosition: () => [...position],
        setPosition: (x, y, width, height) => {
            if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) {
                throw new TypeError('setPosition: x, y, width and height must be finite numbers');
            }
            position = [x, y, width, height];
        },
        resetPosition: () => { position = [...defaultPosition]; },
        hide: () => { hidden = true; },
        show: () => { hidden = false; },
        isHidden: () => hidden,
        hideVisual: () => { visualHidden = true; },
        showVisual: () => { visualHidden = false; },
        isVisualHidden: () => visualHidden,
    };

    return {
        api,
        getPosition: () => position,
        isHidden: () => hidden,
        isVisualHidden: () => visualHidden,
    };
}

export function exposeButton(name, api) {
    LCE_API.Button = { ...LCE_API.Button, [name]: api };
}
