import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assert } from './policy.mjs';
const [out] = process.argv.slice(2);
assert(out && !existsSync(out), 'new build-context directory required');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert(git('status', '--porcelain') === '', 'commit source before preparing an image');
const root = git('rev-parse', '--show-toplevel'), revision = git('rev-parse', 'HEAD');
// A worktree .git file points outside Docker's context. Make an independent,
// source-only local clone instead. No GitHub request or keyring token is needed.
execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', root, path.resolve(out)], { stdio: 'pipe' });
execFileSync('git', ['-C', path.resolve(out), 'checkout', '--detach', revision], { stdio: 'pipe' });
process.stdout.write(JSON.stringify({ directory: path.resolve(out), sourceRevision: revision }) + '\n');
