import type { HeatingWorkPrices } from "./types.js";

/** All 35 labor rows from the «ОТОПЛЕНИЕ» section of «Смета работ.xlsx». */
export const workDefinitions = [
  { id: "heating_boiler_wall_double", name: "Монтаж настенного двухконтурного котла до 30 кВт", unit: "ед.", priceRub: 12000, appliedToHeating: false },
  { id: "heating_boiler_wall_single", name: "Монтаж настенного одноконтурного котла до 30 кВт", unit: "ед.", priceRub: 12000, appliedToHeating: false },
  { id: "heating_boiler_wall_electric", name: "Монтаж настенного электрического котла до 30 кВ", unit: "ед.", priceRub: 12000, appliedToHeating: false },
  { id: "heating_boiler_electric_over_30", name: "Монтаж электрического котла свыше 30 кВт", unit: "ед.", priceRub: 16000, appliedToHeating: false },
  { id: "heating_boiler_solid_fuel", name: "Монтаж твердотопливного котла до 50 кВт", unit: "ед.", priceRub: 17000, appliedToHeating: false },
  { id: "heating_boiler_removal", name: "Демонтаж котла, водонагревателя", unit: "ед.", priceRub: 3500, appliedToHeating: false },
  { id: "heating_radiator_removal", name: "Демонтаж радиатора", unit: "ед.", priceRub: 2000, appliedToHeating: false },
  { id: "heating_fill_under_250", name: "Заправка системы теплоносителем (для домов площадью до 250 м2)", unit: "ед.", priceRub: 8000, appliedToHeating: false },
  { id: "heating_fill_250_500", name: "Заправка системы теплоносителем (для домов площадью 250-500 м2)", unit: "ед.", priceRub: 10000, appliedToHeating: false },
  { id: "heating_floor_mat", name: "Монтаж маты теплого пола", unit: "ед.", priceRub: 100, appliedToHeating: false },
  { id: "insulation", name: "Монтаж пеноплекса", unit: "ед.", priceRub: 100, appliedToHeating: true },
  { id: "heating_indirect_heater", name: "Монтаж водонагревателя косвенного нагрева до 200 л ( с рециркуляцией )", unit: "ед.", priceRub: 12000, appliedToHeating: false },
  { id: "floor_heating", name: "Монтаж водяных «теплых полов»", unit: "ед.", priceRub: 600, appliedToHeating: true },
  { id: "heating_floor_regulator", name: "Монтаж группы регулирования температуры теплого пола", unit: "ед.", priceRub: 2500, appliedToHeating: false },
  { id: "heating_safety_group", name: "Монтаж группы безопасности котла/водонагревателя", unit: "ед.", priceRub: 2500, appliedToHeating: false },
  { id: "heating_radiator_regulator", name: "Монтаж группы регулирования температуры радиаторной сети", unit: "ед.", priceRub: 2500, appliedToHeating: false },
  { id: "heating_insulated_main_pipe", name: "Монтаж магистральных труб системы отопления в теплоизоляции (сшитый полиэтилен) от Ø16-20", unit: "ед.", priceRub: 100, appliedToHeating: false },
  { id: "heating_gauge", name: "Монтаж манометра, термометра, термоманометра за ед.", unit: "ед.", priceRub: 300, appliedToHeating: false },
  { id: "heating_buffer_tank", name: "Монтаж накопительного водонагревателя / буферной емкости до 1000 л", unit: "ед.", priceRub: 2000, appliedToHeating: false },
  { id: "heating_pump_group", name: "Монтаж насосной группы до Ø32 мм", unit: "ед.", priceRub: 1500, appliedToHeating: false },
  { id: "heating_radiator_nonstandard", name: "Монтаж нестандартного радиатора, КОНВЕКТОРА в ПОЛ (чугунные радиаторы, дизайн радиат)", unit: "ед.", priceRub: 6000, appliedToHeating: false },
  { id: "heating_manifold_under_60", name: "Монтаж распределит. коллектора котельной до 60 кВт", unit: "ед.", priceRub: 5000, appliedToHeating: false },
  { id: "heating_manifold_over_60", name: "Монтаж распределит. коллектора котельной от 60 кВт", unit: "ед.", priceRub: 6000, appliedToHeating: false },
  { id: "heating_water_point", name: "Монтаж точки водоснабжения ХВС и ГВС", unit: "ед.", priceRub: 2000, appliedToHeating: false },
  { id: "heating_convector", name: "Монтаж водяного конвектора на высоте + обвязка", unit: "ед.", priceRub: 12000, appliedToHeating: false },
  { id: "heating_manifold_cabinet", name: "Монтаж распределит. коллекторного шкафа", unit: "ед.", priceRub: 1000, appliedToHeating: false },
  { id: "heating_expansion_tank", name: "Монтаж расширительного бака до 100 л", unit: "ед.", priceRub: 2500, appliedToHeating: false },
  { id: "heating_pipe_insulation", name: "Монтаж трубной изоляции на трубопроводы", unit: "ед.", priceRub: 100, appliedToHeating: false },
  { id: "heating_circulation_pump", name: "Монтаж циркуляционного насоса до Ø32 мм", unit: "ед.", priceRub: 2000, appliedToHeating: false },
  { id: "heating_pressure_test", name: "Опрессовка системы (для домов площадью до 250м2 )", unit: "ед.", priceRub: 10000, appliedToHeating: false },
  { id: "heating_wall_chasing", name: "Штробление стен", unit: "ед.", priceRub: 0, appliedToHeating: false },
  { id: "heating_main_pipe", name: "Прокладка магистральных труб системы отопления (металлопластик, сшитый полиэтилен) Ø25- 32 мм", unit: "ед.", priceRub: 200, appliedToHeating: false },
  { id: "heating_polypropylene_pipe", name: "Прокладка магистральных труб системы отопления (полипропилен) до Ø32 мм", unit: "ед.", priceRub: 150, appliedToHeating: false },
  { id: "heating_solid_fuel_flue", name: "Монтаж дымохода твердотопливного котла ( проход через стену, установка площадки, установка до 8 метров)", unit: "ед.", priceRub: 25000, appliedToHeating: false },
  { id: "heating_radiator_install", name: "Сборка и монтаж радиатора отопления", unit: "ед.", priceRub: 5000, appliedToHeating: false },
] as const;

export const defaultMarkupPercent = 45;
export const defaultHeatingWorkPriceRubPerM2 = 900;

export function ivokPriceRub(basePriceRub: number, markupPercent: number): number {
  const markup = 1 + markupPercent / 100;
  const result = basePriceRub * markup;
  if (!Number.isFinite(result) || !Number.isSafeInteger(Math.ceil(result))) {
    throw new Error("Цена ИВОК превышает допустимый денежный диапазон");
  }
  return result;
}

export function calculateHeatingWorkPrices(
  revision: number,
  prices: Readonly<Record<string, number>>,
): HeatingWorkPrices {
  // Until the user saves a version, the heating default applies to new calculations; the
  // catalog view keeps workbook prices (e.g. 600 ₽/м² for floor heating).
  const revision0 = revision === 0
    ? { floor_heating: defaultHeatingWorkPriceRubPerM2, insulation: 100 }
    : undefined;
  return {
    revision,
    floorHeatingRubPerM2: revision0?.floor_heating ?? prices.floor_heating ?? defaultHeatingWorkPriceRubPerM2,
    insulationRubPerM2: revision0?.insulation ?? prices.insulation ?? workDefinitions.find((item) => item.id === "insulation")!.priceRub,
  };
}
