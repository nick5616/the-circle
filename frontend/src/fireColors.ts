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

export function hashNameToColor(name: string): FireColor {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i);
  }
  return FIRE_COLORS[Math.abs(hash) % FIRE_COLORS.length];
}
