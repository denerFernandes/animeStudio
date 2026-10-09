import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Serve scene audio ("audio/l1.wav") from the examples folder.
  publicDir: "../../examples/scenes",
  server: { fs: { allow: ["../.."] } },
});
