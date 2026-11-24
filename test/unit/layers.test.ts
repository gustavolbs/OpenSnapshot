import { describe, expect, it } from "vitest";
import { boxes, diffLayers, grow, type Image } from "../../src/layers.js";

const solid = (width: number, height: number, rgb = [255, 255, 255]): Image => {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
    return { width, height, data };
};
const paint = (image: Image, x: number, y: number, rgb: number[]) => image.data.set([...rgb, 255], (y * image.width + x) * 4);
const alphaAt = (image: Image, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3];

describe("diffLayers", () => {
    it("reports nothing for identical shots", () => {
        expect(diffLayers(solid(20, 20), solid(20, 20)).changedPixels).toBe(0);
    });

    it("marks the changed pixel green and opens a focus box around it", () => {
        const actual = solid(60, 60);
        paint(actual, 30, 30, [0, 0, 0]);
        const { changes, focus, changedPixels } = diffLayers(solid(60, 60), actual);
        expect(changedPixels).toBe(1);
        const i = (30 * 60 + 30) * 4;
        expect([...changes.data.subarray(i, i + 4)]).toEqual([55, 255, 20, 255]);
        expect(changes.data[0 * 4 + 3]).toBe(0);
        expect(alphaAt(focus, 30, 30)).toBe(0); // clear inside the box
        expect(alphaAt(focus, 22, 30)).toBe(0); // padded by 10 px
        expect(alphaAt(focus, 5, 5)).toBe(190); // dimmed outside
    });
});

describe("grow and boxes", () => {
    it("grows a mask by n pixels and finds one box per region", () => {
        const mask = new Uint8Array(100 * 10);
        mask[5 * 100 + 10] = 1;
        mask[5 * 100 + 90] = 1;
        expect(boxes(mask, 100, 10)).toHaveLength(2);
        const grown = grow(mask, 100, 10, 2);
        expect(boxes(grown, 100, 10)).toEqual([
            { x0: 8, y0: 3, x1: 12, y1: 7 },
            { x0: 88, y0: 3, x1: 92, y1: 7 },
        ]);
    });
});
