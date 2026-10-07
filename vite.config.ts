import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
const apiTarget = `http://localhost:${process.env.API_PORT || process.env.PORT || 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // En dev, l'API Express + PeerJS tournent via « node server.js » : on les proxifie.
    proxy: {
      "/api": apiTarget,
      "/peerjs": { target: apiTarget, ws: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    proxy: {
      "/api": apiTarget,
      "/peerjs": { target: apiTarget, ws: true },
    },
  },
});
