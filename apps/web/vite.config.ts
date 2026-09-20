import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The dev server forwards API calls to whichever service runs on :8080 (api-go or api-ts).
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
