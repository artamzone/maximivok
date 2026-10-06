import { heatingRules } from "./config.js";
import type {
  AppliedRule,
  BoilerResult,
  BoilerRoomResult,
  CalculationStatus,
  FloorHeatingResult,
  HeatingInput,
  HeatingReport,
  RadiatorRoomResult,
  ReportMessage,
  WaterHeaterResult,
} from "./types.js";

const rule = (code: string, description: string): AppliedRule => ({ code, description });
const warning = (code: string, message: string): ReportMessage => ({ code, message });

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function splitCollectors(circuitCount: number, capacity: number): number[] {
  if (circuitCount <= 0) return [];
  const collectorCount = Math.ceil(circuitCount / capacity);
  const baseSize = Math.floor(circuitCount / collectorCount);
  const extra = circuitCount % collectorCount;
  return Array.from({ length: collectorCount }, (_, index) => baseSize + (index < extra ? 1 : 0));
}

function calculateFloorHeating(
  input: HeatingInput,
  appliedRules: AppliedRule[],
  warnings: ReportMessage[],
  errors: ReportMessage[],
): FloorHeatingResult {
  const config = heatingRules.floorHeating;
  const requestedCircuitLengthM = input.circuitLengthM === undefined
    ? config.standardCircuitLengthM : input.circuitLengthM;
  const missingParameters = input.rooms.flatMap((room, index) =>
    room.floorHeatingAreaM2 === null ? [`rooms[${index}].floorHeatingAreaM2`] : []);
  if (input.rooms.length === 0) missingParameters.push("rooms");
  if (missingParameters.length > 0) {
    return {
      status: "impossible", missingParameters, areaM2: null, pipeLengthM: null,
      circuitLengthM: requestedCircuitLengthM, circuitCount: null, averageCircuitLengthM: null,
      collectors: [], mixingUnitCount: null, installationCostRub: null, insulationInstallationCostRub: null,
    };
  }
  const areaM2 = round(input.rooms.reduce((sum, room) => sum + (room.floorHeatingAreaM2 ?? 0), 0));
  if (requestedCircuitLengthM === null && areaM2 > 0) {
    appliedRules.push(
      rule("FH_PIPE_6M_PER_M2", "На 1 м² тёплого пола принято 6 пог. м трубы."),
      rule("FH_INSTALLATION_900_RUB_M2", "Монтаж тёплого пола: 900 ₽/м²."),
      rule("FH_INSULATION_100_RUB_M2", "Укладка утеплителя: 100 ₽/м²."),
    );
    return {
      status: "impossible", missingParameters: ["circuitLengthM"], areaM2,
      pipeLengthM: round(areaM2 * config.pipeMetersPerM2), circuitLengthM: null,
      circuitCount: null, averageCircuitLengthM: null, collectors: [], mixingUnitCount: null,
      installationCostRub: round(areaM2 * config.installationPriceRubPerM2),
      insulationInstallationCostRub: round(areaM2 * config.insulationPriceRubPerM2),
    };
  }
  if (requestedCircuitLengthM === null) {
    return {
      status: "calculated", areaM2: 0, pipeLengthM: 0, circuitLengthM: null,
      circuitCount: 0, averageCircuitLengthM: 0, collectors: [], mixingUnitCount: 0,
      installationCostRub: 0, insulationInstallationCostRub: 0,
    };
  }
  let status: CalculationStatus = "calculated";

  if (requestedCircuitLengthM > config.exceptionalCircuitLengthM) {
    status = "impossible";
    errors.push(
      warning(
        "FH_CIRCUIT_LENGTH_EXCEEDS_LIMIT",
        `Длина контура ${requestedCircuitLengthM} м превышает допустимое исключение ${config.exceptionalCircuitLengthM} м.`,
      ),
    );
  } else if (requestedCircuitLengthM > config.standardCircuitLengthM) {
    status = "requires_engineer_review";
    warnings.push(
      warning(
        "FH_EXCEPTIONAL_CIRCUIT_LENGTH",
        `Использована нестандартная длина контура ${requestedCircuitLengthM} м; требуется подтверждение инженера.`,
      ),
    );
  }

  const pipeLengthM = round(areaM2 * config.pipeMetersPerM2);
  const circuitCount = areaM2 === 0 ? 0 : Math.ceil(pipeLengthM / requestedCircuitLengthM);
  const collectors = splitCollectors(circuitCount, config.maxCircuitsPerCollector);
  const hasRadiators = input.rooms.some((room) => room.hasRadiator === true);
  const unknownRadiators = input.rooms.flatMap((room, index) =>
    room.hasRadiator === null ? [`rooms[${index}].hasRadiator`] : []);
  const mixingUnknown = !hasRadiators && collectors.length > 0 && unknownRadiators.length > 0;
  if (mixingUnknown) status = "impossible";

  appliedRules.push(
    rule("FH_PIPE_6M_PER_M2", "На 1 м² тёплого пола принято 6 пог. м трубы."),
    rule("FH_CIRCUITS_ROUND_UP", "Количество контуров округляется вверх."),
    rule("FH_COLLECTOR_MAX_12", "Один коллектор обслуживает не более 12 контуров."),
    rule("FH_COLLECTORS_BALANCED", "Контуры делятся между коллекторами максимально равномерно."),
    rule("FH_INSTALLATION_900_RUB_M2", "Монтаж тёплого пола: 900 ₽/м²."),
    rule("FH_INSULATION_100_RUB_M2", "Укладка утеплителя: 100 ₽/м²."),
  );
  if (hasRadiators && collectors.length > 0) {
    appliedRules.push(
      rule("FH_MIXING_UNIT_WITH_RADIATORS", "При наличии радиаторов нужен один смесительный узел на коллектор ТП."),
    );
  }

  return {
    status,
    areaM2,
    pipeLengthM,
    circuitLengthM: requestedCircuitLengthM,
    circuitCount,
    averageCircuitLengthM: circuitCount === 0 ? 0 : round(pipeLengthM / circuitCount),
    collectors,
    mixingUnitCount: mixingUnknown ? null : hasRadiators ? collectors.length : 0,
    ...(mixingUnknown ? { missingParameters: unknownRadiators } : {}),
    installationCostRub: round(areaM2 * config.installationPriceRubPerM2),
    insulationInstallationCostRub: round(areaM2 * config.insulationPriceRubPerM2),
  };
}

function calculateRadiators(input: HeatingInput, appliedRules: AppliedRule[]): RadiatorRoomResult[] {
  const config = heatingRules.radiators;
  const results = input.rooms
    .filter((room) => room.hasRadiator !== false)
    .map((room): RadiatorRoomResult => {
      const missingParameters = (room.hasRadiator === null ? ["hasRadiator"] :
        ["areaM2", "ceilingHeightM", "hasStandardWindows", "hasPanoramicWindows", "floorHeatingAreaM2"]
          .filter((key) => room[key as keyof typeof room] === null))
        .map((key) => `rooms[${input.rooms.indexOf(room)}].${key}`);
      if (missingParameters.length > 0) {
        return { roomId: room.id, roomName: room.name, status: "impossible", requiredPowerW: null,
          reductionPercent: null, warnings: [], missingParameters };
      }
      const warnings: ReportMessage[] = [];
      if (room.hasPanoramicWindows) {
        warnings.push(
          warning("RAD_PANORAMIC_WINDOW_REVIEW", "Мощность радиатора при панорамном окне определяет инженер."),
        );
      }
      if (room.ceilingHeightM !== null && room.ceilingHeightM > config.standardMaxCeilingHeightM) {
        warnings.push(
          warning(
            "RAD_HIGH_CEILING_REVIEW",
            `Высота потолка ${room.ceilingHeightM} м выше стандартного условия ${config.standardMaxCeilingHeightM} м.`,
          ),
        );
      }
      if (!room.hasStandardWindows && !room.hasPanoramicWindows) {
        warnings.push(
          warning(
            "RAD_NONSTANDARD_PLACEMENT_REVIEW",
            "В помещении нет обычного окна; место и мощность радиатора определяет инженер.",
          ),
        );
      }
      const requiresReview = warnings.length > 0;
      const reductionPercent = room.floorHeatingAreaM2 !== null && room.floorHeatingAreaM2 > 0 ? config.floorHeatingReductionPercent : 0;
      const requiredPowerW = requiresReview
        ? null
        : round((room.areaM2 ?? 0) * config.wattsPerM2 * (1 - reductionPercent / 100));
      return {
        roomId: room.id,
        roomName: room.name,
        status: requiresReview ? "requires_engineer_review" : "calculated",
        requiredPowerW,
        reductionPercent,
        warnings,
      };
    });

  if (results.some((result) => result.status !== "impossible")) {
    appliedRules.push(
      rule("RAD_100W_PER_M2", "Базовая предварительная мощность радиаторов: 100 Вт/м²."),
      rule("RAD_FLOOR_HEATING_REDUCTION_30", "При наличии тёплого пола мощность радиатора уменьшается на 30%."),
      rule("RAD_STANDARD_CEILING_MAX_3_2", "Стандартное условие действует при высоте потолка до 3,2 м."),
    );
  }
  return results;
}

function calculateBoiler(input: HeatingInput, appliedRules: AppliedRule[]): BoilerResult {
  if (input.houseAreaM2 === null || input.heatSource === "unknown") {
    return { status: "impossible", recommendedPowerKw: null,
      missingParameters: [
        ...(input.houseAreaM2 === null ? ["houseAreaM2"] : []),
        ...(input.heatSource === "unknown" ? ["heatSource"] : []),
      ], note: "Недостаточно данных для выбора котла." };
  }
  const houseAreaM2 = input.houseAreaM2;
  if (input.heatSource === "gas") {
    const band = heatingRules.gasBoilerBands.find(({ maxAreaM2 }) => houseAreaM2 <= maxAreaM2);
    appliedRules.push(rule("BOILER_GAS_AREA_TABLE", "Мощность газового котла выбирается по таблице площади дома."));
    if (band === undefined) {
      return {
        status: "requires_engineer_review",
        recommendedPowerKw: null,
        note: "Дом больше 400 м²: мощность котла определяет инженер.",
      };
    }
    return {
      status: input.includeIndirectWaterHeater === null ? "impossible" : input.includeIndirectWaterHeater ? "requires_engineer_review" : "calculated",
      ...(input.includeIndirectWaterHeater === null ? { missingParameters: ["includeIndirectWaterHeater"] } : {}),
      recommendedPowerKw: band.powerKw,
      note: input.includeIndirectWaterHeater
        ? "Предварительная мощность по площади; при бойлере косвенного нагрева инженер проверяет запас для ГВС."
        : "Предварительная мощность по площади дома.",
    };
  }

  if (input.heatSource === "electric") {
    appliedRules.push(rule("BOILER_ELECTRIC_130M2_12KW", "Для электрокотла до 130 м² базово принимается 12 кВт."));
    if (houseAreaM2 > heatingRules.electricBoiler.maxStandardAreaM2) {
      return {
        status: "requires_engineer_review",
        recommendedPowerKw: null,
        note: "Для дома больше 130 м² требуется проверка доступной электрической мощности инженером.",
      };
    }
    if (input.availableElectricPowerKw === null) {
      return {
        status: "impossible",
        missingParameters: ["availableElectricPowerKw"],
        recommendedPowerKw: heatingRules.electricBoiler.powerKw,
        note: "Предварительно 12 кВт; выбор невозможен без доступной электрической мощности.",
      };
    }
    if (input.availableElectricPowerKw < heatingRules.electricBoiler.powerKw) {
      return {
        status: "requires_engineer_review",
        recommendedPowerKw: null,
        note: "Доступной электрической мощности недостаточно; инженер выбирает альтернативный источник тепла.",
      };
    }
    return {
      status: input.includeIndirectWaterHeater === null ? "impossible" : input.includeIndirectWaterHeater ? "requires_engineer_review" : "calculated",
      ...(input.includeIndirectWaterHeater === null ? { missingParameters: ["includeIndirectWaterHeater"] } : {}),
      recommendedPowerKw: heatingRules.electricBoiler.powerKw,
      note: input.includeIndirectWaterHeater
        ? "Предварительно 12 кВт; запас мощности для нагрева ГВС проверяет инженер."
        : "Предварительная мощность с учётом доступной электрической мощности.",
    };
  }

  return {
    status: "requires_engineer_review",
    recommendedPowerKw: null,
    note: "Для выбранного источника тепла в ТЗ нет таблицы мощности; решение принимает инженер.",
  };
}

function calculateWaterHeater(input: HeatingInput, appliedRules: AppliedRule[]): WaterHeaterResult {
  const unavailable = (missingParameters: string[]): WaterHeaterResult => ({
    status: "impossible", recommendedVolumeL: null, missingParameters,
    note: "Недостаточно данных для выбора бойлера.",
  });
  if (input.includeIndirectWaterHeater === null) return unavailable(["includeIndirectWaterHeater"]);
  if (!input.includeIndirectWaterHeater) {
    return { status: "calculated", recommendedVolumeL: null, note: "Бойлер косвенного нагрева не выбран." };
  }
  if (input.residents === null) return unavailable(["residents"]);
  appliedRules.push(rule("DHW_VOLUME_TABLE", "Объём бойлера выбирается по числу жильцов и сантехнических приборов."));
  if (input.residents >= 4) {
    return { status: "calculated", recommendedVolumeL: 200, note: "Для четырёх и более жильцов принят объём 200 л." };
  }
  if (input.residents === 3 && input.baths === null) return unavailable(["baths"]);
  if (input.residents === 3 && input.baths !== null && input.baths > 0) {
    return { status: "calculated", recommendedVolumeL: 200, note: "Для трёх жильцов и ванны принят объём 200 л." };
  }
  if (input.residents === 3 && input.showers === null) return unavailable(["showers"]);
  if (input.residents === 3 && input.showers !== null && input.showers > 0) {
    return { status: "calculated", recommendedVolumeL: 150, note: "Для трёх жильцов и душа принят объём 150 л." };
  }
  return {
    status: "requires_engineer_review",
    recommendedVolumeL: null,
    note: "Сочетание отсутствует в таблице ТЗ; объём определяет инженер.",
  };
}

function selectBoilerRoom(input: HeatingInput, appliedRules: AppliedRule[]): BoilerRoomResult {
  const hasFloorHeating = input.rooms.some((room) => room.floorHeatingAreaM2 !== null && room.floorHeatingAreaM2 > 0);
  const hasRadiators = input.rooms.some((room) => room.hasRadiator === true);
  const missingParameters = [
    ...(input.rooms.length === 0 ? ["rooms"] : []),
    ...input.rooms.flatMap((room, index) => [
      ...(!hasFloorHeating && room.floorHeatingAreaM2 === null ? [`rooms[${index}].floorHeatingAreaM2`] : []),
      ...(!hasRadiators && room.hasRadiator === null ? [`rooms[${index}].hasRadiator`] : []),
    ]),
    ...(input.includeIndirectWaterHeater === null ? ["includeIndirectWaterHeater"] : []),
  ];
  if (missingParameters.length > 0) {
    return { status: "impossible", templateCode: null, missingParameters,
      includesIndirectWaterHeater: input.includeIndirectWaterHeater, note: "Недостаточно данных для выбора схемы котельной." };
  }
  appliedRules.push(rule("BOILER_ROOM_FIXED_TEMPLATE", "Гидравлическая схема выбирается только из фиксированного списка."));

  if (hasFloorHeating && hasRadiators) {
    return {
      status: "calculated",
      templateCode: heatingRules.boilerRoomTemplates.floorAndRadiators,
      includesIndirectWaterHeater: input.includeIndirectWaterHeater,
      note: "Котёл, коллектор ТП со смесительным узлом и коллектор радиаторов.",
    };
  }
  if (hasFloorHeating) {
    return {
      status: "calculated",
      templateCode: heatingRules.boilerRoomTemplates.floorOnly,
      includesIndirectWaterHeater: input.includeIndirectWaterHeater,
      note: "Котёл подключается к коллектору ТП без смесительного узла.",
    };
  }
  if (hasRadiators) {
    return {
      status: "calculated",
      templateCode: heatingRules.boilerRoomTemplates.radiatorsOnly,
      includesIndirectWaterHeater: input.includeIndirectWaterHeater,
      note: "Котёл подключается к коллектору радиаторов.",
    };
  }
  return {
    status: "impossible",
    templateCode: heatingRules.boilerRoomTemplates.noHeatingEmitters,
    includesIndirectWaterHeater: input.includeIndirectWaterHeater,
    note: "Не указаны ни тёплый пол, ни радиаторы: схему выбрать невозможно.",
  };
}

function combineStatus(statuses: CalculationStatus[]): CalculationStatus {
  if (statuses.includes("impossible")) return "impossible";
  if (statuses.includes("requires_engineer_review")) return "requires_engineer_review";
  return "calculated";
}

export function calculateHeating(input: HeatingInput): HeatingReport {
  const appliedRules: AppliedRule[] = [];
  const warnings: ReportMessage[] = [];
  const errors: ReportMessage[] = [];
  const floorHeating = calculateFloorHeating(input, appliedRules, warnings, errors);
  const radiators = calculateRadiators(input, appliedRules);
  const boiler = calculateBoiler(input, appliedRules);
  const waterHeater = calculateWaterHeater(input, appliedRules);
  const boilerRoom = selectBoilerRoom(input, appliedRules);
  warnings.push(...radiators.flatMap((radiator) => radiator.warnings));

  return {
    status: combineStatus([
      floorHeating.status,
      ...radiators.map((radiator) => radiator.status),
      boiler.status,
      waterHeater.status,
      boilerRoom.status,
    ]),
    input,
    floorHeating,
    radiators,
    boiler,
    waterHeater,
    boilerRoom,
    appliedRules,
    warnings,
    errors,
  };
}
