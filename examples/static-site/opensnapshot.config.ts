import { defineConfig } from "opensnapshot";

// A plain static site: no build step, the folder is served as it is.
export default defineConfig({
    baseRef: "origin/main",
    build: { output: "site" },
    source: { type: "urls", pages: ["/", { name: "about", path: "/about.html" }] },
    modes: {
        desktop: { viewport: 1200 },
        mobile: { viewport: { width: 390, height: 800 } },
    },
});
