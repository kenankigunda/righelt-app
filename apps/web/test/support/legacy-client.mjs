import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Actual deployed PR150, not a reconstructed approximation of its validator.
export const LEGACY_CLIENT_REVISION = 'b7661ce9616283445a50c919324b1cc24092f91e';
export async function legacyClientFixture() {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'righelt-legacy-client-'));
  try {
    const archive = execFileSync('git', ['archive', LEGACY_CLIENT_REVISION,
      'apps/web/shell', 'apps/web/generated', 'apps/web/main.js', 'apps/web/local-dev-ports.js'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', directory], { input: archive });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    const web = join(directory, 'apps/web');
    const source = await readFile(join(web, 'shell/live-transport.js'));
    return { web, revision: LEGACY_CLIENT_REVISION,
      transportHash: createHash('sha256').update(source).digest('hex'),
      load: relative => import(pathToFileURL(join(web, relative)).href),
      close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
