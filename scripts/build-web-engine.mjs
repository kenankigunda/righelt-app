import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

await rm(outputRoot, { recursive: true, force: true });

for (const source of sources) {
  const files = await walk(source.root);
  for (const file of files) {
    const relativePath = path.relative(source.root, file);
    const outputFile = path.join(source.outDir, relativePath).replace(/\.ts$/, ".js");
    await transpileFile(file, outputFile);
  }
}
