import { defineConfig } from "opensnapshot";

// No `modes`: every page is shot once, at the default viewport, and the review page shows no mode.
// Run it with: opensnapshot run --config opensnapshot.simple.config.ts
export default defineConfig({
    name: "example-site",
    build: { output: "site" },
    source: { type: "urls", pages: ["/", { name: "about", path: "/about.html" }] },
});
