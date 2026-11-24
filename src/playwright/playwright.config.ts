import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// `opensnapshot run` sets these: the folder for baselines and the review page, and the pass to run.
const env = (name: string) => process.env[name]!;
const out = env("OPENSNAPSHOT_OUT");
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
    testDir: here("./"),
    testMatch: "snapshots.spec.js",
    outputDir: `${out}/test-results`,
    // Both passes write to and read from the same folder: the base pass with `--update-snapshots=all`.
    snapshotPathTemplate: `${out}/baseline/{arg}{ext}`,
    fullyParallel: true,
    retries: 0,
    // Full-page shots at 2x take longer than the default 5 s to settle.
    expect: {
        timeout: 30_000,
        toHaveScreenshot: {
            threshold: Number(env("OPENSNAPSHOT_THRESHOLD")),
            maxDiffPixelRatio: Number(env("OPENSNAPSHOT_MAX_DIFF_RATIO")),
            animations: "disabled",
            caret: "hide",
            // Keep the device scale factor so the shots stay sharp.
            scale: "device",
        },
    },
    // Only the head pass writes the review page: the base pass just records baselines.
    reporter: process.env.OPENSNAPSHOT_PASS === "head" ? [[here("./reporter.js")]] : [["dot"]],
    use: {
        ...devices["Desktop Chrome"],
        deviceScaleFactor: Number(env("OPENSNAPSHOT_SCALE")),
        baseURL: `http://127.0.0.1:${env("OPENSNAPSHOT_PORT")}`,
        // Same locale, time zone and font rendering on every machine.
        locale: "en-US",
        timezoneId: "UTC",
        serviceWorkers: "block",
        launchOptions: { args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars"] },
    },
});
