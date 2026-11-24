import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { itemUrl, modeViewport } from "../items.js";
import type { Manifest } from "../manifest.js";

const manifest: Manifest = JSON.parse(readFileSync(process.env.OPENSNAPSHOT_MANIFEST!, "utf8"));
const isBase = process.env.OPENSNAPSHOT_PASS === "base";

type StoryParameters = { disable?: boolean; delay?: number } | null;

const waitForStory = (page: Page) =>
    page.waitForFunction(() => {
        const phase = (window as any).__STORYBOOK_PREVIEW__?.currentRender?.phase;
        if (phase === "errored") throw new Error("The story failed to render.");
        return phase === "completed" || phase === "finished";
    });

// A story can set `parameters: { opensnapshot: { disable: true, delay: 300 } }`.
const readStory = (page: Page, id: string) =>
    page.evaluate(async (storyId): Promise<{ opensnapshot: StoryParameters } | null> => {
        const preview = (window as any).__STORYBOOK_PREVIEW__;
        const story = await preview.storyStoreValue.loadStory({ storyId }).catch(() => null);
        return story && { opensnapshot: story.parameters.opensnapshot ?? {} };
    }, id);

for (const item of manifest.items) {
    test(item.id, async ({ page }) => {
        let options: NonNullable<StoryParameters> = {};
        if (item.kind === "story") {
            await page.goto(item.url);
            await page.waitForFunction(() => (window as any).__STORYBOOK_PREVIEW__?.storyStoreValue);
            const story = await readStory(page, item.id);
            // On the base pass, a story added by the change does not exist yet; the head pass reports it as new.
            test.skip(!story, "Not in this Storybook build.");
            options = story!.opensnapshot ?? {};
            test.skip(options.disable === true, "Snapshots are turned off for this story.");
        }

        for (const [name, mode] of Object.entries(manifest.modes)) {
            await page.setViewportSize(modeViewport(mode));
            await page.emulateMedia({ colorScheme: mode.colorScheme ?? "light" });
            const response = await page.goto(itemUrl(item, mode));
            if (item.kind === "story") await waitForStory(page);
            else if (response && response.status() >= 400) {
                // A page the change adds is a 404 in the base build: skip it there, report it as new on the head pass.
                test.skip(isBase && response.status() === 404, "Not in the base build.");
                throw new Error(`${item.url} answered ${response.status()}.`);
            }
            await page.evaluate(() => document.fonts.ready);
            if (options.delay) await page.waitForTimeout(options.delay);
            await expect.soft(page).toHaveScreenshot([item.id, `${name}.png`], { fullPage: true });
        }
    });
}
