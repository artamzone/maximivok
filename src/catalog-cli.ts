import process from "node:process";
import { CatalogFormatError, previewSanBazaCatalog } from "./catalog-import.js";

async function main(): Promise<void> {
  try {
    const filePath = process.argv[2];
    if (process.argv.length !== 3 || !filePath) {
      throw new CatalogFormatError("Использование: npm run catalog:check -- san-baza.xlsx");
    }
    const { products, ...preview } = await previewSanBazaCatalog(filePath);
    process.stdout.write(`${JSON.stringify({
      ...preview,
      validRowCount: products.length,
      formatValid: preview.issues.length === 0,
    }, null, 2)}\n`);
    if (preview.issues.length > 0) process.exitCode = 2;
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof CatalogFormatError ? 2 : 1;
  }
}

await main();
