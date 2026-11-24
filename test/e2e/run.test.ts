import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const cli = path.join(repoRoot, "dist/cli.js");

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** A throwaway git repo with `main` committed and a `change` branch checked out. */
function makeRepo(fixture: string, config?: string, prepare?: (dir: string) => void) {
    const dir = mkdtempSync(path.join(tmpdir(), "opensnapshot-e2e-"));
    cpSync(path.join(repoRoot, fixture), dir, { recursive: true });
    if (config) writeFileSync(path.join(dir, "opensnapshot.config.ts"), config);
    prepare?.(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "base");
    git(dir, "update-ref", "refs/remotes/origin/main", "main");
    git(dir, "checkout", "-qb", "change");
    return dir;
}

const edit = (file: string, from: string, to: string) => {
    const text = readFileSync(file, "utf8");
    expect(text).toContain(from);
    writeFileSync(file, text.replace(from, to));
};
const commit = (dir: string, message: string) => (git(dir, "add", "-A"), git(dir, "commit", "-qm", message));

function run(dir: string, ...args: string[]) {
    const result = spawnSync(process.execPath, [cli, "run", ...args], { cwd: dir, encoding: "utf8", timeout: 170_000 });
    if (result.status !== 0) console.error(result.stdout, result.stderr);
    return result;
}

const summary = (dir: string) => JSON.parse(readFileSync(path.join(dir, ".opensnapshot/summary.json"), "utf8"));
/** The data object the review page was built with. */
const reviewData = (dir: string) => {
    const html = readFileSync(path.join(dir, ".opensnapshot/review/index.html"), "utf8");
    return JSON.parse(html.match(/const data = (.*);\n/)![1]!);
};

/** Opens the review page in a browser and counts the mode chips on the snapshot page and the rows on the list. */
async function inspectReview(dir: string) {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const url = `file://${path.join(dir, ".opensnapshot/review/index.html")}`;
        await page.goto(url);
        const rows = await page.locator("tr.snapshot").count();
        await page.goto(`${url}#1`);
        await page.reload();
        return { rows, chips: await page.locator(".chip").count() };
    } finally {
        await browser.close();
    }
}

describe("opensnapshot run: plain static site", () => {
    const dir = makeRepo("examples/static-site");

    it("reports no changes when only markup that does not render changes", () => {
        edit(path.join(dir, "site/index.html"), "<title>Home</title>", "<title>Home page</title>");
        commit(dir, "title only");
        expect(run(dir).status).toBe(0);
        expect(summary(dir)).toMatchObject({ changed: 0, new: 0, unchanged: 2, errors: [] });
        expect(reviewData(dir).items).toEqual([]);
    }, 180_000);

    it("shows only the page whose element changed, and a new page as new", async () => {
        edit(path.join(dir, "site/index.html"), "Some text inside a card.", "Some other text inside a card.");
        writeFileSync(path.join(dir, "site/pricing.html"), readFileSync(path.join(dir, "site/about.html"), "utf8").replace("About", "Pricing"));
        edit(path.join(dir, "opensnapshot.config.ts"), '{ name: "about", path: "/about.html" }', '{ name: "about", path: "/about.html" }, "/pricing.html"');
        commit(dir, "change the card, add a page");

        const result = run(dir);
        expect(result.status).toBe(0);
        expect(summary(dir)).toMatchObject({ changed: 1, new: 1, unchanged: 1, skipped: 0, errors: [] });

        const data = reviewData(dir);
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(["home", "pricing"]);
        const home = data.items.find((item: { id: string }) => item.id === "home");
        expect(home.snapshots.map((snapshot: { mode: string }) => snapshot.mode)).toEqual(["dark", "light", "mobile"]);
        for (const snapshot of home.snapshots) {
            expect(snapshot).toMatchObject({ expected: expect.any(String), actual: expect.any(String), changes: expect.any(String) });
            expect(existsSync(path.join(dir, ".opensnapshot/review", snapshot.actual))).toBe(true);
        }
        // The page that did not change leaves no images behind.
        expect(existsSync(path.join(dir, ".opensnapshot/review/img/about"))).toBe(false);
        expect(readFileSync(path.join(dir, ".opensnapshot/summary.md"), "utf8")).toContain("| 1 | 1 | 1 | 0 | 0 |");
        expect(data.showModes).toBe(true);
        // Several modes: the page shows the mode (3 for home, 3 for the new page) and a chip on the item page.
        expect(await inspectReview(dir)).toEqual({ rows: 6, chips: 1 });
    }, 180_000);

    it("exits 1 with --fail-on-changes", () => {
        expect(run(dir, "--fail-on-changes").status).toBe(1);
    }, 180_000);
});

describe("opensnapshot run: no modes at all", () => {
    // Same site and change, but a config without `modes`: a plain baseline-versus-change diff.
    const dir = makeRepo("examples/static-site");

    it("shoots each page once and the review page shows no mode", async () => {
        edit(path.join(dir, "site/index.html"), "Some text inside a card.", "Some other text inside a card.");
        commit(dir, "change the card");

        expect(run(dir, "--config", "opensnapshot.simple.config.ts").status).toBe(0);
        expect(summary(dir)).toMatchObject({ changed: 1, new: 0, unchanged: 1, errors: [] });
        const data = reviewData(dir);
        expect(data).toMatchObject({ showModes: false, name: "example-site" });
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(["home"]);
        expect(data.items[0].snapshots).toHaveLength(1);
        expect(data.items[0].snapshots[0]).toMatchObject({ mode: "default", width: 1200 });
        // One row for the item and no mode chip on its page.
        expect(await inspectReview(dir)).toEqual({ rows: 1, chips: 0 });
        expect(readFileSync(path.join(dir, ".opensnapshot/summary.md"), "utf8")).toContain("### OpenSnapshot: example-site");
    }, 180_000);
});

describe("opensnapshot run: Storybook build", () => {
    const config = `import { defineConfig } from "opensnapshot";
export default defineConfig({
    port: 6107,
    build: { output: "storybook-static" },
    source: { type: "storybook", exclude: /secondary/ },
    modes: { light: { viewport: 600 }, dark: { viewport: 600, globals: { theme: "dark" } } },
});
`;
    const dir = makeRepo("test/fixtures/storybook-like", config);

    it("snapshots stories in every mode and reports only the changed story", () => {
        edit(path.join(dir, "storybook-static/iframe.html"), '<button class="btn">Primary</button>', '<button class="btn">Primary!</button>');
        commit(dir, "change a story");

        expect(run(dir).status).toBe(0);
        // 3 stories pass the filter: button--primary changed, card--basic same, card--off is turned off by its parameters.
        expect(summary(dir)).toMatchObject({ changed: 1, new: 0, unchanged: 1, skipped: 1, errors: [] });
        const data = reviewData(dir);
        expect(data.items.map((item: { id: string }) => item.id)).toEqual(["button--primary"]);
        expect(data.items[0].snapshots.map((snapshot: { mode: string }) => snapshot.mode)).toEqual(["dark", "light"]);
        expect(data.items[0]).toMatchObject({ title: "UI/Button", name: "Primary" });
    }, 180_000);
});

describe("opensnapshot run: only the affected stories", () => {
    const config = `import { defineConfig } from "opensnapshot";
export default defineConfig({
    port: 6108,
    build: { output: "storybook-static" },
    source: { type: "storybook", exclude: /secondary/ },
    affected: true,
});
`;
    // A stand-in for \`chromatic trace\`: it lists a stories file when that file is among the changed ones.
    const fakeChromatic = `#!/usr/bin/env node
for (const file of process.argv.slice(2)) if (file.endsWith(".stories.js")) console.log("\u2014 " + file);
`;
    const prepare = (dir: string) => {
        writeFileSync(path.join(dir, "storybook-static/preview-stats.json"), JSON.stringify({ modules: [] }));
        for (const name of ["button", "card"]) writeFileSync(path.join(dir, `${name}.stories.js`), "// stories\n");
        mkdirSync(path.join(dir, "node_modules/.bin"), { recursive: true });
        writeFileSync(path.join(dir, "node_modules/.bin/chromatic"), fakeChromatic);
        chmodSync(path.join(dir, "node_modules/.bin/chromatic"), 0o755);
    };

    it("shoots only the stories of a changed stories file", () => {
        const dir = makeRepo("test/fixtures/storybook-like", config, prepare);
        edit(path.join(dir, "storybook-static/iframe.html"), '<button class="btn">Primary</button>', '<button class="btn">Primary!</button>');
        edit(path.join(dir, "button.stories.js"), "// stories", "// stories, changed");
        commit(dir, "change a story");

        expect(run(dir).status).toBe(0);
        // 3 stories pass the filter; only button--primary comes from the changed file.
        expect(summary(dir)).toMatchObject({ changed: 1, new: 0, unchanged: 0, notAffected: 2, errors: [] });
        expect(reviewData(dir).items.map((item: { id: string }) => item.id)).toEqual(["button--primary"]);
    }, 180_000);

    it("skips the builds and both passes when no story is affected", () => {
        const dir = makeRepo("test/fixtures/storybook-like", config, prepare);
        writeFileSync(path.join(dir, "NOTES.md"), "not a story file\n");
        commit(dir, "docs only");

        const result = run(dir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("nothing to compare");
        expect(summary(dir)).toEqual({ changed: 0, new: 0, unchanged: 0, skipped: 0, errors: [], notAffected: 3 });
        expect(reviewData(dir).items).toEqual([]);
        expect(readFileSync(path.join(dir, ".opensnapshot/summary.md"), "utf8")).toContain("3 stories are not affected by the change");
        expect(existsSync(path.join(dir, ".opensnapshot/base"))).toBe(false);
    }, 180_000);
});
