import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "./config.js";
import { git, type Refs } from "./git.js";
import type { Item } from "./items.js";

/** Returns the stories files that import any of `files`, or null when every story can be affected. */
export type Trace = (files: string[]) => Set<string> | null;

const lockfiles = ["yarn.lock", "pnpm-lock.yaml", "package-lock.json"];
const isLockfile = (file: string) => lockfiles.some((name) => file === name || file.endsWith(`/${name}`));
// The trace refuses manifests; the packages they change come in through the lockfile instead.
const isManifest = (file: string) => /(^|\/)package\.json$/.test(file) || isLockfile(file);

/**
 * Names of the packages whose lines changed in a lockfile diff. Reads yarn (v2 and later) descriptors and
 * `resolution:` lines, pnpm package keys and package-lock.json `node_modules/` keys.
 * shortcut: yarn v1 lockfiles carry the name only on descriptor lines, so a bump inside a range is missed. Upgrade when someone needs it.
 */
export function changedPackages(diff: string): Set<string> {
    const names = new Set<string>();
    for (const line of diff.split("\n")) {
        if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
        const text = line.slice(1);
        const resolution = text.match(/^\s+resolution:\s*["']?(@?[^@\s"']+)@/);
        const lock = text.match(/^\s*"node_modules\/(?:.*node_modules\/)?((?:@[^/"]+\/)?[^/"]+)"\s*:/);
        if (resolution) names.add(resolution[1]!);
        else if (lock) names.add(lock[1]!);
        else
            for (const descriptor of text.replace(/:\s*$/, "").split(", ")) {
                const name = descriptor.match(/^\s{0,2}["']?\/?(@?[^@\s"'(,:]+)@/)?.[1];
                if (name) names.add(name);
            }
    }
    return names;
}

/** Bundle modules that belong to one of `packages`. */
export function packageModules(modules: string[], packages: Set<string>): string[] {
    return modules.filter((name) => {
        const pkg = name.match(/.*node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1];
        return pkg !== undefined && packages.has(pkg);
    });
}

export type AffectedInput = {
    /** Files changed since the merge base, relative to the repo root. */
    changed: string[];
    /** A change to one of these affects every story: files served as they are, which the stats cannot trace. */
    always: RegExp[];
    lockfileDiff: string;
    /** Module names of the build stats, relative to the Storybook folder. */
    modules: string[];
    trace: Trace;
};

/** The stories a change can affect. A story without an `importPath` always counts. */
export function selectAffected(items: Item[], { changed, always, lockfileDiff, modules, trace }: AffectedInput, toRoot: (module: string) => string = (module) => module): Item[] {
    if (changed.some((file) => always.some((pattern) => pattern.test(file)))) return items;
    let packageFiles: string[] = [];
    if (changed.some(isLockfile)) {
        const packages = changedPackages(lockfileDiff);
        // A lockfile change we cannot read must not hide a regression.
        if (!packages.size) return items;
        packageFiles = packageModules(modules, packages).map(toRoot);
    }
    const files = [...new Set([...changed.filter((file) => !isManifest(file)), ...packageFiles])];
    if (!files.length) return [];
    const affected = trace(files);
    return affected ? items.filter((item) => !item.importPath || affected.has(item.importPath)) : items;
}

/** `chromatic trace` reads the webpack stats offline and needs no account or token. */
function chromaticTrace(bin: string, root: string, relDir: string, stats: string): Trace {
    const base = relDir || ".";
    return (files) => {
        const result = spawnSync(bin, ["trace", "-m", "compact", "-b", base, "-s", stats, ...files], { cwd: root, encoding: "utf8" });
        if (result.status !== 0) throw new Error(`chromatic trace failed:\n${result.stderr}`);
        const output = result.stdout + result.stderr;
        // A change to the preview config, or to anything it imports, can affect every story.
        if (output.includes("TurboSnap disabled")) return null;
        return new Set(
            output
                .split("\n")
                .filter((line) => line.startsWith("— "))
                // Real output reads "— src/A.stories.js + 3 modules": drop the module count.
                .map((line) => `./${path.relative(base, line.slice(2).replace(/ \+ \d+ modules?$/, "").trim())}`),
        );
    };
}

/** Narrows `items` to the stories that the change between the merge base and HEAD can affect. */
export function findAffected(items: Item[], config: ResolvedConfig, refs: Refs, headDir: string): Item[] {
    const options = config.affected!;
    const stats = path.join(headDir, options.stats);
    if (!existsSync(stats))
        throw new Error(
            `\`affected\` needs ${options.stats} in the build output (${headDir}). ` +
                `Build Storybook with webpack stats (\`storybook build --stats-json\`); with Vite, add a plugin that writes a webpack-style stats file.`,
        );
    const bin = [config.projectDir, refs.root].map((dir) => path.join(dir, "node_modules/.bin/chromatic")).find(existsSync);
    if (!bin) throw new Error("`affected` runs `chromatic trace`, which comes with the chromatic package: add it as a dev dependency (it needs no account).");
    const modules = (JSON.parse(readFileSync(stats, "utf8")).modules ?? []).flatMap((module: { name: string; modules?: { name: string }[] }) => [module, ...(module.modules ?? [])]).map((module: { name: string }) => module.name.replace(/ \+ \d+ modules$/, ""));
    return selectAffected(
        items,
        {
            changed: git(refs.root, "diff", "--name-only", refs.mergeBase, "HEAD").split("\n").filter(Boolean),
            always: options.always,
            lockfileDiff: git(refs.root, "diff", refs.mergeBase, "HEAD", "--", ...lockfiles),
            modules,
            trace: chromaticTrace(bin, refs.root, refs.relDir, stats),
        },
        (module) => path.relative(refs.root, path.resolve(config.projectDir, module)),
    );
}
