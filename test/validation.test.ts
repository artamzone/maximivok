import assert from "node:assert/strict";
import test from "node:test";
import { InputValidationError, parseHeatingInput } from "../src/validation.js";

function validRawInput(): Record<string, unknown> {
  return {
    houseAreaM2: 100,
    rooms: [
      {
        id: "room-1",
        name: "Комната",
        areaM2: 20,
        ceilingHeightM: 2.8,
        hasStandardWindows: true,
        hasPanoramicWindows: false,
        floorHeatingAreaM2: 15,
        hasRadiator: true,
      },
    ],
    heatSource: "gas",
    availableElectricPowerKw: null,
    residents: 3,
    baths: 1,
    showers: 0,
    includeIndirectWaterHeater: true,
  };
}

test("принимает корректный JSON-контракт", () => {
  const parsed = parseHeatingInput(validRawInput());
  assert.equal(parsed.rooms[0]?.name, "Комната");
  assert.equal(parsed.circuitLengthM, undefined);
});

test("отклоняет площадь тёплого пола больше площади помещения", () => {
  const raw = validRawInput();
  const rooms = raw.rooms as Array<Record<string, unknown>>;
  if (rooms[0] !== undefined) rooms[0].floorHeatingAreaM2 = 21;

  assert.throws(
    () => parseHeatingInput(raw),
    (error: unknown) =>
      error instanceof InputValidationError && error.issues.some((issue) => issue.includes("не может превышать")),
  );
});

test("отклоняет дублирующиеся идентификаторы помещений", () => {
  const raw = validRawInput();
  raw.rooms = [...(raw.rooms as unknown[]), { ...(raw.rooms as Record<string, unknown>[])[0] }];

  assert.throws(
    () => parseHeatingInput(raw),
    (error: unknown) => error instanceof InputValidationError && error.issues.some((issue) => issue.includes("уникальными")),
  );
});
