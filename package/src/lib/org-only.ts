import type { Config } from "../schemas/config.js";
import type { Credentials } from "../schemas/credentials.js";
import { profileOwner } from "../schemas/credentials.js";

/**
 * A group asking for something its owner cannot have.
 *
 * @public
 */
export interface OrgOnlyViolation {
	/** The group whose profile is a personal account. */
	readonly group: string;
	/** The profile it names, so the fix is one lookup away. */
	readonly profile: string;
	/** Where the offending value lives, as a config path. */
	readonly where: string;
	/** What GitHub requires an organization for. */
	readonly detail: string;
}

/**
 * Organization-only constructs assigned to personal-account groups.
 *
 * @remarks
 * **The whole point of declaring `username` or `org` on a profile.** Every check
 * here previously needed the owner's type, and the only way to learn it was to
 * ask GitHub — so `validate`, whose entire contract is that it touches no
 * network, could not make them at all. They surfaced as a 422 mid-sync instead,
 * after earlier repositories had already been written.
 *
 * Three constructs need an organization, and each is checked where it is
 * *referenced* rather than where it is defined: a ruleset with a team bypass
 * actor is perfectly valid sitting in `[rulesets.*]`, and only becomes an error
 * when a personal-account group assigns it. Reporting the definition would name
 * a section the user may share between groups and would have to leave alone.
 *
 * This does not replace the check against GitHub. A declaration can be wrong,
 * so `sync` still verifies the owner's type before writing; this catches the
 * config error earlier and without a token.
 *
 * @public
 */
export const orgOnlyViolations = (config: Config, credentials: Credentials): ReadonlyArray<OrgOnlyViolation> => {
	const violations: Array<OrgOnlyViolation> = [];

	for (const [groupName, group] of Object.entries(config.groups)) {
		const profile = credentials.profiles[group.credentials];
		// An unknown profile is a different error, reported by whoever resolves
		// it. Guessing an owner type here would invent a second diagnosis for one
		// mistake.
		if (profile === undefined) continue;
		if (profileOwner(profile).ownerType !== "User") continue;

		const add = (where: string, detail: string): void => {
			violations.push({ group: groupName, profile: group.credentials, where, detail });
		};

		for (const name of group.settings ?? []) {
			const settings = config.settings[name];
			if (settings === undefined) continue;
			if (settings.secret_scanning_delegated_bypass !== undefined) {
				add(`settings.${name}.secret_scanning_delegated_bypass`, "delegated bypass requires an organization");
			}
			if (settings.delegated_bypass_reviewers !== undefined) {
				add(`settings.${name}.delegated_bypass_reviewers`, "bypass reviewers require an organization");
			}
		}

		for (const name of group.rulesets ?? []) {
			const ruleset = config.rulesets[name];
			if (ruleset === undefined) continue;
			for (const actor of ruleset.bypass_actors ?? []) {
				if (actor.actor_type === "Team") {
					add(`rulesets.${name}.bypass_actors`, "a Team bypass actor requires an organization");
				}
			}
		}

		for (const name of group.environments ?? []) {
			const environment = config.environments?.[name];
			if (environment === undefined) continue;
			for (const reviewer of environment.reviewers ?? []) {
				if (reviewer.type === "Team") {
					add(`environments.${name}.reviewers`, "a Team reviewer requires an organization");
				}
			}
		}
	}

	return violations;
};
