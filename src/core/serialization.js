/** Parse optional JSON; callers remain responsible for validating its shape. */
export function parseJSON(text) {
    try { return text ? JSON.parse(text) : null; }
    catch { return null; }
}
