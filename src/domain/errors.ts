/**
 * Base class for errors caused by a Profile's own configuration (bad TOML, a name that
 * doesn't resolve, a baseline cycle, contradictory allow/deny) as opposed to environmental
 * failures. The CLI catches this uniformly to print a clean message and exit 2, instead of
 * a raw stack trace, regardless of which specific subclass was thrown.
 */
export class ProfileConfigError extends Error {}
