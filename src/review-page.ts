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

/** Writes `summary.json` and `summary.md` into `out`. The JSON also goes into `review/`, so a deployed page serves it. */
export function writeSummary(out: string, summary: Summary, refs: { name?: string; base: string; head: string }) {
    const json = JSON.stringify({ ...summary, name: refs.name, head: refs.head, at: new Date().toISOString() }, null, 2);
    writeFileSync(path.join(out, "summary.json"), json);
    mkdirSync(path.join(out, "review"), { recursive: true });
    writeFileSync(path.join(out, "review", "summary.json"), json);
    writeFileSync(path.join(out, "summary.md"), summaryMarkdown(summary, refs));
}

/** Writes `<dir>/index.html`: the page that lists projects, each with its latest summary (or none). */
export function writeProjectsPage(dir: string, projects: { name: string; url: string; summary?: Summary }[]) {
    const template = readFileSync(fileURLToPath(new URL("./projects.html", import.meta.url)), "utf8");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.html"), template.replace("/*DATA*/null", () => JSON.stringify(projects).replace(/</g, "\\u003c")));
}
