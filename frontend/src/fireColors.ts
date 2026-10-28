export interface FireColor {
  element: string;
  symbol: string;
  hex: string;
  flameColor: string; // descriptive color name as used in flame-test chemistry
}

// Flame-test chemistry: every person burns as a different element. Order is
// load-bearing — it's what the name hash indexes into, so the same name keeps
// the same element across releases. Hexes are tuned to read as light, not ink.
export const FIRE_COLORS: FireColor[] = [
  { element: "Copper",    symbol: "Cu", hex: "#34e3a4", flameColor: "green-blue"  },
  { element: "Potassium", symbol: "K",  hex: "#c79bff", flameColor: "lilac"       },
  { element: "Lithium",   symbol: "Li", hex: "#ff4f86", flameColor: "pink-crimson" },
  { element: "Sodium",    symbol: "Na", hex: "#ffb636", flameColor: "golden"      },
  { element: "Cesium",    symbol: "Cs", hex: "#6cb8ff", flameColor: "blue"        },
  { element: "Boron",     symbol: "B",  hex: "#8cff6b", flameColor: "bright green" },
  { element: "Rubidium",  symbol: "Rb", hex: "#e66bff", flameColor: "red-violet"  },
  { element: "Strontium", symbol: "Sr", hex: "#ff5a3c", flameColor: "scarlet"     },
];

// djb2 with Math.imul for proper 32-bit arithmetic — floats kill distribution
export function hashNameToColor(name: string): FireColor {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h, 33) ^ name.charCodeAt(i);
  }
  return FIRE_COLORS[(h >>> 0) % FIRE_COLORS.length];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
