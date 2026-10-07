import { InputValidationError } from "./validation.js";

function decimal(value: number): { numerator: bigint; denominator: bigint } {
  const [coefficient = "0", exponent = "0"] = String(value).split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  const scale = fractionLength - Number(exponent);
  const digits = BigInt(coefficient.replace(".", ""));
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * 10n ** BigInt(-scale), denominator: 1n };
}

/** Round each nonnegative decimal line to kopecks, half up, without binary float multiplication. */
export function lineTotalKopecks(priceRub: number, quantity: number): number {
  if (!Number.isFinite(priceRub) || priceRub < 0 || !Number.isFinite(quantity) || quantity <= 0) {
    throw new InputValidationError(["Недопустимая цена или количество"]);
  }
  const price = decimal(priceRub);
  const count = decimal(quantity);
  const numerator = price.numerator * count.numerator * 100n;
  const denominator = price.denominator * count.denominator;
  const amount = (numerator * 2n + denominator) / (denominator * 2n);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new InputValidationError(["Стоимость превышает допустимый диапазон"]);
  return Number(amount);
}
