import { describe, expect, it } from "vitest";
import { itemUrl, modeViewport, pagesToItems, slug, storiesFromIndex } from "../../src/items.js";

const index = {
    entries: {
        "button--primary": { id: "button--primary", title: "UI/Button", name: "Primary", type: "story" },
        "button--docs": { id: "button--docs", title: "UI/Button", name: "Docs", type: "docs" },
        "card--basic": { id: "card--basic", title: "UI/Card", name: "Basic", type: "story" },
        "card--wip": { id: "card--wip", title: "UI/Card", name: "WIP", type: "story" },
    },
};

describe("storiesFromIndex", () => {
    it("keeps stories only, sorted by id", () => {
        const items = storiesFromIndex(index, { type: "storybook" });
        expect(items.map((item) => item.id)).toEqual(["button--primary", "card--basic", "card--wip"]);
        expect(items[0]).toMatchObject({ title: "UI/Button", name: "Primary", kind: "story", url: "/iframe.html?id=button--primary&viewMode=story" });
    });

    it("applies include and exclude", () => {
        const items = storiesFromIndex(index, { type: "storybook", include: /^card/, exclude: "wip$" });
        expect(items.map((item) => item.id)).toEqual(["card--basic"]);
    });
});

describe("pagesToItems", () => {
    it("builds safe ids and de-duplicates them", () => {
        const items = pagesToItems(["/", "/about.html", "/docs/getting-started/", "/about", "/about.html?x=1"]);
        expect(items.map((item) => item.id)).toEqual(["home", "about", "docs-getting-started", "about-2", "about-html-x-1"]);
        expect(items[1]).toMatchObject({ url: "/about.html", kind: "page" });
    });

    it("adds the leading slash", () => {
        expect(pagesToItems(["pricing"])[0]!.url).toBe("/pricing");
    });

    it("slugs", () => {
        expect(slug("/")).toBe("home");
        expect(slug("/a b/c.html")).toBe("a-b-c");
    });
});

describe("itemUrl", () => {
    const [story] = storiesFromIndex(index, { type: "storybook" });
    it("adds Storybook globals", () => {
        expect(itemUrl(story!, { globals: { theme: "dark", locale: "pt-BR" } })).toBe("/iframe.html?id=button--primary&viewMode=story&globals=theme:dark;locale:pt-BR");
    });
    it("leaves pages alone", () => {
        const [page] = pagesToItems(["/"]);
        expect(itemUrl(page!, { globals: { theme: "dark" } })).toBe("/");
    });
});

describe("modeViewport", () => {
    it("reads a number, an object or nothing", () => {
        expect(modeViewport({ viewport: 390 })).toEqual({ width: 390, height: 900 });
        expect(modeViewport({ viewport: { width: 800, height: 600 } })).toEqual({ width: 800, height: 600 });
        expect(modeViewport({})).toEqual({ width: 1200, height: 900 });
    });
});
