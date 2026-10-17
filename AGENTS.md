# ren-core

Standing rules for agents working in this checkout.

Read the workspace layer first: [`../../../AGENTS.md`](https://github.com/wiltonlazary/rui/blob/main/AGENTS.md) and [`../../../.ai/config/`](https://github.com/wiltonlazary/rui/tree/main/.ai/config)
(javascript.md, design.md, benchmarks.md, concepts.md, resources.md,
stability.md, git.md).
Then read [README.md](README.md) for the API, the Host contract, worker
mode, application roots and benchmarks, and [TODO.md](TODO.md) for open
work.

## What this is

ren-core is the renderer-neutral component layer, a production library packaged
as the `ren-core` package: JSX (runtime and the `ren-core/esbuild` template compiler),
control flow, portable primitives, application roots, contexts, background
disposal, the worker runtime (`ren-core/worker`, `ren-core/remote`) and the `Host`
contract (`ren-core/host`) that renderers implement. The renderers are sibling
projects: ren-dom ($dom, $shadow), ren-canv (the drawn renderers' engine),
ren-skia (CanvasKit), ren-three (three.js), ren-html (HTML once) and
ren-json (data once). ren-core imports none of them; its own tests run on an in-memory
Host. Its one runtime dependency is rrx-core, the reactive core, linked from the
sibling checkout [`../../../rrx-core/wtree/_repo_`](https://github.com/wiltonlazary/rrx-core)
(`"rrx-core": "file:../../../rrx-core/wtree/_repo_"`).

## Layout and outputs

- Checkout: `wtree/_repo_` (branch `main`); feature branches are sibling
  worktrees under `wtree/<name>`, each with its own build directory
  `build/<name>_<version>` and its own `artifact` link to it.
- Build output: `build/_repo__0.1.7`, reached through the ignored `artifact`
  link for library scratch (`artifact/tmp/<task>/`). Benchmark bundles and
  Chrome profiles belong to ren-bench's artifact directory.
- `types/` is generated (`scripts/types.mjs`) and ignored; the package's
  `exports` point at it.

## Project specifics

- ren-core consumes rrx-core's public entries only (`rrx-core`, `rrx-core/core`, `rrx-core/context`).
  When ren-core needs something new from rrx-core, change rrx-core in its own checkout,
  with rrx-core's tests, rather than reaching into its files.
  To move to a registry version, replace the link with `"rrx-core": "npm:@maxenve/rrx-core@0.1.7"` and
  reinstall.
- Install rrx-core first: ren-core's `tsc` reads rrx-core's generated declarations.
- A change to ren-core (above all to the Host contract, `mount`, `skeleton` or
  the worker runtime) is finished once `npm test` passes in ren-dom,
  ren-canv, ren-skia, ren-three, ren-html, ren-json, rui-core and ren-show
  too. ren-core never imports a renderer
  package; ren-bench's UI suite reaches ren-dom and ren-skia through its own
  `package.json` and public package entries.
- The TypeScript consumers in `test/types/` compile with
  `jsxImportSource: "ren-core"`.
- Keep batching, lanes and QoS (overtaking, answers behind a held message,
  the shared mailbox) measured in [ren-bench's UI suite](https://github.com/wiltonlazary/ren-bench/blob/main/bench/ui/README.md).
- Keep isolation between roots exactly as README §Application roots states.
