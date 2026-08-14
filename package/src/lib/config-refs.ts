import type { Config } from "../schemas/config.js";

/**
 * A group naming a top-level section that does not exist.
 *
 * @public
 */
export interface DanglingReference {
	/** The group holding the reference. */
	readonly group: string;
	/** Which reference array it sits in, as a config path. */
	readonly where: string;
	/** The name that resolves to nothing. */
	readonly name: string;
	/** What is actually defined, so the fix is visible without opening the file. */
	readonly defined: ReadonlyArray<string>;
}

/**
 * Every reference in `[groups.*]` that points at a section which is not defined.
 *
 * @remarks
 * **This was lost in the v4 rebuild and is restored here.** v3 registered a
 * `validateConfigRefs` callback on the config spec, so a dangling reference
 * failed the load for every command. The rebuild dropped it and nothing took
 * its place — while every phase kept skipping unresolvable references silently
 * and *citing that callback by name* as the thing that owned the check.
 *
 * The result was the worst shape available: `settings = ["defualt"]` synced
 * nothing, reported nothing, and `validate` printed `Valid:` and exited 0. The
 * same failure as a misspelled `--repo` passing green, which is fixed
 * elsewhere in this codebase for exactly the reason it matters here — a filter
 * or a reference that silently matches nothing turns a destructive command into
 * a no-op that looks like success.
 *
 * Checked where the reference is **used**, not where a section is defined: an
 * unreferenced `[settings.*]` section is dead config, not an error, and a
 * config may legitimately define sections some groups do not take.
 *
 * `defined` is carried on each finding so the report can show the near-misses.
 * Nearly every one of these is a typo, and a typo is fixed by seeing the
 * correct spelling rather than by being told the wrong one is wrong.
 *
 * @public
 */
export const danglingReferences = (config: Config): ReadonlyArray<DanglingReference> => {
	const found: Array<DanglingReference> = [];

	const sections = {
		settings: Object.keys(config.settings),
		rulesets: Object.keys(config.rulesets),
		environments: Object.keys(config.environments ?? {}),
		security: Object.keys(config.security ?? {}),
		code_scanning: Object.keys(config.code_scanning ?? {}),
		secrets: Object.keys(config.secrets),
		variables: Object.keys(config.variables),
	} as const;

	for (const [groupName, group] of Object.entries(config.groups)) {
		const check = (where: string, names: ReadonlyArray<string>, defined: ReadonlyArray<string>): void => {
			for (const name of names) {
				if (defined.includes(name)) continue;
				found.push({ group: groupName, where, name, defined });
			}
		};

		check(`groups.${groupName}.settings`, group.settings ?? [], sections.settings);
		check(`groups.${groupName}.rulesets`, group.rulesets ?? [], sections.rulesets);
		check(`groups.${groupName}.environments`, group.environments ?? [], sections.environments);
		check(`groups.${groupName}.security`, group.security ?? [], sections.security);
		check(`groups.${groupName}.code_scanning`, group.code_scanning ?? [], sections.code_scanning);

		for (const scope of ["actions", "dependabot", "codespaces"] as const) {
			check(`groups.${groupName}.secrets.${scope}`, group.secrets?.[scope] ?? [], sections.secrets);
		}
		check(`groups.${groupName}.variables.actions`, group.variables?.actions ?? [], sections.variables);

		// Environment-scoped assignments carry two references per entry — the
		// environment name keying the record, and the groups inside it — and
		// either can dangle independently.
		for (const [environment, names] of Object.entries(group.secrets?.environments ?? {})) {
			check(`groups.${groupName}.secrets.environments`, [environment], sections.environments);
			check(`groups.${groupName}.secrets.environments.${environment}`, names, sections.secrets);
		}
		for (const [environment, names] of Object.entries(group.variables?.environments ?? {})) {
			check(`groups.${groupName}.variables.environments`, [environment], sections.environments);
			check(`groups.${groupName}.variables.environments.${environment}`, names, sections.variables);
		}
	}

	return found;
};
