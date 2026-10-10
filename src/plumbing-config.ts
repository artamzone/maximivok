import type { PlumbingFixtureType } from "./types.js";

/**
 * Фиксированная матрица приборов водоснабжения.
 * Согласовано с пользователем для подэтапа A TASK-04:
 *  - bath, shower_cabin, sink, hygiene_shower, kitchen_sink — ХВС + ГВС;
 *  - toilet, washing_machine — только ХВС;
 *  - dishwasher — только ХВС (по согласованию);
 *  - recirculationAllowed = true для приборов с ГВС, кроме dishwasher.
 * Любой тип вне перечисления PlumbingFixtureType отклоняется валидацией.
 */
export interface PlumbingFixtureDefinition {
  readonly type: PlumbingFixtureType;
  readonly name: string;
  readonly coldWater: boolean;
  readonly hotWater: boolean;
  readonly recirculationAllowed: boolean;
}

export const plumbingFixtures: ReadonlyArray<PlumbingFixtureDefinition> = Object.freeze([
  Object.freeze({ type: "bath", name: "Ванна", coldWater: true, hotWater: true, recirculationAllowed: true }),
  Object.freeze({ type: "shower_cabin", name: "Душевая кабина", coldWater: true, hotWater: true, recirculationAllowed: true }),
  Object.freeze({ type: "sink", name: "Раковина", coldWater: true, hotWater: true, recirculationAllowed: true }),
  Object.freeze({ type: "hygiene_shower", name: "Гигиенический душ", coldWater: true, hotWater: true, recirculationAllowed: true }),
  Object.freeze({ type: "toilet", name: "Унитаз", coldWater: true, hotWater: false, recirculationAllowed: false }),
  Object.freeze({ type: "washing_machine", name: "Стиральная машина", coldWater: true, hotWater: false, recirculationAllowed: false }),
  Object.freeze({ type: "dishwasher", name: "Посудомоечная машина", coldWater: true, hotWater: false, recirculationAllowed: false }),
  Object.freeze({ type: "kitchen_sink", name: "Кухонная мойка", coldWater: true, hotWater: true, recirculationAllowed: true }),
]);

const fixturesByType = new Map<PlumbingFixtureType, PlumbingFixtureDefinition>(
  plumbingFixtures.map((definition) => [definition.type, definition]),
);

export function getPlumbingFixture(type: PlumbingFixtureType): PlumbingFixtureDefinition {
  const definition = fixturesByType.get(type);
  if (definition === undefined) {
    throw new Error(`Неизвестный тип прибора водоснабжения: ${type as string}`);
  }
  return definition;
}
