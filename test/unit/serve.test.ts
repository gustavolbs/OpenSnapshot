import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectInstall } from "../../src/git.js";
import { resolveFile } from "../../src/serve.js";
import { markerFor, summaryMarkdown } from "../../src/summary.js";

const root = mkdtempSync(path.join(tmpdir(), "opensnapshot-serve-"));
mkdirSync(path.join(root, "docs"));
writeFileSync(path.join(root, "index.html"), "home");
writeFileSync(path.join(root, "docs", "index.html"), "docs");
writeFileSync(path.join(root, "a b.txt"), "x");
writeFileSync(path.join(path.dirname(root), "secret.txt"), "secret");

describe("resolveFile", () => {
    it("serves files, directory indexes and encoded names", () => {
        expect(resolveFile(root, "/")).toBe(path.join(root, "index.html"));
        expect(resolveFile(root, "/docs/")).toBe(path.join(root, "docs", "index.html"));
        expect(resolveFile(root, "/a%20b.txt?x=1")).toBe(path.join(root, "a b.txt"));
    });
    it("refuses paths that leave the folder and missing files", () => {
        expect(resolveFile(root, "/../secret.txt")).toBeUndefined();
        expect(resolveFile(root, "/%2e%2e/secret.txt")).toBeUndefined();
        expect(resolveFile(root, "/nope.html")).toBeUndefined();
        expect(resolveFile(root, "/%E0%A4%A")).toBeUndefined();
    });
});

describe("detectInstall", () => {
    it("matches the lockfile", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "opensnapshot-lock-"));
        expect(detectInstall(dir)).toBeUndefined();
        writeFileSync(path.join(dir, "yarn.lock"), "");
        expect(detectInstall(dir)).toBe("yarn install --immutable");
        writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
        expect(detectInstall(dir)).toBe("pnpm install --frozen-lockfile");
    });
});

describe("summaryMarkdown", () => {
    const refs = { base: "main", head: "feature" };
    it("names the project", () => {
        expect(summaryMarkdown({ changed: 0, new: 0, unchanged: 1, skipped: 0, errors: [] }, { ...refs, name: "web" })).toContain("### OpenSnapshot: web");
        // A comment marker must never contain "--" or ">".
        expect(markerFor("my app -->")).toBe("<!-- opensnapshot:my_app_ -->");
    });
    it("says when nothing changed", () => {
        const text = summaryMarkdown({ changed: 0, new: 0, unchanged: 3, skipped: 0, errors: [] }, refs);
        expect(text.split("\n")[0]).toBe("<!-- opensnapshot -->");
        expect(text).toContain("No visual changes. 3 items match");
    });
    it("tabulates changes and lists errors", () => {
        const text = summaryMarkdown({ changed: 2, new: 1, unchanged: 5, skipped: 1, errors: [{ id: "x", message: "boom\nstack" }] }, refs);
        expect(text).toContain("| 2 | 1 | 5 | 1 | 1 |");
        expect(text).toContain("- `x`: boom");
        expect(text).not.toContain("stack");
    });
});
