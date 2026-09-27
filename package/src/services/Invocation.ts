import { Context, Layer } from "effect";

/**
 * The facts about this process a command needs, read once at the entrypoint.
 *
 * @remarks
 * Only the CLI entrypoint (`src/cli/index.ts`) reads `process`. Everything
 * below it receives the working directory and the build's version through this
 * service instead, so a handler can be driven by a test that hands it a
 * different directory without `process.chdir`.
 *
 * The environment is deliberately NOT here. Environment variables are read
 * through Effect's `Config`, which resolves them from the ambient
 * `ConfigProvider` — the process environment by default, an explicit record
 * under `ConfigProvider.layer` in a test. That is core's own seam for the
 * environment, and `@effected/xdg` already reads `HOME` and `XDG_*` through it;
 * a second, hand-rolled one here would let the two disagree.
 *
 * The whole shape is one immutable value with no behaviour, so `Layer.succeed`
 * is the complete double — there is nothing for a partial mock to stub. The
 * moment a method appears here it stops being a value and becomes a service.
 *
 * @public
 */
export class Invocation extends Context.Service<
	Invocation,
	{
		/** The directory the command was run from. */
		readonly cwd: string;
		/** The build's version, substituted by the bundler at build time. */
		readonly version: string;
	}
>()("reposets/Invocation") {
	/**
	 * A fixed invocation, for tests and for the entrypoint alike.
	 *
	 * @remarks
	 * Each call mints a fresh layer; bind the result to a `const` rather than
	 * calling this at more than one provide site.
	 */
	static readonly layer = (value: Context.Service.Shape<typeof Invocation>): Layer.Layer<Invocation> =>
		Layer.succeed(this, value);
}
