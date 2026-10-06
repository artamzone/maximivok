import { readFile } from "node:fs/promises";
import process from "node:process";
import { calculateHeating } from "./calculator.js";
import { InputValidationError, parseHeatingInput } from "./validation.js";

async function readInput(): Promise<string> {
  const filePath = process.argv[2];
  if (filePath !== undefined) return readFile(filePath, "utf8");

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  try {
    const raw = await readInput();
    if (raw.trim() === "") throw new InputValidationError(["JSON не передан через файл или stdin"]);
    const parsed: unknown = JSON.parse(raw);
    const input = parseHeatingInput(parsed);
    process.stdout.write(`${JSON.stringify(calculateHeating(input), null, 2)}\n`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof SyntaxError || error instanceof InputValidationError ? 2 : 1;
  }
}

await main();
