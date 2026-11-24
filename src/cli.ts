#!/usr/bin/env node
import { parseArgs } from "node:util";
import { install, projectsIndex, review, run } from "./run.js";

const help = `opensnapshot: visual diff for Storybook and static sites

Usage:
  opensnapshot run [--base <ref>] [--config <file>] [--out <dir>] [--fail-on-changes]
      Build the base (merge base with <ref>, default origin/main) and the current code, screenshot both
      and write <out>/review/index.html with only what changed.
  opensnapshot review [--out <dir>] [--port <n>]
      Serve the last review page on http://localhost:<port>.
  opensnapshot index [--config <file>] [--out <dir>]
      Build a page that lists the config's "projects" with the latest summary of each (read from <url>/summary.json).
  opensnapshot install [--with-deps] [browser]
      Install the Playwright browser (default: chromium).

Run "opensnapshot run" from the folder that holds opensnapshot.config.ts.`;

async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === "--help" || command === "-h" || command === "help") return void console.log(help);
    if (command === "install") process.exit(install(rest));
    const { values } = parseArgs({
        args: rest,
        options: {
            config: { type: "string", short: "c" },
            base: { type: "string", short: "b" },
            out: { type: "string", short: "o" },
            port: { type: "string", short: "p" },
            "fail-on-changes": { type: "boolean" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values.help) return void console.log(help);
    const cwd = process.cwd();
    if (command === "run") process.exit(await run({ cwd, config: values.config, base: values.base, out: values.out, failOnChanges: values["fail-on-changes"] || undefined }));
    if (command === "review") return void (await review({ cwd, config: values.config, out: values.out, port: values.port ? Number(values.port) : undefined }));
    if (command === "index") return void (await projectsIndex({ cwd, config: values.config, out: values.out }));
    console.error(`Unknown command "${command}".\n\n${help}`);
    process.exit(2);
}

main().catch((error) => {
    console.error(`opensnapshot: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
