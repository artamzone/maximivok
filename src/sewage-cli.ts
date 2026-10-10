import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateSewage } from "./sewage.js";
import { parseSewageInput, parseSewageWorkPrices } from "./sewage-validation.js";
import { defaultMarkupPercent, ivokPriceRub, workDefinitions } from "./works-data.js";

interface CliOptions {
  inputPath: string;
  pricesPath: string | null;
  showHelp: boolean;
}

function printHelp(): void {
  console.log(`Использование:
  node dist/src/sewage-cli.js <input.json> [--prices prices.json]

Читает SewageInput из JSON, считает канализацию, выводит отчёт JSON.
С --prices подключает снимок цен, иначе — без стоимости.`);
}

function parseArgs(argv: readonly string[]): CliOptions {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { inputPath: "", pricesPath: null, showHelp: true };
  }
  let inputPath = "";
  let pricesPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--prices") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error("После --prices ожидается путь к файлу");
      }
      pricesPath = value;
      i += 1;
    } else if (inputPath === "") {
      inputPath = arg;
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }
  if (inputPath === "") {
    throw new Error("Не указан путь к входному JSON");
  }
  return { inputPath, pricesPath, showHelp: false };
}

export function runSewageCli(argv: readonly string[]): number {
  const options = parseArgs(argv);
  if (options.showHelp) {
    printHelp();
    return 0;
  }
  const inputPath = resolve(process.cwd(), options.inputPath);
  const rawInput = JSON.parse(readFileSync(inputPath, "utf8"));
  const input = parseSewageInput(rawInput);

  let prices;
  if (options.pricesPath !== null) {
    const pricesPath = resolve(process.cwd(), options.pricesPath);
    const rawPrices = JSON.parse(readFileSync(pricesPath, "utf8"));
    prices = parseSewageWorkPrices(rawPrices);
  }

  const report = calculateSewage(input, prices);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

// If executed directly (not imported), run the CLI.
const argv1 = process.argv[1] ?? "";
const isDirect = argv1.endsWith("sewage-cli.js") || argv1.endsWith("sewage-cli");
if (isDirect) {
  try {
    const code = runSewageCli(process.argv.slice(2));
    if (code !== 0) process.exit(code);
  } catch (error: unknown) {
    if (error instanceof Error) console.error(error.message);
    else console.error(String(error));
    process.exit(1);
  }
}

void defaultMarkupPercent;
void ivokPriceRub;
void workDefinitions;
