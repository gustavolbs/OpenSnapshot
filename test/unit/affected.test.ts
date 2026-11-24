import { describe, expect, it } from "vitest";
import { changedPackages, packageModules, selectAffected, type Trace } from "../../src/affected.js";
import type { Item } from "../../src/items.js";

const story = (id: string, importPath?: string): Item => ({ id, title: id, name: id, url: "/", kind: "story", importPath });
const items = [story("a--one", "./a.stories.js"), story("b--one", "./b.stories.js"), story("c--one")];
const input = { changed: [] as string[], always: [], lockfileDiff: "", modules: [] as string[] };
const tracing = (...stories: string[]): Trace => () => new Set(stories);
const never: Trace = () => {
    throw new Error("trace must not run");
};

describe("changedPackages", () => {
    it("reads yarn berry descriptors and resolutions", () => {
        const diff = [
            '-"lodash@npm:^4.17.0, lodash@npm:^4.17.20":',
            '+"lodash@npm:^4.17.0, lodash@npm:^4.17.21":',
            '-  resolution: "@scope/pkg@npm:1.0.0"',
            '+  resolution: "@scope/pkg@npm:1.1.0"',
            "-  version: 1.0.0",
            "+++ b/yarn.lock",
        ].join("\n");
        expect([...changedPackages(diff)].sort()).toEqual(["@scope/pkg", "lodash"]);
    });

    it("reads pnpm package keys and ignores nested lines", () => {
        const diff = ["-  react@18.2.0:", "+  react@18.3.0:", "+  '@types/react@18.3.0':", "-    resolution: {integrity: sha512-abc}", "+      zod:"].join("\n");
        expect([...changedPackages(diff)].sort()).toEqual(["@types/react", "react"]);
    });

    it("reads package-lock keys, including nested ones", () => {
        const diff = ['+    "node_modules/axios": {', '-    "node_modules/foo/node_modules/@a/b": {'].join("\n");
        expect([...changedPackages(diff)].sort()).toEqual(["@a/b", "axios"]);
    });
});

describe("packageModules", () => {
    it("matches the last node_modules segment, so pnpm paths work", () => {
        const modules = ["./node_modules/lodash/index.js", "./node_modules/.pnpm/zod@3/node_modules/zod/lib.js", "./src/a.ts", "./node_modules/@s/p/x.js"];
        expect(packageModules(modules, new Set(["lodash", "zod"]))).toEqual([modules[0], modules[1]]);
    });
});

describe("selectAffected", () => {
    it("keeps the stories the trace returns and the ones without an import path", () => {
        const result = selectAffected(items, { ...input, changed: ["src/a.ts"], trace: tracing("./a.stories.js") });
        expect(result.map((item) => item.id)).toEqual(["a--one", "c--one"]);
    });

    it("returns nothing when only manifests changed and no package maps to a module", () => {
        expect(selectAffected(items, { ...input, changed: ["package.json"], trace: never })).toEqual([]);
    });

    it("returns every story when a changed file matches `always`", () => {
        expect(selectAffected(items, { ...input, changed: ["public/logo.svg"], always: [/^public\//], trace: never })).toBe(items);
    });

    it("returns every story when the trace reports a disabled run", () => {
        expect(selectAffected(items, { ...input, changed: ["src/a.ts"], trace: () => null })).toBe(items);
    });

    it("returns every story when a lockfile changed but no package can be read from it", () => {
        expect(selectAffected(items, { ...input, changed: ["yarn.lock"], lockfileDiff: "+# comment", trace: never })).toBe(items);
    });

    it("traces the modules of a changed package", () => {
        const seen: string[][] = [];
        const trace: Trace = (files) => (seen.push(files), new Set(["./b.stories.js"]));
        const result = selectAffected(
            items,
            { ...input, changed: ["yarn.lock", "package.json"], lockfileDiff: '+  resolution: "lodash@npm:4.17.21"', modules: ["./node_modules/lodash/x.js", "./src/y.ts"], trace },
            (module) => `app/${module.slice(2)}`,
        );
        expect(seen).toEqual([["app/node_modules/lodash/x.js"]]);
        expect(result.map((item) => item.id)).toEqual(["b--one", "c--one"]);
    });
});
