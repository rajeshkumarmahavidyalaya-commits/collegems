import { config } from "dotenv";

/**
 * Per-worker environment. The human-facing warning about missing credentials
 * lives in `tests/global-setup.ts`, because console output from a setup file
 * is never surfaced by the reporter.
 */
config({ path: ".env.test.local" });
config({ path: ".env.local" });
