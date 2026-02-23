import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

const getArg = (flag) => {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
};

const dbName = getArg("--name") || process.env.RIGHELT_D1_DB_NAME;
const dbId = getArg("--id") || process.env.RIGHELT_D1_DB_ID;

if (!dbName || !dbId) {
  console.error(
    [
      "Usage:",
      "  pnpm cf:set-db -- --name <db-name> --id <db-id>",
      "Or set env vars:",
      "  RIGHELT_D1_DB_NAME=<db-name> RIGHELT_D1_DB_ID=<db-id> pnpm cf:set-db"
    ].join("\n")
  );
  process.exit(1);
}

const targets = ["apps/web/wrangler.toml"];

for (const file of targets) {
  const current = readFileSync(file, "utf8");
  const updated = current
    .replace(/database_name = ".*"/, `database_name = "${dbName}"`)
    .replace(/database_id = ".*"/, `database_id = "${dbId}"`);

  if (updated === current) {
    console.error(`No D1 binding lines were updated in ${file}`);
    process.exit(1);
  }

  writeFileSync(file, updated, "utf8");
  console.log(`Updated ${file}`);
}
