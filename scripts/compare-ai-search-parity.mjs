import { readFileSync, writeFileSync } from 'node:fs';
import { compareSearchParity } from '../tools/ai-benchmark/search-proof.mjs';
const [referencePath, observedPath, outputPath] = process.argv.slice(2);
if (!referencePath || !observedPath || !outputPath) throw new Error('Usage: compare-ai-search-parity.mjs reference.json observed.json output.json');
const reference = JSON.parse(readFileSync(referencePath, 'utf8'));
const observed = JSON.parse(readFileSync(observedPath, 'utf8'));
const report = compareSearchParity(reference, observed);
writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
