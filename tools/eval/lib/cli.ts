/**
 * Tiny argument parser shared by the three `tools/eval` commands: `--flag`
 * booleans, `--name value` options, and `--help`. No dependency.
 */

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
}

/** Splits `process.argv.slice(2)` into flags and `--name value` options. */
export function parseArgs(argv: readonly string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  return { flags, values };
}

/** True when the flag is present. */
export function hasFlag(args: Args, name: string): boolean {
  return args.flags.has(name);
}

/** Option value, or the fallback when absent. */
export function argValue(args: Args, name: string, fallback: string): string {
  return args.values.get(name) ?? fallback;
}
