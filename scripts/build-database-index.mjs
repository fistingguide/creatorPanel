import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const databaseDir = path.join(rootDir, "static", "database");
const outputPath = path.join(databaseDir, "index.json");

const entries = await readdir(databaseDir, { withFileTypes: true });
const databases = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite3"))
  .map((entry, index) => ({
    id: entry.name,
    label: entry.name,
    isDefault: index === 0,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "en-US", { numeric: true }));

if (databases.length) {
  databases.forEach((db, index) => {
    db.isDefault = index === 0;
  });
}

await writeFile(outputPath, `${JSON.stringify({ databases }, null, 2)}\n`, "utf8");
