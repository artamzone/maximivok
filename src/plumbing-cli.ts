import { readFile } from "node:fs/promises";
import process from "node:process";
import { calculatePlumbing } from "./plumbing.js";
import { parsePlumbingInput, parsePlumbingWorkPrices } from "./plumbing-validation.js";
import { InputValidationError } from "./validation.js";
import type { PlumbingWorkPrices } from "./types.js";

interface CliArgs {
  inputPath?: string;
  pricesPath?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prices") {
      const next = argv[index + 1];
      if (next === undefined) {
        throw new InputValidationError(["После --prices ожидается путь к файлу снимка цен"]);
      }
      args.pricesPath = next;
      index += 1;
    } else if (arg !== undefined && !arg.startsWith("--")) {
      if (args.inputPath === undefined) args.inputPath = arg;
      else {
        throw new InputValidationError([
          `Лишний позиционный аргумент: ${arg}. Использование: [файл.json] [--prices снимок.json]`,
        ]);
      }
    } else if (arg !== undefined) {
      throw new InputValidationError([`Неизвестный флаг: ${arg}`]);
    }
  }
  return args;
}

async function readAll(source: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(path: string | undefined): Promise<string> {
  if (path !== undefined) return readFile(path, "utf8");
  return readAll(process.stdin);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const raw = await readInput(args.inputPath);
    if (raw.trim() === "") throw new InputValidationError(["JSON не передан через файл или stdin"]);
    const parsed: unknown = JSON.parse(raw);
    const input = parsePlumbingInput(parsed);

    let workPrices: PlumbingWorkPrices | undefined;
    if (args.pricesPath !== undefined) {
      const rawPrices = await readFile(args.pricesPath, "utf8");
      if (rawPrices.trim() === "") {
        throw new InputValidationError([`Файл снимка цен ${args.pricesPath} пуст`]);
      }
      workPrices = parsePlumbingWorkPrices(JSON.parse(rawPrices), args.pricesPath);
    }

    process.stdout.write(`${JSON.stringify(calculatePlumbing(input, workPrices), null, 2)}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof SyntaxError || error instanceof InputValidationError ? 2 : 1;
  }
}

await main();
