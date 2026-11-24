import type { Mode } from "./config.js";
import type { Item } from "./items.js";

/** Written by `run`, read by the Playwright spec and the reporter. */
export type Manifest = {
    name?: string;
    /** False when the config sets no modes: the review page hides the mode. */
    showModes: boolean;
    sourceType: "storybook" | "urls";
    items: Item[];
    modes: Record<string, Mode>;
    base: { sha: string; ref: string };
    head: { sha: string; ref: string };
};

export type Snapshot = {
    mode: string;
    /** Shot width in CSS pixels; the files are captured at the device scale factor. */
    width?: number;
    expected?: string;
    actual?: string;
    diff?: string;
    changes?: string;
    focus?: string;
    /** Top-left pixel of each shot, used to fill the canvas around it. */
    background?: { expected?: string; actual?: string };
};

export type ChangedItem = { id: string; title: string; name: string; snapshots: Snapshot[] };
export type Summary = {
    changed: number;
    new: number;
    unchanged: number;
    skipped: number;
    errors: { id: string; message: string }[];
};
