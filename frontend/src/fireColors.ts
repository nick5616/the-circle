export interface FireColor {
  element: string;
  hex: string;
}

export const FIRE_COLORS: FireColor[] = [
  { element: "Copper",    hex: "#3EB489" },
  { element: "Potassium", hex: "#9B59B6" },
  { element: "Lithium",   hex: "#C0392B" },
  { element: "Sodium",    hex: "#E67E22" },
  { element: "Cesium",    hex: "#5DADE2" },
  { element: "Boron",     hex: "#27AE60" },
  { element: "Rubidium",  hex: "#8E44AD" },
  { element: "Strontium", hex: "#E74C3C" },
];

// djb2 with Math.imul for proper 32-bit arithmetic — floats kill distribution
export function hashNameToColor(name: string): FireColor {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h, 33) ^ name.charCodeAt(i);
  }
  return FIRE_COLORS[(h >>> 0) % FIRE_COLORS.length];
}
