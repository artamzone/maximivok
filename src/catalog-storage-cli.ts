import { resolve } from "node:path";
import process from "node:process";
import { CatalogFormatError } from "./catalog-import.js";
import { importSanBazaCatalog, SqliteCatalogRepository } from "./catalog-storage.js";

async function main(): Promise<void> {
  try {
    const [command, argument, ...extra] = process.argv.slice(2);
    if (extra.length > 0 || (command !== "import" && command !== "log") || (command === "import" && !argument)) {
      throw new CatalogFormatError("Использование: npm run catalog:import -- файл.xlsx или npm run catalog:log -- [id импорта]");
    }
    const databasePath = process.env.IVOK_DATABASE_PATH ?? resolve(process.cwd(), "data", "ivok.sqlite");
    if (command === "import" && argument) {
      const report = await importSanBazaCatalog(argument, databasePath);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      // Code 3 explicitly means the import was committed, but some rows were skipped.
      if (report.skippedRows > 0) process.exitCode = 3;
      return;
    }
    const repository = new SqliteCatalogRepository(databasePath, { readOnly: true });
    try {
      const report = argument ? repository.getImport(argument) : repository.listImports();
      if (report === null) throw new CatalogFormatError("Импорт не найден.");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
      repository.close();
    }
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof CatalogFormatError ? 2 : 1;
  }
}

await main();
