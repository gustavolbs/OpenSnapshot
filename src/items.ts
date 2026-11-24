import type { Mode, Page, Source } from "./config.js";

/** One thing to screenshot: a story or a page. */
export type Item = {
    /** Unique, safe for file names. */
    id: string;
    /** Group shown on the review page (Storybook: the component path; URLs: the path). */
    title: string;
    name: string;
    /** Path and query to open, before mode globals. */
    url: string;
    kind: "story" | "page";
    /** Storybook: the stories file, as in `index.json`. Used to find the stories a change affects. */
    importPath?: string;
};

type IndexEntry = { id: string; title: string; name: string; type?: string; importPath?: string };

const toRegExp = (value?: RegExp | string) => (value === undefined ? undefined : new RegExp(value));

/** Stories from a Storybook `index.json`. Docs entries are skipped. */
export function storiesFromIndex(index: { entries?: Record<string, IndexEntry> }, source: Extract<Source, { type: "storybook" }>): Item[] {
    const include = toRegExp(source.include);
    const exclude = toRegExp(source.exclude);
    return Object.values(index.entries ?? {})
        .filter((entry) => (entry.type ?? "story") === "story")
        .filter((entry) => (!include || include.test(entry.id)) && !(exclude && exclude.test(entry.id)))
        .map((entry) => ({
            id: entry.id,
            title: entry.title,
            name: entry.name,
            url: `/iframe.html?id=${encodeURIComponent(entry.id)}&viewMode=story`,
            kind: "story" as const,
            importPath: entry.importPath,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

export const slug = (value: string) => value.replace(/^\/+|\/+$/g, "").replace(/\.html?$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";

/** Pages from `source.pages`; duplicate names get a numeric suffix. */
export function pagesToItems(pages: Page[]): Item[] {
    const seen = new Map<string, number>();
    return pages.map((page) => {
        const { path, name } = typeof page === "string" ? { path: page, name: undefined } : page;
        const base = slug(name ?? path);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        return {
            id: count ? `${base}-${count + 1}` : base,
            title: name ?? path,
            name: "",
            url: path.startsWith("/") ? path : `/${path}`,
            kind: "page" as const,
        };
    });
}

/** URL to open for an item in a mode. */
export function itemUrl(item: Item, mode: Mode): string {
    if (item.kind !== "story" || !mode.globals || !Object.keys(mode.globals).length) return item.url;
    const globals = Object.entries(mode.globals).map(([key, value]) => `${key}:${value}`).join(";");
    return `${item.url}&globals=${encodeURIComponent(globals).replace(/%3A/g, ":").replace(/%3B/g, ";")}`;
}

/** Viewport for a mode. */
export function modeViewport(mode: Mode): { width: number; height: number } {
    const { viewport } = mode;
    if (typeof viewport === "number") return { width: viewport, height: 900 };
    return { width: viewport?.width ?? 1200, height: viewport?.height ?? 900 };
}
