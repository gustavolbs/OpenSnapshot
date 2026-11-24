import { defineConfig } from "opensnapshot";

// A plain static site: no build step, the folder is served as it is.
export default defineConfig({
    name: "example-site",
    baseRef: "origin/main",
    build: { output: "site" },
    source: { type: "urls", pages: ["/", { name: "about", path: "/about.html" }] },
    // Several modes: every page is shot once per mode (here two themes and a phone width).
    modes: {
        light: { viewport: 1200 },
        dark: { viewport: 1200, colorScheme: "dark" },
        mobile: { viewport: { width: 390, height: 800 } },
    },
});
