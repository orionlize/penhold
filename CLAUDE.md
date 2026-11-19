# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

penhold-mcp is a local AI design canvas. An AI draws and reads UI mockups through MCP tools, the user fine-tunes them in a browser canvas, and the result exports as single-file HTML. The repo's docs and code comments are in Chinese. `README.md` is the user-facing introduction (install, client setup, commands, environment variables). `docs/DEVELOPMENT.md` is the detailed source of truth for behavior and conventions (tools, design systems, proto, annotations, code layout), and `docs/PRD.md` holds the original design. Read the relevant `docs/DEVELOPMENT.md` section before changing a feature, and update it (or the README, for user-visible install and config changes) along with the code.

## Commands

```bash
npm install
npm run build          # tsc → dist/server  +  vite → dist/web
npm run typecheck      # server (tsconfig.json) and web (web/tsconfig.json)
npm test               # node:test via tsx, test/*.test.ts
node --import tsx --test test/canvas.test.ts                          # single file
node --import tsx --test --test-name-pattern="log replay" test/*.test.ts   # single test
npm run daemon         # run the daemon in the foreground from source (tsx)
```

- The daemon serves the canvas UI from `dist/web`, so canvas UI changes need `npm run build:web` (or `npm run build`) before they show up. `dev:web` is a bare Vite server with no proxy to the daemon API.
- After a rebuild, the proxy (or `penhold-mcp open`) sees a newer build ID and restarts the running daemon automatically.
- Dev scripts are run with tsx: `npx tsx scripts/open.ts` creates a canvas, and `npx tsx scripts/call.ts <canvasId> <tool> '<json>' [out.png]` calls one MCP tool against it. `scripts/e2e-*.ts` are end-to-end demos.
- Tests isolate state by setting `DESIGN_MCP_HOME` to a temp dir **before** dynamically importing modules (see the top of `test/canvas.test.ts`). Follow the same pattern, because `src/server/paths.ts` resolves the data directory at import time.

## Architecture

**Process model:** `src/cli.ts` dispatches subcommands. The default `mcp` subcommand runs `src/proxy.ts`, a thin stdio proxy that starts (or reuses) a long-lived daemon and forwards MCP over `/ws/proxy`, replaying the handshake if the daemon restarts. `src/server/daemon.ts` is a plain Node `http` + `ws` server bound to 127.0.0.1 that serves:
- `/mcp`: Streamable HTTP. This route and `/ws/proxy` need the bearer token stored in `~/.penhold/token`.
- `/ws`: the canvas page socket.
- `/api/*`: management and design-system APIs.
- The SPA from `dist/web`: `/c/<canvasId>` for canvases and `/s/<systemId>` for the design-system editor.

Runtime data lives in `~/.penhold` (`DESIGN_MCP_HOME`).

**Single writer:** `src/server/canvas/canvas.ts` (`Canvas`) is the only place that mutates a design doc. It validates, applies ops, bumps `rev`, broadcasts to browsers, appends to a log, and persists `design.json`. It also owns the AI edit lock and the self-check bookkeeping (`pendingCheck`, `markChecked`). The lock is released only after every frame the AI touched has been screenshotted, plus the planned-page and interaction-state rules described in `docs/DEVELOPMENT.md`. `src/server/canvas/registry.ts` maps canvases, aliases, and host sessions to `Canvas` instances.

**Shared core (`src/core/`):** compiled into the server and also included by the web tsconfig, so it must stay DOM- and Node-agnostic.
- `doc.ts`: `applyOps` returns inverse ops, which undo relies on.
- `edit.ts`: turns high-level edits into ops and enforces what users may change (box model and style) versus what only the AI may change (structure, order, layout).
- `render.ts`: renders the node tree to HTML/CSS for both the canvas and exports.
- `schema.ts`: input validation.
- `proto.ts` / `protoEngine.ts`: the interaction expression language and runtime.
- `states.ts`: explores interaction states for screenshot checks.
- `designSystem.ts`, `designLint.ts`, `lintFix.ts` (the safe auto-fixes behind `design_lint_fix`).
- `jsx.ts`: the JSX spelling of nodes used by `node_insert` / `node_replace` / `design_read`. It parses to Node JSON and never executes code.
- `mermaid.ts`: parses and lays out the Mermaid flowchart subset used by `design_annotate`'s `flow`.

The source of truth is the abstract node tree with stable ids; HTML is only a view of it.

**Screenshots happen in the browser:** `design_screenshot` sends a `shot` or `probe` message over WS to the open canvas page, which renders and checks inside iframes (`web/src/lib/frames.ts`, `web/src/editor/Viewport.tsx`) and replies with a PNG plus a report. Write tools wait for a canvas page to connect (`DESIGN_MCP_BROWSER_TIMEOUT_MS`).

**MCP surface:** all tools and the server instructions live in `src/server/mcp.ts`. `daemon.ts`, `paths.ts` and `browser.ts` sit beside it, and the rest of `src/server/` is grouped by area:
- `canvas/`: the document engine (`canvas.ts`), the canvas registry, annotations and asset storage.
- `design/`: everything that supplies design direction, namely the questionnaire (`brief.ts`), direction cards, product-type presets (data in `guides/catalog.json`), local guide discovery, page-type snippets (`guides/pages/`), design systems and their API, font detection and Openverse image search.
- `export/`: HTML and zip export.

**Web UI (`web/src/`):** React 19 + zustand. `store.ts`, `i18n.ts`, `theme.ts`, `locales/` and `main.tsx` stay at the root; the rest is grouped:
- `pages/`: the home page and the design-system list and editor.
- `editor/`: the canvas (`Editor.tsx`, `Viewport.tsx`), toolbar, layer tree, annotations, AI cursor, prototype player and Tweaks.
- `inspector/`: the property panel and its field controls.
- `lib/`: non-UI helpers such as iframe rendering and in-page checks (`frames.ts`), geometry, frame export, PDF and icons.

## Invariants and gotchas

- **i18n:** add every new UI string to `web/src/locales/zh.ts` first (it defines the key set), then to `en.ts`, or typecheck fails.
- **`createProtoEngine` in `src/core/protoEngine.ts` must stay self-contained** (no references to module-scope values). Its source is inlined into exported HTML, and a test evaluates the inlined copy on its own.
- **Generated data:** `guides/examples/*.json` comes from `scripts/build-examples.ts` (edit the script, not the JSON), and `guides/catalog.json` comes from `scripts/import-presets.ts`.
- **New page type:** add `guides/pages/<type>.md` and register its matcher in `TYPES` in `src/server/design/pageGuides.ts`.
- **Annotations** (`annotations.json`) are kept out of the design doc, exports, and the undo stack. AI annotations carry `by:"ai"`, and the AI may only modify its own.
- **Token references:** written as `{color.primary}` and rendered as `var(--color-primary)`. They may also be embedded inside gradient, shadow, and color values.

## Website (`website/`)

A separate Next.js (App Router) static site with its own `package.json` and lockfile. Run `cd website && npm install && npm run dev` / `npm run build`. Docs pages live under `app/docs/<slug>/page.tsx` and are registered in `app/docs/nav.ts`. Shared links are in `app/site.ts`.

Deployment is through Vercel project `website` (team `duck-4bf0`, root directory `website`): pushing a branch creates a preview, and `main` deploys to production. `next.config.ts` pins `turbopack.root` so Next doesn't mistake the repo's `src/proxy.ts` for middleware.
