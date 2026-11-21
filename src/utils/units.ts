// The single source of length-unit conversion for every calculator.
export type LengthUnit = "ft" | "in" | "m" | "cm" | "mm";
export const LENGTH_UNITS: LengthUnit[] = ["ft", "in", "m", "cm", "mm"];

const FEET_PER_UNIT: Record<LengthUnit, number> = {
  ft: 1,
  in: 1 / 12,
  m: 3.280839895,
  cm: 0.03280839895,
  mm: 0.003280839895,
};

// Stated directly rather than derived from FEET_PER_UNIT so that inches and feet convert exactly (180 ft = 2160 in).
const INCHES_PER_UNIT: Record<LengthUnit, number> = {
  in: 1,
  ft: 12,
  m: 39.37007874,
  cm: 0.3937007874,
  mm: 0.03937007874,
};

export const feetPerUnit = (unit: LengthUnit) => FEET_PER_UNIT[unit];

export const isLengthUnit = (unit: unknown): unit is LengthUnit => LENGTH_UNITS.includes(unit as LengthUnit);

export function convertToFeet(value: number, unit: LengthUnit): number {
  if (!isLengthUnit(unit)) throw new Error("Unsupported measurement unit");
  return value * FEET_PER_UNIT[unit];
}

export function convertToInches(value: number, unit: LengthUnit): number {
  if (!isLengthUnit(unit)) throw new Error("Unsupported measurement unit");
  return value * INCHES_PER_UNIT[unit];
}

export function convertFromInches(inches: number, unit: LengthUnit): number {
  if (!isLengthUnit(unit)) throw new Error("Unsupported measurement unit");
  return inches / INCHES_PER_UNIT[unit];
}

export const convertToMetres = (value: number, unit: LengthUnit) => convertToInches(value, unit) / INCHES_PER_UNIT.m;

// Older screens saved units as "inches", "foot", "inch"; this maps every spelling to one code.
const UNIT_ALIASES: Record<string, LengthUnit> = { in: "in", inch: "in", inches: "in", ft: "ft", foot: "ft", feet: "ft", m: "m", cm: "cm", mm: "mm" };
export const toLengthUnit = (code: string): LengthUnit | null => UNIT_ALIASES[code] ?? null;

// Areas use the same length conversions, squared.
export type AreaUnit = "m²" | "ft²" | "in²" | "cm²" | "mm²";
export const AREA_UNITS: AreaUnit[] = ["m²", "ft²", "in²", "cm²", "mm²"];
const AREA_BASE: Record<AreaUnit, LengthUnit> = { "m²": "m", "ft²": "ft", "in²": "in", "cm²": "cm", "mm²": "mm" };
export const isAreaUnit = (unit: unknown): unit is AreaUnit => AREA_UNITS.includes(unit as AreaUnit);

export function convertAreaToSquareMetres(value: number, unit: AreaUnit): number {
  if (!isAreaUnit(unit)) throw new Error("Unsupported area unit");
  const metresPerUnit = convertToMetres(1, AREA_BASE[unit]);
  return value * metresPerUnit * metresPerUnit;
}
