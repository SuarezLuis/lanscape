import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/trpc": "http://localhost:4545", "/export": "http://localhost:4545" },
  },
});
