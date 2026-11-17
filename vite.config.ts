import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  // shadcn/ui imports components as `@/components/ui/...`
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Radix brings in ~30 packages. Prebundled sourcemaps double the number of
  // files Vite has to swap during an optimizer run; skipping them keeps the
  // dev cache small (and dev-only, production is unaffected).
  optimizeDeps: {
    esbuildOptions: {
      sourcemap: false,
    },
    // Prebundle the calendar dependency together with everything else. A
    // late "new dependency discovered -> re-optimize" run makes Vite swap a
    // large deps directory, which trips the sandbox bulk-delete guard.
    // The updater's Tauri API imports are listed for the same reason: they are
    // reached only from the settings tab, so Vite would otherwise discover
    // them on first open and re-optimize mid-session.
    include: [
      "react-day-picker",
      "react-day-picker/locale/zh-CN",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-opener",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
