/** The handful of styles format-*.ts needs, pre-resolved so callers never branch on color
 * support themselves — pass a no-op Painter and every `.bold()`/`.red()` etc. just returns
 * its input unchanged. */
export interface Painter {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
}

const CODES: Record<keyof Painter, string> = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  cyan: "36",
  gray: "90",
};

function wrap(code: string): (s: string) => string {
  return (s: string) => `\x1b[${code}m${s}\x1b[0m`;
}

const PLAIN_PAINTER: Painter = {
  bold: (s) => s,
  dim: (s) => s,
  red: (s) => s,
  green: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
  gray: (s) => s,
};

const ANSI_PAINTER: Painter = {
  bold: wrap(CODES.bold),
  dim: wrap(CODES.dim),
  red: wrap(CODES.red),
  green: wrap(CODES.green),
  yellow: wrap(CODES.yellow),
  cyan: wrap(CODES.cyan),
  gray: wrap(CODES.gray),
};

export function createPainter(enabled: boolean): Painter {
  return enabled ? ANSI_PAINTER : PLAIN_PAINTER;
}

/**
 * Follows the no-color.org convention: `NO_COLOR` (any value, including empty) forces color
 * off regardless of TTY status; `FORCE_COLOR` (anything but `"0"`) forces it on; otherwise
 * color follows whether the given stream is a real terminal. Piping `explain`'s output to a
 * file or another program (no TTY) gets plain text by default either way.
 */
export function shouldUseColor(stream: { readonly isTTY?: boolean } | undefined): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
  return stream?.isTTY === true;
}
