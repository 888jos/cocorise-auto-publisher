import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#090a0d",
        panel: "#111318",
        panel2: "#181b22",
        line: "#292e39",
        muted: "#9299a8",
        mint: "#52d6a0",
        amber: "#f4bd50",
        danger: "#ff6b6b"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,.04), 0 16px 48px rgba(0,0,0,.32)"
      }
    }
  },
  plugins: []
};

export default config;
