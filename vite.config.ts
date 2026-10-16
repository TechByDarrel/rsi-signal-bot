import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/rsi-signal-bot/" : "/",
}));
