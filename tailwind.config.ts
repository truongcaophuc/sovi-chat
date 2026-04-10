import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        zalo: {
          blue: "#0068ff",
          bg: "#f4f5f7",
        },
      },
    },
  },
  plugins: [],
};
export default config;
