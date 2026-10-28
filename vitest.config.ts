import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      // A fixed test passcode, so a fresh clone without a local .env passes too.
      miniflare: { bindings: { DEMO_PASSCODE: "test-passcode", TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")) } },
    })),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"], deps: { optimizer: { ssr: { enabled: true, include: ["react", "react-dom/server.edge"] } } } },
});
