import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",

  plugins: [
    react(),

    VitePWA({
      registerType: "autoUpdate",

      manifest: {
        name: "ONE PIECE CARD LOCAL",
        short_name: "OPCG",

        start_url: "/",
        scope: "/",

        display: "standalone",

        background_color: "#0f172a",
        theme_color: "#0f172a",

        icons: [],
      },
    }),
  ],
});