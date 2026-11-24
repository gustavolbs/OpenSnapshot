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

// A playing video never gives two equal screenshots in a row. Pause every video on its first frame.
async function freezeVideos() {
    const settle = (video: HTMLVideoElement, event: string) =>
        new Promise((resolve) => {
            video.addEventListener(event, resolve, { once: true });
            setTimeout(resolve, 3000);
        });
    await Promise.all(
        [...document.querySelectorAll("video")].map(async (video) => {
            video.autoplay = false;
            video.pause();
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && video.networkState === HTMLMediaElement.NETWORK_LOADING)
                await settle(video, "loadeddata");
            if (video.currentTime !== 0) {
                video.currentTime = 0;
                await settle(video, "seeked");
            }
        })
    );
}

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
            await page.evaluate(freezeVideos);
            if (options.delay) await page.waitForTimeout(options.delay);
            await expect.soft(page).toHaveScreenshot([item.id, `${name}.png`], { fullPage: true });
        }
    });
}
