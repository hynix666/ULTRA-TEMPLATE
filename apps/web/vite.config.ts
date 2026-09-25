import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { apiProxy } from "./api-proxy.ts";

export default defineConfig({
  plugins: [react()],
  // The dev server forwards API calls to whichever task service runs on its default port.
  server: {
    proxy: apiProxy,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
