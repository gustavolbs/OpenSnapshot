import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { PNG } from "pngjs";
import { diffLayers, type Image } from "../layers.js";
import type { ChangedItem, Manifest, Snapshot, Summary } from "../manifest.js";
import { writeReviewPage, writeSummary } from "../review-page.js";

const out = process.env.OPENSNAPSHOT_OUT!;
const dir = path.join(out, "review");
const kinds = ["expected", "actual", "diff"] as const;
const manifest: Manifest = JSON.parse(readFileSync(process.env.OPENSNAPSHOT_MANIFEST!, "utf8"));
const items = new Map(manifest.items.map((item) => [item.id, item]));

/**
 * Writes `review/`, a static page that shows only the items whose screenshots changed, plus
 * `summary.json` and `summary.md`. The review folder can be deployed or zipped as it is.
 */
export default class ReviewReporter implements Reporter {
    private changed: ChangedItem[] = [];
    private errors: Summary["errors"] = [];
    private unchanged = 0;
    private skipped = 0;
    private groups = new Set<string>();
    private baselines = new Set<string>();

    onBegin() {
        // What the base pass recorded. Playwright also attaches an "expected" image for a missing baseline, so this is how we tell new from changed.
        const baseline = path.join(out, "baseline");
        this.baselines = new Set(existsSync(baseline) ? readdirSync(baseline, { recursive: true, encoding: "utf8" }).map((file) => file.split(path.sep).join("/")) : []);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
    }

    onTestEnd(test: TestCase, result: TestResult) {
        const id = test.title;
        this.groups.add(items.get(id)?.title ?? id);
        if (result.status === "skipped") return void this.skipped++;
        if (result.status === "passed") return void this.unchanged++;
        const scale = test.parent.project()?.use.deviceScaleFactor ?? 1;
        const snapshots = new Map<string, Snapshot>();
        for (const { name, path: file } of result.attachments) {
            const match = path.basename(name).match(/^(.+)-(expected|actual|diff)\.png$/);
            if (!match || !file) continue;
            const [, mode, kind] = match as unknown as [string, string, (typeof kinds)[number]];
            const target = `img/${id}/${mode}-${kind}.png`;
            mkdirSync(path.join(dir, "img", id), { recursive: true });
            copyFileSync(file, path.join(dir, target));
            snapshots.set(mode, { ...snapshots.get(mode), mode, [kind]: target });
        }
        // Failed without a screenshot to show: the page or story did not render.
        if (![...snapshots.values()].some((snapshot) => snapshot.actual))
            return void this.errors.push({ id, message: stripAnsi(result.error?.message ?? "The test failed.") });
        for (const snapshot of snapshots.values()) {
            if (!snapshot.actual) continue;
            if (!this.baselines.has(`${id}/${snapshot.mode}.png`)) delete snapshot.expected;
            const actual = readPng(snapshot.actual);
            const expected = snapshot.expected ? readPng(snapshot.expected) : undefined;
            snapshot.width = actual.width / scale;
            snapshot.background = { actual: topLeft(actual), expected: expected && topLeft(expected) };
            if (!expected || expected.width !== actual.width || expected.height !== actual.height) continue;
            const layers = diffLayers(expected, actual);
            snapshot.changes = `img/${id}/${snapshot.mode}-changes.png`;
            snapshot.focus = `img/${id}/${snapshot.mode}-focus.png`;
            writeFileSync(path.join(dir, snapshot.changes), encode(layers.changes));
            writeFileSync(path.join(dir, snapshot.focus), encode(layers.focus));
        }
        const item = items.get(id);
        this.changed.push({
            id,
            title: item?.title ?? id,
            name: item?.name ?? "",
            snapshots: [...snapshots.values()].sort((a, b) => a.mode.localeCompare(b.mode)),
        });
    }

    onEnd() {
        const data = {
            name: manifest.name,
            showModes: manifest.showModes,
            base: manifest.base,
            head: manifest.head,
            labels: manifest.sourceType === "storybook" ? { group: "Components", item: "Stories" } : { group: "Pages", item: "Pages" },
            groups: this.groups.size,
            unchanged: this.unchanged,
            skipped: this.skipped,
            errors: this.errors,
            items: this.changed.sort((a, b) => a.title.localeCompare(b.title)),
        };
        writeReviewPage(dir, data);

        const isNew = (item: ChangedItem) => item.snapshots.every((snapshot) => !snapshot.expected);
        const summary: Summary = {
            changed: this.changed.filter((item) => !isNew(item)).length,
            new: this.changed.filter(isNew).length,
            unchanged: this.unchanged,
            skipped: this.skipped,
            errors: this.errors,
            notAffected: manifest.notAffected,
        };
        writeSummary(out, summary, { name: manifest.name, base: manifest.base.ref || manifest.base.sha, head: manifest.head.ref || manifest.head.sha });
    }

    // The CLI prints the outcome. Claiming stdio stops Playwright from adding its noisy default reporter.
    printsToStdio() {
        return true;
    }
}

// pngjs types ask for a PNG instance; the writer only reads width, height and data.
const encode = (image: Image) => PNG.sync.write(image as unknown as PNG);
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
const readPng = (file: string): Image => PNG.sync.read(readFileSync(path.join(dir, file)));
const topLeft = ({ data }: Image) => `rgb(${data[0]} ${data[1]} ${data[2]})`;
