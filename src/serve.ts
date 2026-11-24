import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
    ".map": "application/json", ".wasm": "application/wasm", ".mp4": "video/mp4", ".webm": "video/webm",
};

/** Maps a request path to a file below `root`, or undefined if it escapes or does not exist. */
export function resolveFile(root: string, urlPath: string): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
    } catch {
        return undefined;
    }
    const file = path.resolve(root, "." + path.posix.normalize("/" + decoded));
    if (file !== root && !file.startsWith(root + path.sep)) return undefined;
    try {
        const stat = statSync(file);
        if (stat.isFile()) return file;
        if (stat.isDirectory()) return resolveFile(root, path.posix.join(decoded, "index.html"));
    } catch {}
    return undefined;
}

/** Serves a folder over HTTP on 127.0.0.1. */
export function serve(root: string, port: number): Promise<Server> {
    const base = path.resolve(root);
    const server = createServer((request, response) => {
        const file = resolveFile(base, request.url ?? "/");
        if (!file) {
            response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
            return;
        }
        response.writeHead(200, { "content-type": types[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
        createReadStream(file).pipe(response);
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server));
    });
}

export const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
