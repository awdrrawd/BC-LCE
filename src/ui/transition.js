/** Complete only this element's transform, with a fallback when CSS emits no event. */
export function finishTransform(element, complete, timeout = 500) {
    let pending = true;
    const cancel = () => {
        if (!pending) return;
        pending = false;
        clearTimeout(timer);
        element.removeEventListener('transitionend', onEnd);
        element.removeEventListener('transitioncancel', onEnd);
    };
    const finish = () => { if (!pending) return; cancel(); complete(); };
    const onEnd = event => {
        if (event.target === element && event.propertyName === 'transform') finish();
    };
    const timer = setTimeout(finish, timeout);
    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onEnd);
    return cancel;
}
