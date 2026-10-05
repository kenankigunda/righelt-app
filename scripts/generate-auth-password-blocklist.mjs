import { readFile, writeFile } from "node:fs/promises";
const source = new URL(
  "../packages/shared-types/data/common-passwords.txt",
  import.meta.url,
);
const output = new URL(
  "../packages/shared-types/data/common-passwords.json",
  import.meta.url,
);
const entries = (await readFile(source, "utf8")).split(/\r?\n/).filter(Boolean);
await writeFile(output, JSON.stringify(entries, null, 2) + "\n");
