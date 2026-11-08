import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "apps", "web", "generated");
const sources = [
  {
    root: path.join(repoRoot, "packages", "shared-types", "src"),
    outDir: path.join(outputRoot, "packages", "shared-types", "src"),
  },
  {
    root: path.join(repoRoot, "packages", "game-engine", "src"),
    outDir: path.join(outputRoot, "packages", "game-engine", "src"),
  },
];

const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

const rewriteRelativeImports = (source) =>
  source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
    if (specifier.endsWith(".js") || specifier.endsWith(".json")) {
      return `${prefix}${specifier}${suffix}`;
    }
    return `${prefix}${specifier}.js${suffix}`;
  });

const ensureDir = async (dir) => {
  await mkdir(dir, { recursive: true });
};

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile() && !entry.name.endsWith(".d.ts") && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      files.push(fullPath);
    }
  }
  return files;
};

const transpileFile = async (sourcePath, destinationPath) => {
  const source = await readFile(sourcePath, "utf8");
  if (sourcePath.endsWith(".js")) {
    await ensureDir(path.dirname(destinationPath));
    await writeFile(destinationPath, rewriteRelativeImports(source), "utf8");
    return;
  }

  const result = ts.transpileModule(source, {
    compilerOptions,
    fileName: sourcePath,
  });
  await ensureDir(path.dirname(destinationPath));
  await writeFile(destinationPath, rewriteRelativeImports(result.outputText), "utf8");
};

export const RULES_WORKER_ENTRY = 'apps/web/board/rules-worker.js';
export const RULES_WORKER_OUTPUT = 'apps/web/generated/rules-worker.js';

export function assertRulesWorkerClosure(result) {
  assert(result.metafile && Array.isArray(result.outputFiles));
  const outputs = Object.values(result.metafile.outputs);
  assert.equal(outputs.length, 1, 'Rules worker must have one output');
  assert.equal(result.outputFiles.length, 1, 'Rules worker must have one served file');
  assert.equal(outputs[0].entryPoint, RULES_WORKER_ENTRY);
  assert.deepEqual(outputs[0].imports, [], 'Rules worker cannot load runtime imports');
  assert.deepEqual(outputs[0].exports, [], 'Rules worker entry installs the original handler');
  assert(Object.hasOwn(result.metafile.inputs, RULES_WORKER_ENTRY));
  for (const [name, input] of Object.entries(result.metafile.inputs)) {
    assert(name.startsWith('apps/web/') && !name.split('/').includes('..'), 'Unexpected worker dependency');
    for (const dependency of input.imports) assert.notEqual(dependency.external, true, 'External worker dependency');
  }
  return result;
}

// The canonical entry is unchanged. Each RulesRuntime job still receives a new
// module realm; this build only removes that realm's network import graph.
export async function buildRulesWorker({ root = repoRoot, write = true } = {}) {
  const result = assertRulesWorkerClosure(await build({
    absWorkingDir: root,
    entryPoints: [RULES_WORKER_ENTRY],
    outfile: RULES_WORKER_OUTPUT,
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    target: ['safari17', 'chrome120'],
    minify: false,
    legalComments: 'none',
    sourcemap: false,
    metafile: true,
    write: false,
  }));
  if (write) {
    const destination = path.join(root, RULES_WORKER_OUTPUT);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, result.outputFiles[0].contents);
  }
  return result;
}


export async function buildWebEngine() {
  await rm(outputRoot, { recursive: true, force: true });

  for (const source of sources) {
    const files = await walk(source.root);
    for (const file of files) {
      const relativePath = path.relative(source.root, file);
      const outputFile = path.join(source.outDir, relativePath).replace(/\.ts$/, ".js");
      await transpileFile(file, outputFile);
    }
  }

  // The server and browser consume this single pinned, versioned source list.
  const passwordData = path.join(outputRoot, "packages", "shared-types", "data");
  await ensureDir(passwordData);
  await writeFile(
    path.join(passwordData, "common-passwords.json"),
    await readFile(path.join(repoRoot, "packages", "shared-types", "data", "common-passwords.json")),
  );

  // Bundle the canonical rules entry after its generated engine imports exist.
  await buildRulesWorker();

  // Build the pinned browser runtime for local previews, CI and deployment together.
  await import('./build-computer-player.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildWebEngine();
