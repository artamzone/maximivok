import { heatingRules } from "./config.js";

/** Read-only projection of the same configuration used by the calculator. */
export function getHeatingRulesView() {
  const floor = heatingRules.floorHeating;
  const radiators = heatingRules.radiators;
  return {
    readOnly: true,
    items: [
      {
        id: "pipeMetersPerM2", name: "Расход трубы тёплого пола", value: floor.pipeMetersPerM2, unit: "м/м²",
        description: "Определяет метраж трубы по площади тёплого пола; от метража зависят число контуров и распределение коллекторов.",
      },
      {
        id: "standardCircuitLengthM", name: "Стандартная длина контура", value: floor.standardCircuitLengthM, unit: "м",
        description: "Базовая длина, если параметр не передан. Явно неизвестное значение не подменяется стандартным. Превышение стандартной длины требует проверки инженера.",
      },
      {
        id: "exceptionalCircuitLengthM", name: "Допустимое исключение по длине контура", value: floor.exceptionalCircuitLengthM, unit: "м",
        description: "Нестандартная длина до этого предела включительно требует проверки инженера. При превышении предела статус блока тёплого пола — «Невозможно определить».",
      },
      {
        id: "maxCircuitsPerCollector", name: "Максимум контуров на коллектор", value: floor.maxCircuitsPerCollector, unit: "контуров",
        description: "При превышении этого количества контуры распределяются между несколькими коллекторами максимально равномерно. Соответствие выбранного оборудования проверяет инженер.",
      },
      {
        id: "wattsPerM2", name: "Базовая мощность радиаторов", value: radiators.wattsPerM2, unit: "Вт/м²",
        description: "Предварительная мощность по площади помещения при стандартных условиях. Не заменяет инженерный расчёт для нестандартных случаев.",
      },
      {
        id: "floorHeatingReductionPercent", name: "Снижение мощности радиаторов при наличии ТП", value: radiators.floorHeatingReductionPercent, unit: "%",
        description: "Уменьшение базовой мощности радиатора в помещении с положительной площадью тёплого пола. Без тёплого пола снижение не применяется.",
      },
      {
        id: "standardMaxCeilingHeightM", name: "Стандартная высота потолка — до", value: radiators.standardMaxCeilingHeightM, unit: "м",
        description: "При высоте выше этого порога мощность радиатора определяет инженер. Панорамные окна и нестандартное размещение также требуют отдельной проверки.",
      },
    ],
  };
}
