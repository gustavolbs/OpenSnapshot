# OpenSnapshot

Visual diff for Storybook and static sites. It builds your base branch and your change, screenshots both with Playwright, and writes a static review page that shows **only what changed**: expected, actual and a diff overlay, side by side.

No account, no hosted service, no baseline files in git. The baseline is rebuilt from the merge base on every run, on the same machine that renders the change, so font and engine differences cancel out.

## Quick start (local)

You need Node 20.11 or later, git, and the history of the branch you compare with.

```bash
pnpm add -D opensnapshot        # or run it without installing: pnpm dlx opensnapshot run
pnpm exec opensnapshot install  # downloads Chromium once
```

The package is not on npm yet. Until it is, clone this repository, run `pnpm install && pnpm build`, and call `node /path/to/OpenSnapshot/dist/cli.js` from your project; a config that imports `opensnapshot` still resolves.

Add `opensnapshot.config.ts` next to your `package.json`. For Storybook:

```ts
import { defineConfig } from "opensnapshot";

export default defineConfig({
    build: { command: "pnpm storybook build -o storybook-static", output: "storybook-static" },
    source: { type: "storybook" },
    modes: {
        light: { viewport: 1200 },
        dark: { viewport: 1200, globals: { theme: "dark" } },
        mobile: { viewport: { width: 390, height: 800 } },
    },
});
```

For any static site (a built folder, or plain HTML):

```ts
export default defineConfig({
    build: { command: "pnpm build", output: "dist" }, // omit `command` to serve `output` as it is
    source: { type: "urls", pages: ["/", "/pricing/", { name: "docs", path: "/docs/intro.html" }] },
});
```

Then run it from a branch with your change:

```bash
pnpm exec opensnapshot run                 # compares with origin/main
pnpm exec opensnapshot run --base origin/develop
pnpm exec opensnapshot review              # serves .opensnapshot/review on http://localhost:6106
```

Open `.opensnapshot/review/index.html`. Add `.opensnapshot` to your `.gitignore`. Uncommitted changes in your working tree are part of the head build, so you can check an edit before you commit it.

## What `run` does

1. Finds the merge base of `--base` (default `origin/main`) and `HEAD`.
2. Builds the current code (`build.command`), and lists the stories (from `index.json`) or the pages you configured.
3. Checks out the merge base into `.opensnapshot/base-src` (a temporary git worktree), installs and builds it there, copies the output, and removes the worktree.
4. **Base pass:** serves the base build and records a Playwright baseline with `toHaveScreenshot` for every item and mode.
5. **Head pass:** serves the current build and compares against that baseline.
6. Writes `.opensnapshot/review/index.html` with the changed items only, plus `summary.json` and `summary.md`.

An item that does not exist in the base (a new story or page) is listed as **new**. An item that cannot render is listed as an **error**, and the command exits with code 1.

## CI (GitHub Actions)

The repository ships a composite action. Copy [`examples/github-workflow.yml`](examples/github-workflow.yml) to `.github/workflows/visual-diff.yml`:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0 # the merge base needs the history
- uses: pnpm/action-setup@v6
- uses: actions/setup-node@v7
  with: { node-version: 22, cache: pnpm }
- run: pnpm install --frozen-lockfile
- uses: gustavolbs/OpenSnapshot@main # pin a commit SHA in real use
  with:
    comment: true # optional, off by default
```

The action fetches missing history, caches the Playwright browser per Playwright version, runs `opensnapshot run --base origin/<PR base branch>`, writes the summary to the job summary, and uploads `review/` as an artifact (14 days). With `comment: true` it also creates or updates one comment on the pull request with the counts and a link to the artifact; give the job `pull-requests: write` for that. Download and unzip the artifact, then open `index.html`.

| Input | Default | Meaning |
| --- | --- | --- |
| `working-directory` | `.` | Folder with `opensnapshot.config.ts`. |
| `base-ref` | `origin/<PR base>` or `origin/main` | Ref to compare with. |
| `config` | | Config path, if it has another name. |
| `fail-on-changes` | `false` | Fail the step when something changed. |
| `comment` | `false` | Post or update the pull request comment. |
| `artifact-name` / `retention-days` | `opensnapshot-review` / `14` | Artifact settings. |

Outputs: `changed`, `new`, `errors`, `artifact-url`. Any other CI works too: run `pnpm exec opensnapshot install --with-deps` and `pnpm exec opensnapshot run`, keep `.opensnapshot/review` as a build artifact, and make sure the clone has full history.

## Config reference

`opensnapshot.config.ts` (also `.mts`, `.js`, `.mjs`); `defineConfig` is optional and only adds types.

| Option | Default | Meaning |
| --- | --- | --- |
| `build.output` | required | Folder to serve, relative to the config. |
| `build.command` | none | Builds the site. Runs for the head in the project and for the base in the temporary checkout. |
| `install` | from the lockfile | Install command for the base checkout (`pnpm install --frozen-lockfile`, `yarn install --immutable`, `npm ci`). `false` skips it. |
| `source` | required | `{ type: "storybook", include?, exclude? }` or `{ type: "urls", pages }`. |
| `modes` | `{ default: { viewport: 1200 } }` | Named renderings. Each item is shot once per mode. |
| `baseRef` | `origin/main` | Ref to compare with. `--base` overrides it. |
| `deviceScaleFactor` | `2` | Screenshot scale. |
| `threshold` | `0.2` | Per-pixel color distance (0 to 1), as in Playwright. |
| `maxDiffPixelRatio` | `0` | Share of pixels allowed to differ (0 to 1). |
| `outDir` | `.opensnapshot` | Work folder. `run` deletes it first, so it must be a subfolder of the project. |
| `port` | `6106` | Local port of the static server. |
| `failOnChanges` | `false` | Exit 1 when something changed. Errors always exit 1. |

A mode is `{ viewport?: number | { width, height? }, colorScheme?: "light" | "dark", globals?: Record<string, string> }`. `globals` goes to Storybook as `&globals=key:value;key:value`.

`pages` entries are paths served from `build.output`, or `{ name, path }`. A page that answers 404 in the base build counts as new.

**Storybook:** stories come from `index.json` (Storybook 7 and later). `include` and `exclude` are regular expressions tested against story ids. A story can opt out or wait before the shot:

```ts
export const Animated = { parameters: { opensnapshot: { disable: false, delay: 300 } } };
// parameters: { opensnapshot: { disable: true } } skips the story.
```

**Deterministic rendering:** fixed viewport per mode, CSS animations and transitions disabled, caret hidden, fonts awaited (`document.fonts.ready`), `en-US` locale, UTC time zone, service workers blocked, and Chromium flags for stable font rendering (`--font-render-hinting=none`, `--disable-lcd-text`, `--force-color-profile=srgb`). Both passes run on the same machine, so the remaining noise is yours: random data, clocks and remote images. Mock them, or use a story `delay`.

## How it differs from Chromatic

| | OpenSnapshot | Chromatic |
| --- | --- | --- |
| Where it runs | Your machine or your CI runner | Their cloud |
| Baselines | Rebuilt from the merge base each run | Stored and accepted per branch |
| Review page | Static folder, artifact per run | Hosted app with history |
| Approval workflow | None: you read the page | Accept or deny, with status checks |
| Cross-browser | Chromium only | Several browsers |
| Cost | Your CI minutes | Per-snapshot plans |
| Change detection | Screenshots every item you list | TurboSnap skips unaffected stories |

OpenSnapshot is for teams that want a visual diff on every pull request without a service. It is not a review workflow: it does not block merges and has no approval state.

## Limits

- Chromium only, one engine, one operating system per run. Do not mix local and CI baselines; there are none to mix.
- Static output only. A site that needs a running server (SSR without export) must be exported first. Pages are served from the built folder at `127.0.0.1`.
- Every listed item is shot twice on every run. There is **no affected-story tracing**: tracing which stories a change can reach depends on bundler statistics (webpack stats and a dependency tracer) and does not generalize cleanly across Vite, webpack and plain sites. Use `include` and `exclude`, or a smaller `modes` list, to keep runs short.
- The base build runs a full install and build in a checkout of the merge base. Large monorepos pay for that on every run.
- The Storybook path reads `window.__STORYBOOK_PREVIEW__`, an internal Storybook API. It has been exercised against Storybook 10 (`@storybook/html-vite`) and a stand-in preview, not against every Storybook version or framework.
- The composite action runs on Linux runners (the browser cache path is Linux's).
- Review page images are full-size PNGs at the device scale factor; many items and modes make a large artifact.

## Development

```bash
pnpm install
pnpm test        # unit tests (vitest)
pnpm test:e2e    # builds, then runs the CLI on fixtures in temporary git repos (needs Chromium)
pnpm typecheck
```

`pnpm test:e2e` proves the main promise: on a two-page site, changing one element makes only that page show up in the review page; a new page shows as new; a change that does not render shows nothing.

The review page layout is inspired by hosted visual-review tools. Its icons come from `@storybook/icons` (MIT).

## License

MIT, see [LICENSE](LICENSE).
