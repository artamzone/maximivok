import type { BoilerRoomTemplateCode } from "./types.js";

export const heatingRules = Object.freeze({
  floorHeating: Object.freeze({
    pipeMetersPerM2: 6,
    standardCircuitLengthM: 80,
    exceptionalCircuitLengthM: 90,
    maxCircuitsPerCollector: 12,
    installationPriceRubPerM2: 900,
    insulationPriceRubPerM2: 100,
  }),
  radiators: Object.freeze({
    wattsPerM2: 100,
    floorHeatingReductionPercent: 30,
    standardMaxCeilingHeightM: 3.2,
  }),
  gasBoilerBands: Object.freeze([
    Object.freeze({ maxAreaM2: 200, powerKw: 24 }),
    Object.freeze({ maxAreaM2: 250, powerKw: 30 }),
    Object.freeze({ maxAreaM2: 300, powerKw: 35 }),
    Object.freeze({ maxAreaM2: 400, powerKw: 40 }),
  ]),
  electricBoiler: Object.freeze({
    maxStandardAreaM2: 130,
    powerKw: 12,
  }),
  boilerRoomTemplates: Object.freeze({
    floorOnly: "HEAT_SOURCE_FLOOR_ONLY" as BoilerRoomTemplateCode,
    floorAndRadiators: "HEAT_SOURCE_FLOOR_AND_RADIATORS" as BoilerRoomTemplateCode,
    radiatorsOnly: "HEAT_SOURCE_RADIATORS_ONLY" as BoilerRoomTemplateCode,
    noHeatingEmitters: "NO_HEATING_EMITTERS" as BoilerRoomTemplateCode,
  }),
});

export { workDefinitions, defaultMarkupPercent } from "./works-data.js";
