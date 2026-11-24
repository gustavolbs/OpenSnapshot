import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The install command that matches the lockfile in `dir`, if any. */
export function detectInstall(dir: string): string | undefined {
    const has = (name: string) => existsSync(path.join(dir, name));
    if (has("pnpm-lock.yaml")) return "pnpm install --frozen-lockfile";
    if (has("yarn.lock")) return "yarn install --immutable";
    if (has("package-lock.json")) return "npm ci";
    if (has("bun.lock") || has("bun.lockb")) return "bun install --frozen-lockfile";
    return undefined;
}

export type Refs = { root: string; relDir: string; mergeBase: string; headSha: string; headRef: string; baseName: string };

/** Resolves the repo root, the merge base with `baseRef` and the head. Throws with a hint when history is missing. */
export function resolveRefs(projectDir: string, baseRef: string): Refs {
    const root = git(projectDir, "rev-parse", "--show-toplevel");
    let mergeBase: string;
    try {
        mergeBase = git(root, "merge-base", baseRef, "HEAD");
    } catch {
        throw new Error(
            `Cannot find a merge base between ${baseRef} and HEAD. ` +
                `Fetch the base branch and the full history (in GitHub Actions: actions/checkout with fetch-depth: 0), or pass --base <ref>.`,
        );
    }
    const headSha = git(root, "rev-parse", "HEAD");
    const headRef = process.env.GITHUB_HEAD_REF || git(root, "rev-parse", "--abbrev-ref", "HEAD");
    return { root, relDir: path.relative(root, projectDir), mergeBase, headSha, headRef, baseName: baseRef.replace(/^origin\//, "") };
}
