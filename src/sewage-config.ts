import type { PlumbingFixtureType, SewageDiameter } from "./types.js";

/**
 * Матрица диаметров канализационных стоков по типу прибора.
 * Согласовано с инженером на этапе D1.
 *
 * Ø110 — только унитаз. Ø50 — все остальные санитарные приборы.
 * Дополнительный признак `drainsToFloor` отмечает приборы, чей сток
 * может уходить в трап (душ). Используется для уточнения счёта трапов.
 */
export interface SewageFixtureSpec {
  type: PlumbingFixtureType;
  diameter: SewageDiameter;
  drainsToFloor: boolean;
}

const fixtureSpecs: SewageFixtureSpec[] = [
  { type: "sink", diameter: 50, drainsToFloor: false },
  { type: "hygiene_shower", diameter: 50, drainsToFloor: false },
  { type: "kitchen_sink", diameter: 50, drainsToFloor: false },
  { type: "shower_cabin", diameter: 50, drainsToFloor: true },
  { type: "bath", diameter: 50, drainsToFloor: false },
  { type: "washing_machine", diameter: 50, drainsToFloor: false },
  { type: "dishwasher", diameter: 50, drainsToFloor: false },
  { type: "toilet", diameter: 110, drainsToFloor: false },
];

const byType = new Map<PlumbingFixtureType, SewageFixtureSpec>(
  fixtureSpecs.map((spec) => [spec.type, spec] as const),
);

export function getSewageFixtureSpec(type: PlumbingFixtureType): SewageFixtureSpec {
  const spec = byType.get(type);
  if (spec === undefined) {
    throw new Error(`Неизвестный тип прибора для канализации: ${type}`);
  }
  return spec;
}

export function listSewageFixtureSpecs(): readonly SewageFixtureSpec[] {
  return fixtureSpecs;
}
