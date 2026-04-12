import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ember: {
          950: "#1a1510",
          900: "#201a13",
          800: "#2d2418",
          700: "#3d3020",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
