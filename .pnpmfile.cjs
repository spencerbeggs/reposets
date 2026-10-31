/**
 * Temporary bridge for the Effect 4.1 upgrade.
 *
 * The build toolchain (`@savvy-web/*`, okfit, vitest-agent) still loads
 * published `@effected/*` packages built on Effect 4.0.x, which import
 * `Crypto` from the `effect` root — removed in 4.1. Under the catalog
 * plugin's graph-wide `effect` override they would bind `effect@4.1.1` and
 * die at import. This hook runs them, and the tools that load them, on the
 * effect they were built on, through npm aliases the override cannot rewrite.
 *
 * Remove this file once every tool below has republished on an `@effected`
 * release built on Effect 4.1; then no lockfile `packages:` entry names
 * `effect@4.0.7`.
 */
const BRIDGED = "4.0.7";
const TOOLCHAIN = ["@savvy-web/", "@okfit/", "@tsdoctor/", "@vitest-agent/", "rolldown-pnpm-config"];
/** This repository's own workspace packages, which must stay on the catalog's effect. */
const WORKSPACE = new Set(["reposets", "@spencerbeggs/reposets"]);

const isEffectLine = (name, spec) =>
	(name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());

const reachesKit = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
	);

/**
 * Whether a package declares `effect` on the 4.0 line. The kit release this
 * repository ships on (`effect: ~4.1.0`) must not be bridged, only the
 * published 4.0.x kit the toolchain pulls in.
 */
const builtOnBridged = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		/^[\^~=]*4\.0\./.test(String(deps?.effect ?? "").trim()),
	);

function readPackage(pkg) {
	if (pkg.private === true || !pkg.name || WORKSPACE.has(pkg.name)) return pkg;
	const bridged =
		(pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version)) ||
		TOOLCHAIN.some((p) => pkg.name.startsWith(p)) ||
		((pkg.name.startsWith("@effected/") || reachesKit(pkg)) && builtOnBridged(pkg));
	if (!bridged) return pkg;
	const pinned = {};
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const name of Object.keys(pkg[field] ?? {})) {
			if (!isEffectLine(name, pkg[field][name])) continue;
			delete pkg[field][name];
			pinned[name] = `npm:${name}@${BRIDGED}`;
		}
	}
	if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
	return pkg;
}

module.exports = { hooks: { readPackage } };
