import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
export async function localRuntime() {
  // Optional dependency root supports an existing checkout without modifying it.
  const require = createRequire(process.env.T108_DEPENDENCY_ROOT ? `${process.env.T108_DEPENDENCY_ROOT}/package.json` : new URL('../../package.json',import.meta.url));
  const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
  const {Miniflare} = wranglerRequire('miniflare');
  const common = { compatibilityDate:'2026-03-12',compatibilityFlags:['nodejs_compat'],modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs'],fallthrough:true}] };
  return new Miniflare({workers:[
    {...common,name:'admission',scriptPath:`${root}worker.mjs`,durableObjects:{ADMISSION:{className:'AdmissionProbe',useSQLite:true}},serviceBindings:{HASH_WORKER:'hasher'}},
    {...common,name:'hasher',scriptPath:`${root}hash-worker.mjs`,durableObjects:{HASH:{className:'HashProbe',useSQLite:true}}},
  ]});
}
