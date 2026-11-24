export type Image = { width: number; height: number; data: Buffer };

/**
 * Overlay layers for two shots of the same size. `changes` paints every pixel that differs in
 * rgb(55 255 20). `focus` is black at alpha 190 with a clear rounded box over each group of
 * changes, padded by 10 px.
 */
export function diffLayers(expected: Image, actual: Image): { changes: Image; focus: Image; changedPixels: number } {
    const { width, height } = actual;
    const mask = new Uint8Array(width * height);
    const changes: Image = { width, height, data: Buffer.alloc(width * height * 4) };
    let changedPixels = 0;
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
        if (
            expected.data[i] === actual.data[i] &&
            expected.data[i + 1] === actual.data[i + 1] &&
            expected.data[i + 2] === actual.data[i + 2] &&
            expected.data[i + 3] === actual.data[i + 3]
        )
            continue;
        mask[p] = 1;
        changedPixels++;
        changes.data.set([55, 255, 20, 255], i);
    }

    const radius = 3;
    const focus: Image = { width, height, data: Buffer.alloc(width * height * 4) };
    for (let i = 3; i < focus.data.length; i += 4) focus.data[i] = 190;
    for (const box of boxes(grow(mask, width, height, 10), width, height))
        for (let y = box.y0; y <= box.y1; y++)
            for (let x = box.x0; x <= box.x1; x++) {
                const dx = Math.max(box.x0 + radius - x, x - (box.x1 - radius), 0);
                const dy = Math.max(box.y0 + radius - y, y - (box.y1 - radius), 0);
                if (dx * dx + dy * dy <= radius * radius) focus.data[(y * width + x) * 4 + 3] = 0;
            }
    return { changes, focus, changedPixels };
}

/** Square dilation by `by` pixels, done as two sliding-window passes. */
export function grow(mask: Uint8Array, width: number, height: number, by: number): Uint8Array {
    const pass = (source: Uint8Array, length: number, lines: number, at: (line: number, k: number) => number) => {
        const target = new Uint8Array(source.length);
        for (let line = 0; line < lines; line++) {
            let count = 0;
            for (let k = 0; k < by && k < length; k++) count += source[at(line, k)]!;
            for (let k = 0; k < length; k++) {
                if (k + by < length) count += source[at(line, k + by)]!;
                if (k - by - 1 >= 0) count -= source[at(line, k - by - 1)]!;
                if (count) target[at(line, k)] = 1;
            }
        }
        return target;
    };
    const rows = pass(mask, width, height, (y, x) => y * width + x);
    return pass(rows, height, width, (x, y) => y * width + x);
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Bounding boxes of the connected regions in `mask`. */
export function boxes(mask: Uint8Array, width: number, height: number): Box[] {
    const seen = new Uint8Array(mask.length);
    const found: Box[] = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        const box = { x0: width, y0: height, x1: 0, y1: 0 };
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const p = stack.pop()!;
            const x = p % width;
            const y = (p - x) / width;
            box.x0 = Math.min(box.x0, x);
            box.x1 = Math.max(box.x1, x);
            box.y0 = Math.min(box.y0, y);
            box.y1 = Math.max(box.y1, y);
            for (const [n, ok] of [
                [p - 1, x > 0],
                [p + 1, x < width - 1],
                [p - width, y > 0],
                [p + width, y < height - 1],
            ] as const)
                if (ok && mask[n] && !seen[n]) {
                    seen[n] = 1;
                    stack.push(n);
                }
        }
        found.push(box);
    }
    return found;
}
