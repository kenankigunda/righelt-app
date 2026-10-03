import { PASSWORD_MIN_CODE_POINTS, PASSWORD_MAX_CODE_POINTS, } from "./auth-policy.js";
export * from "./auth-policy.js";
const invalid = { ok: false, error: "invalid_input" };
export function normalizeUsername(input) {
    if (typeof input !== "string")
        return invalid;
    const username = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
    return /^[A-Za-z0-9_]{3,24}$/.test(username)
        ? { ok: true, value: { username, canonical: username.toLowerCase() } }
        : invalid;
}
export function normalizeDisplayName(input, fallback) {
    if (input === undefined || input === "")
        return { ok: true, value: fallback };
    if (typeof input !== "string" ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input))
        return invalid;
    const value = input.normalize("NFC").trim();
    if (!value)
        return { ok: true, value: fallback };
    if (new TextEncoder().encode(value).length > 256 ||
        /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value))
        return invalid;
    // Keep emoji joiners while rejecting names consisting only of invisible marks.
    if (!value.replace(/[\p{Default_Ignorable_Code_Point}\p{Z}\p{M}]/gu, ""))
        return invalid;
    const count = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;
    return count <= 32 ? { ok: true, value } : invalid;
}
export function normalizePassword(input) {
    if (typeof input !== "string" ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input))
        return invalid;
    const value = input.normalize("NFC");
    const length = Array.from(value).length;
    return length >= PASSWORD_MIN_CODE_POINTS &&
        length <= PASSWORD_MAX_CODE_POINTS
        ? { ok: true, value }
        : invalid;
}
export function isPasswordAllowed(password, canonicalUsername, blocklist) {
    return (!blocklist.has(password) && password.toLowerCase() !== canonicalUsername);
}
export function safeContinuation(input, origin) {
    if (typeof input !== "string" ||
        !input.startsWith("/") ||
        input.startsWith("//") ||
        /[\\\u0000-\u001f\u007f]/u.test(input))
        return null;
    try {
        const target = new URL(input, origin);
        return target.origin === new URL(origin).origin
            ? target.pathname + target.search + target.hash
            : null;
    }
    catch {
        return null;
    }
}
export function validateAccountPatch(input, username) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return invalid;
    const body = input;
    if (!Object.keys(body).length ||
        Object.keys(body).some((key) => !["displayName", "preferences"].includes(key)))
        return invalid;
    const result = {};
    if ("displayName" in body) {
        const name = normalizeDisplayName(body.displayName, username);
        if (!name.ok)
            return invalid;
        result.displayName = name.value;
    }
    if ("preferences" in body) {
        if (!body.preferences ||
            typeof body.preferences !== "object" ||
            Array.isArray(body.preferences))
            return invalid;
        const preferences = body.preferences;
        if (!Object.keys(preferences).length ||
            Object.keys(preferences).some((key) => !["tutorial", "view", "introducedOpponents"].includes(key)))
            return invalid;
        if ("tutorial" in preferences &&
            (typeof preferences.tutorial !== "string" ||
                !["completed", "skipped"].includes(preferences.tutorial)))
            return invalid;
        if ("view" in preferences &&
            (typeof preferences.view !== "string" ||
                !["focused", "explanatory"].includes(preferences.view)))
            return invalid;
        if ("introducedOpponents" in preferences && (!Number.isInteger(preferences.introducedOpponents) || Number(preferences.introducedOpponents) < 0 || Number(preferences.introducedOpponents) > 7))
            return invalid;
        result.preferences = preferences;
    }
    return { ok: true, value: result };
}
