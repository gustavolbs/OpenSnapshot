// Regenerates the screenshots in docs/img from examples/static-site: `pnpm docs:images`.
// It makes a throwaway git repo, changes the home page, runs OpenSnapshot and photographs the review pages.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const images = path.join(root, "docs/img");
mkdirSync(images, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });

function makeChange() {
    const dir = mkdtempSync(path.join(tmpdir(), "opensnapshot-docs-"));
    cpSync(path.join(root, "examples/static-site"), dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "docs@example.com");
    git(dir, "config", "user.name", "Docs");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "base");
    git(dir, "update-ref", "refs/remotes/origin/main", "main");
    git(dir, "checkout", "-qb", "change");
    const file = path.join(dir, "site/index.html");
    writeFileSync(file, readFileSync(file, "utf8").replace("Learn more", "Get started now").replace("Some text inside a card.", "Some new text inside a card, now two lines long so the card grows."));
    git(dir, "commit", "-qam", "change the home page");
    return dir;
}

const run = (dir, ...args) => execFileSync(process.execPath, [path.join(root, "dist/cli.js"), "run", ...args], { cwd: dir, stdio: "inherit" });

const browser = await chromium.launch();
async function shoot(dir, shots) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 620 } });
    const url = `file://${path.join(dir, ".opensnapshot/review/index.html")}`;
    for (const { name, hash = "", before, height = 620 } of shots) {
        await page.setViewportSize({ width: 1200, height });
        await page.goto(url + hash);
        await page.reload();
        await page.waitForLoadState("load");
        if (before) await before(page);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(images, `${name}.png`) });
        console.log(`docs/img/${name}.png`);
    }
    await page.close();
}

// Several modes (light, dark, mobile). Entries are sorted by mode name: dark #1, light #2, mobile #3.
const multi = makeChange();
run(multi);
await shoot(multi, [
    { name: "overview", hash: "", height: 740 },
    { name: "item-diff", hash: "#2" },
    { name: "item-focus", hash: "#2", before: (page) => page.click('button[aria-label="Enable focus mode"]') },
    { name: "multi-theme-dark", hash: "#1" },
    { name: "multi-mode-mobile", hash: "#3" },
]);

// No modes: one shot per page and no mode on the page.
const single = makeChange();
run(single, "--config", "opensnapshot.simple.config.ts");
await shoot(single, [
    { name: "single-mode-overview", hash: "" },
    { name: "single-mode-item", hash: "#1" },
]);
await browser.close();
