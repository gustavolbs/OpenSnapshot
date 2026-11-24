import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Summary } from "./manifest.js";
import { summaryMarkdown } from "./summary.js";

/** Writes `<dir>/index.html`: the review template with the data inlined. */
export function writeReviewPage(dir: string, data: object) {
    const template = readFileSync(fileURLToPath(new URL("./review.html", import.meta.url)), "utf8");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), template.replace("/*DATA*/null", () => JSON.stringify(data).replace(/</g, "\\u003c")));
}

/** Writes `summary.json` and `summary.md` into `out`. */
export function writeSummary(out: string, summary: Summary, refs: { name?: string; base: string; head: string }) {
    writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    writeFileSync(path.join(out, "summary.md"), summaryMarkdown(summary, refs));
}
