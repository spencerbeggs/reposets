import { Effect } from "effect";
import type { Phase } from "../phase.js";
import { cleanupPhase } from "./cleanup.js";
import { codeScanningPhase } from "./code-scanning.js";
import { environmentsPhase } from "./environments.js";
import { rulesetsPhase } from "./rulesets.js";
import { secretsPhase } from "./secrets.js";
import { securityPhase } from "./security.js";
import { settingsPhase } from "./settings.js";
import { variablesPhase } from "./variables.js";

export { cleanupPhase } from "./cleanup.js";
export { codeScanningPhase } from "./code-scanning.js";
export { environmentsPhase } from "./environments.js";
export { capture, declaredNames, resolveGroups } from "./resource.js";
export { rulesetsPhase } from "./rulesets.js";
export { secretsPhase } from "./secrets.js";
export { securityPhase } from "./security.js";
export { settingsPhase } from "./settings.js";
export { variablesPhase } from "./variables.js";

/**
 * Every phase, in `PHASE_NAMES` order.
 *
 * @remarks
 * The order is the contract, not a preference — environments exist before the
 * secrets scoped to them — so the array is built in that order here rather than
 * sorted later. `SyncEngineLive` takes this and walks it.
 *
 * `cleanup` runs last because every other phase's writes are what define
 * "declared" — sweeping before them would delete a resource this very run was
 * about to create.
 *
 * @public
 */
export const allPhases: Effect.Effect<
	ReadonlyArray<Phase>,
	never,
	Effect.Services<
		| typeof settingsPhase
		| typeof securityPhase
		| typeof codeScanningPhase
		| typeof environmentsPhase
		| typeof variablesPhase
		| typeof secretsPhase
		| typeof rulesetsPhase
		| typeof cleanupPhase
	>
> = Effect.all([
	settingsPhase,
	securityPhase,
	codeScanningPhase,
	environmentsPhase,
	secretsPhase,
	variablesPhase,
	rulesetsPhase,
	cleanupPhase,
]);
