import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { projectsIndex } from "../../src/run.js";
import { close, serve } from "../../src/serve.js";

const root = mkdtempSync(path.join(tmpdir(), "opensnapshot-projects-"));
mkdirSync(path.join(root, "web"));
writeFileSync(path.join(root, "web/summary.json"), JSON.stringify({ changed: 2, new: 1, unchanged: 5, skipped: 0, errors: [], name: "web", head: "feature/x", at: "2026-11-24T12:00:00Z" }));
const server = await serve(root, 6193);
afterAll(() => close(server));

describe("projectsIndex", () => {
    it("lists each project with its summary, or none when the URL has no summary.json", async () => {
        const project = path.join(root, "app");
        mkdirSync(project);
        writeFileSync(path.join(project, "opensnapshot.config.mjs"), `export default { projects: { web: "http://127.0.0.1:6193/web", docs: "http://127.0.0.1:6193/missing" } };`);

        const dir = await projectsIndex({ cwd: project });
        expect(dir).toBe(path.join(project, ".opensnapshot/projects"));
        const html = readFileSync(path.join(dir, "index.html"), "utf8");
        const rows = JSON.parse(html.match(/const projects = (.*);\n/)![1]!);
        expect(rows).toEqual([
            { name: "web", url: "http://127.0.0.1:6193/web", summary: expect.objectContaining({ changed: 2, head: "feature/x" }) },
            { name: "docs", url: "http://127.0.0.1:6193/missing" },
        ]);
    });

    it("needs projects in the config", async () => {
        const project = path.join(root, "empty");
        mkdirSync(project);
        writeFileSync(path.join(project, "opensnapshot.config.mjs"), "export default {};");
        await expect(projectsIndex({ cwd: project })).rejects.toThrow("Set `projects`");
    });
});
