export function parseFixture(raw) {
    return JSON.parse(raw);
}
export async function loadFixture(readFixture, path) {
    return parseFixture(await readFixture(path));
}
