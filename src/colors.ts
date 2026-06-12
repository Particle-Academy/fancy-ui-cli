/**
 * Tiny inline ANSI color helpers — zero dependencies.
 * Colors degrade to plain text when stdout is not a TTY or NO_COLOR is set.
 */

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.NO_COLOR !== "" &&
  Boolean(process.stdout.isTTY);

function wrap(open: number, close: number) {
  return (s: string): string =>
    enabled ? `[${open}m${s}[${close}m` : s;
}

export const colorsEnabled = enabled;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const cyan = wrap(36, 39);
export const gray = wrap(90, 39);

/** Visible (non-ANSI) length of a string, for column alignment. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, "").length;
}

/** Right-pad a string to `width` visible columns. */
export function pad(s: string, width: number): string {
  const len = visibleLength(s);
  return len >= width ? s : s + " ".repeat(width - len);
}
