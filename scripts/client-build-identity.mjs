import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const MARKER = /globalThis\.__righeltClientBuild = "([^"]+)"; \/\/ RIGHELT_CLIENT_BUILD/g;

export function readEmbeddedClientBuild(source) {
  const matches = [...String(source).matchAll(MARKER)];
  if (matches.length !== 1 || !SHA.test(matches[0][1])) throw Error('Loaded client commit is missing or malformed');
  return matches[0][1];
}

export function stampClientBuild(source, commit) {
  if (!SHA.test(commit)) throw Error('Expected deployment commit must be an exact lowercase 40-character SHA');
  const matches = [...String(source).matchAll(MARKER)];
  if (matches.length !== 1 || matches[0][1] !== 'unavailable') throw Error('Client build marker is missing, duplicated, or already stamped');
  const stamped = String(source).replace(matches[0][0], `globalThis.__righeltClientBuild = "${commit}"; // RIGHELT_CLIENT_BUILD`);
  if (readEmbeddedClientBuild(stamped) !== commit) throw Error('Client build stamp verification failed');
  return stamped;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [path, commit] = process.argv.slice(2);
  if (!path) throw Error('Client entry path is required');
  const source = await readFile(path, 'utf8');
  await writeFile(path, stampClientBuild(source, commit), 'utf8');
}
