export interface FireColor {
  element: string;
  hex: string;
  flameColor: string; // descriptive color name as used in flame-test chemistry
}

export const FIRE_COLORS: FireColor[] = [
  { element: "Copper",    hex: "#3EB489", flameColor: "green"        },
  { element: "Potassium", hex: "#9B59B6", flameColor: "lilac"        },
  { element: "Lithium",   hex: "#C0392B", flameColor: "crimson"      },
  { element: "Sodium",    hex: "#E67E22", flameColor: "bright yellow" },
  { element: "Cesium",    hex: "#5DADE2", flameColor: "blue"         },
  { element: "Boron",     hex: "#27AE60", flameColor: "vivid green"  },
  { element: "Rubidium",  hex: "#8E44AD", flameColor: "violet"       },
  { element: "Strontium", hex: "#E74C3C", flameColor: "scarlet"      },
];

// djb2 with Math.imul for proper 32-bit arithmetic — floats kill distribution
export function hashNameToColor(name: string): FireColor {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h, 33) ^ name.charCodeAt(i);
  }
  return FIRE_COLORS[(h >>> 0) % FIRE_COLORS.length];
}
