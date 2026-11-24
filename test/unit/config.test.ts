import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config.js";

const project = path.resolve("/tmp/project");
const base = { build: { output: "dist" }, source: { type: "urls" as const, pages: ["/"] } };

describe("resolveConfig", () => {
    it("fills the defaults", () => {
        const config = resolveConfig(base, project);
        expect(config).toMatchObject({ baseRef: "origin/main", deviceScaleFactor: 2, threshold: 0.2, maxDiffPixelRatio: 0, port: 6106, failOnChanges: false });
        expect(config.outDir).toBe(path.join(project, ".opensnapshot"));
        expect(config.modes).toEqual({ default: { viewport: 1200 } });
        expect(config.showModes).toBe(false);
    });

    it("shows modes only when the config sets some", () => {
        expect(resolveConfig({ ...base, modes: {} }, project).showModes).toBe(false);
        const config = resolveConfig({ ...base, modes: { dark: { colorScheme: "dark" } } }, project);
        expect(config.showModes).toBe(true);
        expect(Object.keys(config.modes)).toEqual(["dark"]);
    });

    it("lets CLI overrides win", () => {
        const config = resolveConfig({ ...base, baseRef: "origin/dev" }, project, { baseRef: "origin/release", outDir: "out" });
        expect(config.baseRef).toBe("origin/release");
        expect(config.outDir).toBe(path.join(project, "out"));
    });

    it.each([
        ["no source", { build: { output: "dist" } }, /source/],
        ["no pages", { ...base, source: { type: "urls" as const, pages: [] } }, /pages/],
        ["no output", { source: base.source }, /build\.output/],
        ["threshold out of range", { ...base, threshold: 2 }, /threshold/],
        ["outDir outside the project", { ...base, outDir: "../elsewhere" }, /outDir/],
        ["outDir is the project", { ...base, outDir: "." }, /outDir/],
    ])("rejects %s", (_name, config, message) => {
        expect(() => resolveConfig(config as never, project)).toThrow(message);
    });
});
