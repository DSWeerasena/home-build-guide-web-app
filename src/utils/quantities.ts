// Material volumes: one internal unit (cubic feet) and display-only conversion to the unit the user picks.
// Changing the display unit never changes the stored quantity.

// Sri Lankan building "cube". Change it here only; every calculator, report and PDF reads this value.
export const CUBIC_FEET_PER_CUBE = 100;
export const CUBIC_FEET_PER_CUBIC_METRE = 35.3146667214886;
// One 50 kg cement bag is taken as 1 ft³ of cement (Foundation, Brickwork and Plastering). Change it here only.
export const CUBIC_FEET_PER_CEMENT_BAG = 1;
export const FOUNDATION_WASTAGE_PERCENT = 5;

export type VolumeUnit = "cube" | "ft3" | "m3" | "in3";
export const VOLUME_UNITS: VolumeUnit[] = ["cube", "ft3", "m3", "in3"];
export const DEFAULT_VOLUME_UNIT: VolumeUnit = "cube";
export const isVolumeUnit = (unit: unknown): unit is VolumeUnit => VOLUME_UNITS.includes(unit as VolumeUnit);

const CUBIC_FEET_PER_UNIT: Record<VolumeUnit, number> = {
  cube: CUBIC_FEET_PER_CUBE,
  ft3: 1,
  m3: CUBIC_FEET_PER_CUBIC_METRE,
  in3: 1 / 1728,
};

// Symbols used in stored result strings, e.g. "390 ft³" or "1.2 m³".
const SYMBOL_TO_UNIT: Record<string, VolumeUnit> = { "ft³": "ft3", "m³": "m3", "in³": "in3", Cubes: "cube", cubes: "cube" };
export const VOLUME_SYMBOL: Record<VolumeUnit, string> = { cube: "Cubes", ft3: "ft³", m3: "m³", in3: "in³" };

export const toCubicFeet = (value: number, unit: VolumeUnit) => value * CUBIC_FEET_PER_UNIT[unit];
export const fromCubicFeet = (cubicFeet: number, unit: VolumeUnit) => cubicFeet / CUBIC_FEET_PER_UNIT[unit];
export const convertVolume = (value: number, from: VolumeUnit, to: VolumeUnit) => fromCubicFeet(toCubicFeet(value, from), to);

export const cementBagsFromCubicFeet = (cubicFeet: number) => cubicFeet / CUBIC_FEET_PER_CEMENT_BAG;
export const cementBagsFromCubicMetres = (cubicMetres: number) => cementBagsFromCubicFeet(cubicMetres * CUBIC_FEET_PER_CUBIC_METRE);

const round = (n: number, digits: number) => Number(n.toFixed(digits));

// Reads a stored volume like "409.5 ft³"; returns null for anything that is not a volume (bags, counts, areas…).
export function parseVolume(text: string): { cubicFeet: number } | null {
  const match = /^\s*(-?\d[\d,]*(?:\.\d+)?)\s*(ft³|m³|in³|Cubes|cubes)\s*$/.exec(text ?? "");
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { cubicFeet: toCubicFeet(value, SYMBOL_TO_UNIT[match[2]]) } : null;
}

// Shows a stored result in the chosen volume unit; non-volume values are returned unchanged.
// `unitLabel` lets the UI translate the unit name (e.g. "Cubes" in Sinhala).
export function displayVolume(text: string, unit: VolumeUnit, unitLabel: (unit: VolumeUnit) => string = u => VOLUME_SYMBOL[u], digits = 2): string {
  const parsed = parseVolume(text);
  if (!parsed) return text;
  return `${round(fromCubicFeet(parsed.cubicFeet, unit), unit === "in3" ? 0 : digits).toLocaleString(undefined, { maximumFractionDigits: unit === "in3" ? 0 : digits, minimumFractionDigits: unit === "in3" ? 0 : digits })} ${unitLabel(unit)}`;
}
