#!/usr/bin/env node

/**
 * The `reposets` bin.
 *
 * @remarks
 * The workspace root links this package through `reposets: workspace:*`, so
 * `node_modules/.bin/reposets` runs this file from source, and source imports
 * name `.js` siblings that exist only as `.ts`. A pnpm script gets no loader
 * for that and neither does a bare shell, so a source run registers tsx here,
 * before anything resolves a sibling. A built `.js` bin never takes the
 * branch. The specifier is computed because rolldown would otherwise inline a
 * literal into the published package, and tsx is the workspace root's alone.
 * Every other import is dynamic, since a static one would resolve before the
 * branch runs. The program itself, and every `process` read, stays in
 * `./index.ts`.
 */
if (import.meta.url.endsWith(".ts")) {
	const tsx = ["tsx", "esm", "api"].join("/");
	const { register } = (await import(tsx)) as { readonly register: () => void };
	register();
}

await import("./index.js");
