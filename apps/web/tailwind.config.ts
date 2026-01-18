import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#7c5cff",
          dark: "#5b3bdb",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
