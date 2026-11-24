import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findConfig, loadConfig, resolveConfig, type ResolvedConfig } from "./config.js";
import { detectInstall, git, resolveRefs } from "./git.js";
import { pagesToItems, storiesFromIndex, type Item } from "./items.js";
import type { Manifest, Summary } from "./manifest.js";
import { close, serve } from "./serve.js";

export type RunOptions = { cwd: string; config?: string; base?: string; out?: string; failOnChanges?: boolean };

const log = (message: string) => console.log(`opensnapshot: ${message}`);

/** Runs a shell command and throws if it fails. */
function sh(command: string, cwd: string) {
    log(`$ ${command}`);
    const result = spawnSync(command, { cwd, shell: true, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${command}`);
}

const playwrightCli = () => createRequire(import.meta.url).resolve("@playwright/test/cli");

export async function loadResolved(options: Pick<RunOptions, "cwd" | "config" | "base" | "out">): Promise<ResolvedConfig> {
    const file = options.config ? path.resolve(options.cwd, options.config) : findConfig(options.cwd);
    if (!file || !existsSync(file)) throw new Error("No opensnapshot.config.ts found. Create one (see the README) or pass --config.");
    return resolveConfig(await loadConfig(file), realpathSync(path.dirname(file)), { baseRef: options.base, outDir: options.out });
}

function discover(config: ResolvedConfig, headDir: string): Item[] {
    if (config.source.type === "urls") return pagesToItems(config.source.pages);
    const index = ["index.json", "stories.json"].map((name) => path.join(headDir, name)).find(existsSync);
    if (!index) throw new Error(`No index.json in ${headDir}. Storybook 7 and later write it when you build; check build.output.`);
    return storiesFromIndex(JSON.parse(readFileSync(index, "utf8")), config.source);
}

/** Checks out the merge base next to the project, builds it, and copies the output to `dest`. */
function buildBase(config: ResolvedConfig, root: string, relDir: string, mergeBase: string, dest: string) {
    const checkout = path.join(config.outDir, "base-src");
    git(root, "worktree", "add", "--detach", checkout, mergeBase);
    try {
        const dir = path.join(checkout, relDir);
        if (config.build?.command) {
            const install = config.install === undefined ? detectInstall(dir) : config.install;
            if (install) sh(install, dir);
            sh(config.build.command, dir);
        }
        const output = path.join(dir, config.build!.output);
        if (!existsSync(output)) throw new Error(`Base build produced no ${config.build!.output} folder.`);
        cpSync(output, dest, { recursive: true });
    } finally {
        git(root, "worktree", "remove", "--force", checkout);
        git(root, "worktree", "prune");
    }
}

async function pass(name: "base" | "head", dir: string, config: ResolvedConfig, manifestFile: string): Promise<number> {
    const server = await serve(dir, config.port);
    try {
        log(`${name} pass`);
        // Async: the static server runs in this process and must keep answering while Playwright runs.
        const child = spawn(
            process.execPath,
            [playwrightCli(), "test", "-c", fileURLToPath(new URL("./playwright/playwright.config.js", import.meta.url)), ...(name === "base" ? ["--update-snapshots=all"] : [])],
            {
                cwd: config.projectDir,
                // The base pass is only bookkeeping: show its output when it fails.
                stdio: name === "base" ? ["ignore", "pipe", "pipe"] : "inherit",
                env: {
                    ...process.env,
                    OPENSNAPSHOT_PASS: name,
                    OPENSNAPSHOT_OUT: config.outDir,
                    OPENSNAPSHOT_MANIFEST: manifestFile,
                    OPENSNAPSHOT_PORT: String(config.port),
                    OPENSNAPSHOT_SCALE: String(config.deviceScaleFactor),
                    OPENSNAPSHOT_THRESHOLD: String(config.threshold),
                    OPENSNAPSHOT_MAX_DIFF_RATIO: String(config.maxDiffPixelRatio),
                },
            },
        );
        let output = "";
        child.stdout?.on("data", (chunk) => (output += chunk));
        child.stderr?.on("data", (chunk) => (output += chunk));
        const status = await new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
        if (status !== 0 && output) console.error(output);
        return status;
    } finally {
        await close(server);
    }
}

/** Builds the base and the head, screenshots both, and writes the review page. Returns the exit code. */
export async function run(options: RunOptions): Promise<number> {
    const config = await loadResolved(options);
    const refs = resolveRefs(config.projectDir, config.baseRef);
    log(`comparing HEAD ${refs.headSha.slice(0, 9)} with the merge base ${refs.mergeBase.slice(0, 9)} (${config.baseRef})`);

    rmSync(config.outDir, { recursive: true, force: true });
    mkdirSync(config.outDir, { recursive: true });

    if (config.build?.command) sh(config.build.command, config.projectDir);
    const headDir = path.resolve(config.projectDir, config.build!.output);
    if (!existsSync(headDir)) throw new Error(`build.output not found: ${headDir}`);
    const items = discover(config, headDir);
    if (!items.length) throw new Error("No stories or pages to screenshot.");
    log(`${items.length} ${config.source.type === "storybook" ? "stories" : "pages"} x ${Object.keys(config.modes).length} mode(s)`);

    const baseDir = path.join(config.outDir, "base");
    buildBase(config, refs.root, refs.relDir, refs.mergeBase, baseDir);

    const manifest: Manifest = {
        name: config.name,
        showModes: config.showModes,
        sourceType: config.source.type,
        items,
        modes: config.modes,
        base: { sha: refs.mergeBase.slice(0, 9), ref: refs.baseName },
        head: { sha: refs.headSha.slice(0, 9), ref: refs.headRef },
    };
    const manifestFile = path.join(config.outDir, "manifest.json");
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    // A failing base pass is not fatal: an item that cannot render there has no baseline and shows up as new.
    const baseStatus = await pass("base", baseDir, config, manifestFile);
    if (baseStatus !== 0) log(`warning: the base pass reported failures (exit ${baseStatus}); affected items show up as new.`);
    await pass("head", headDir, config, manifestFile);

    const summaryFile = path.join(config.outDir, "summary.json");
    if (!existsSync(summaryFile)) throw new Error("The head pass wrote no summary. Check the Playwright output above (are the browsers installed? run `opensnapshot install`).");
    const summary: Summary = JSON.parse(readFileSync(summaryFile, "utf8"));
    log(`${summary.changed} changed, ${summary.new} new, ${summary.unchanged} unchanged, ${summary.skipped} skipped, ${summary.errors.length} errors`);
    for (const error of summary.errors) log(`error in ${error.id}: ${error.message.split("\n")[0]}`);
    log(`review page: ${path.join(config.outDir, "review", "index.html")} (open it, or run \`opensnapshot review\`)`);
    if (summary.errors.length) return 1;
    return (options.failOnChanges ?? config.failOnChanges) && summary.changed + summary.new > 0 ? 1 : 0;
}

/** Serves `<out>/review` until interrupted. */
export async function review(options: Pick<RunOptions, "cwd" | "config" | "out"> & { port?: number }) {
    let outDir = path.resolve(options.cwd, options.out ?? ".opensnapshot");
    let port = options.port;
    if (!options.out || port === undefined) {
        const found = options.config || findConfig(options.cwd);
        if (found) {
            const config = await loadResolved(options);
            outDir = options.out ? outDir : config.outDir;
            port ??= config.port;
        }
    }
    const dir = path.join(outDir, "review");
    if (!existsSync(path.join(dir, "index.html"))) throw new Error(`No review page in ${dir}. Run \`opensnapshot run\` first.`);
    await serve(dir, port ?? 6106);
    log(`review page at http://localhost:${port ?? 6106}  (Ctrl+C to stop)`);
}

/** Installs the Playwright browser that matches the bundled Playwright version. */
export function install(extra: string[]): number {
    const args = extra.length ? extra : ["chromium"];
    return spawnSync(process.execPath, [playwrightCli(), "install", ...args], { stdio: "inherit" }).status ?? 1;
}
