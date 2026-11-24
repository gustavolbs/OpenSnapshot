import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

/** A way to render each item: viewport, color scheme and, for Storybook, globals such as a theme. */
export type Mode = {
    /** Width in CSS pixels, or a full viewport. Default 1200x900. */
    viewport?: number | { width: number; height?: number };
    colorScheme?: "light" | "dark";
    /** Storybook only: sent as `&globals=key:value;key:value`, for example `{ theme: "dark" }`. */
    globals?: Record<string, string>;
};

export type Page = string | { name?: string; path: string };

export type Source =
    | {
          type: "storybook";
          /** Keep only story ids that match. */
          include?: RegExp | string;
          /** Drop story ids that match. */
          exclude?: RegExp | string;
      }
    | {
          type: "urls";
          /** Paths served from the build output, for example `["/", "/about.html"]`. */
          pages: Page[];
      };

export type Config = {
    /** Label for this project on the review page and in the summary, for example `web` or `docs`. */
    name?: string;
    /** Ref to compare against. Default `origin/main`. */
    baseRef?: string;
    /** How to produce the static site. Without `command`, `output` is served as it is. */
    build?: { command?: string; output: string };
    /** Install command that runs in the base checkout before the build. Default: guessed from the lockfile. `false` skips it. */
    install?: string | false;
    source: Source;
    /**
     * Named render modes, for example one per theme or viewport. Optional: without it every item is shot
     * once, at 1200x900 with no theme, and the review page shows no mode.
     */
    modes?: Record<string, Mode>;
    /**
     * Storybook only. Shoot just the stories that a change since the merge base can affect, found with
     * `chromatic trace` (offline, no account; install the `chromatic` package). Needs the webpack stats
     * file in the build output. Without this option every story is shot.
     */
    affected?: boolean | { stats?: string; always?: (RegExp | string)[] };
    /** Screenshot scale. Default 2. */
    deviceScaleFactor?: number;
    /** Per-pixel color distance, 0 to 1. Default 0.2 (Playwright's default). */
    threshold?: number;
    /** Share of pixels allowed to differ, 0 to 1. Default 0. */
    maxDiffPixelRatio?: number;
    /** Folder for builds, baselines and the review page. Default `.opensnapshot`. */
    outDir?: string;
    /** Port of the local static server. Default 6106. */
    port?: number;
    /** Exit with code 1 when something changed. Default false: errors fail, changes do not. */
    failOnChanges?: boolean;
};

export type ResolvedConfig = Required<Pick<Config, "baseRef" | "deviceScaleFactor" | "threshold" | "maxDiffPixelRatio" | "port" | "failOnChanges">> &
    Pick<Config, "build" | "install" | "source"> & {
        name?: string;
        affected?: { stats: string; always: RegExp[] };
        projectDir: string;
        outDir: string;
        modes: Record<string, Mode>;
        /** False when the config has no `modes`: the review page then hides the mode. */
        showModes: boolean;
    };

export const defineConfig = (config: Config): Config => config;

const configNames = ["opensnapshot.config.ts", "opensnapshot.config.mts", "opensnapshot.config.js", "opensnapshot.config.mjs"];

export function findConfig(cwd: string): string | undefined {
    return configNames.map((name) => path.join(cwd, name)).find(existsSync);
}

export async function loadConfig(file: string): Promise<Config> {
    // The alias lets a config import `opensnapshot` even when it runs through `npx` or the Action.
    const self = fileURLToPath(new URL("./index.js", import.meta.url));
    const jiti = createJiti(import.meta.url, { alias: { opensnapshot: self }, interopDefault: true });
    const loaded = await jiti.import<Config | { default: Config }>(file);
    return ("default" in (loaded as object) ? (loaded as { default: Config }).default : (loaded as Config)) ?? ({} as Config);
}

export function resolveConfig(config: Config, projectDir: string, overrides: { baseRef?: string; outDir?: string } = {}): ResolvedConfig {
    if (!config.source) throw new Error("opensnapshot config: `source` is required ({ type: 'storybook' } or { type: 'urls', pages: [...] }).");
    if (config.source.type === "urls" && !config.source.pages?.length) throw new Error("opensnapshot config: `source.pages` needs at least one page.");
    if (!config.build?.output) throw new Error("opensnapshot config: `build.output` is required (the folder to serve).");
    const outDir = path.resolve(projectDir, overrides.outDir ?? config.outDir ?? ".opensnapshot");
    // `run` deletes outDir first, so it must be a folder of its own below the project.
    if (outDir === projectDir || !outDir.startsWith(projectDir + path.sep))
        throw new Error(`opensnapshot config: outDir must be a subfolder of the project (got ${outDir}).`);
    for (const [key, value] of [["threshold", config.threshold], ["maxDiffPixelRatio", config.maxDiffPixelRatio]] as const)
        if (value !== undefined && !(value >= 0 && value <= 1)) throw new Error(`opensnapshot config: ${key} must be between 0 and 1.`);
    if (config.affected && config.source.type !== "storybook") throw new Error("opensnapshot config: `affected` works with a Storybook source only.");
    const affected = config.affected ? (config.affected === true ? {} : config.affected) : undefined;
    return {
        affected: affected && { stats: affected.stats ?? "preview-stats.json", always: (affected.always ?? []).map((pattern) => new RegExp(pattern)) },
        baseRef: overrides.baseRef ?? config.baseRef ?? "origin/main",
        deviceScaleFactor: config.deviceScaleFactor ?? 2,
        threshold: config.threshold ?? 0.2,
        maxDiffPixelRatio: config.maxDiffPixelRatio ?? 0,
        port: config.port ?? 6106,
        failOnChanges: config.failOnChanges ?? false,
        build: config.build,
        install: config.install,
        source: config.source,
        name: config.name,
        projectDir,
        outDir,
        showModes: Object.keys(config.modes ?? {}).length > 0,
        modes: config.modes && Object.keys(config.modes).length ? config.modes : { default: { viewport: 1200 } },
    };
}
