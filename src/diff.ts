/**
 * Minimal self-contained unified diff (LCS-based). Zero dependencies.
 * Produces standard `--- / +++ / @@` hunks with 3 lines of context.
 */

interface DiffOp {
  type: "equal" | "del" | "add";
  line: string;
}

function splitLines(text: string): string[] {
  // Drop a single trailing newline so we don't emit a spurious empty line.
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Longest-common-subsequence diff over two arrays of lines. */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // DP table of LCS lengths.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "equal", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", line: a[i]! });
      i++;
    } else {
      ops.push({ type: "add", line: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", line: a[i++]! });
  while (j < m) ops.push({ type: "add", line: b[j++]! });
  return ops;
}

export interface UnifiedDiffOptions {
  fromLabel?: string;
  toLabel?: string;
  context?: number;
}

/**
 * Build a unified-diff string from two texts. Returns an empty string when the
 * two inputs are identical (no hunks).
 */
export function unifiedDiff(
  fromText: string,
  toText: string,
  opts: UnifiedDiffOptions = {},
): string {
  const context = opts.context ?? 3;
  const fromLabel = opts.fromLabel ?? "a";
  const toLabel = opts.toLabel ?? "b";

  const a = splitLines(fromText);
  const b = splitLines(toText);
  const ops = lcsDiff(a, b);

  if (!ops.some((op) => op.type !== "equal")) {
    return "";
  }

  // Group ops into hunks, keeping `context` equal lines around changes.
  interface HunkLine {
    type: DiffOp["type"];
    line: string;
  }
  interface Hunk {
    aStart: number;
    bStart: number;
    aLen: number;
    bLen: number;
    lines: HunkLine[];
  }

  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let aIndex = 0;
  let bIndex = 0;
  let trailingEqual = 0;

  const flush = (): void => {
    if (current) {
      // Trim trailing context beyond the limit.
      hunks.push(current);
      current = null;
      trailingEqual = 0;
    }
  };

  // Pre-compute leading-context buffer.
  const pendingContext: { line: string; aPos: number; bPos: number }[] = [];

  for (const op of ops) {
    if (op.type === "equal") {
      if (current) {
        current.lines.push({ type: "equal", line: op.line });
        current.aLen++;
        current.bLen++;
        trailingEqual++;
        if (trailingEqual > context * 2) {
          // Far enough past the last change — close the hunk, dropping extra context.
          const extra = trailingEqual - context;
          current.lines.splice(current.lines.length - extra, extra);
          current.aLen -= extra;
          current.bLen -= extra;
          flush();
        }
      } else {
        pendingContext.push({ line: op.line, aPos: aIndex, bPos: bIndex });
        if (pendingContext.length > context) pendingContext.shift();
      }
      aIndex++;
      bIndex++;
    } else {
      if (!current) {
        const lead = pendingContext.slice();
        const start = lead[0];
        current = {
          aStart: start ? start.aPos : aIndex,
          bStart: start ? start.bPos : bIndex,
          aLen: 0,
          bLen: 0,
          lines: [],
        };
        for (const c of lead) {
          current.lines.push({ type: "equal", line: c.line });
          current.aLen++;
          current.bLen++;
        }
        pendingContext.length = 0;
      }
      trailingEqual = 0;
      if (op.type === "del") {
        current.lines.push({ type: "del", line: op.line });
        current.aLen++;
        aIndex++;
      } else {
        current.lines.push({ type: "add", line: op.line });
        current.bLen++;
        bIndex++;
      }
    }
  }
  flush();

  const out: string[] = [];
  out.push(`--- ${fromLabel}`);
  out.push(`+++ ${toLabel}`);
  for (const h of hunks) {
    const aStart = h.aLen === 0 ? h.aStart : h.aStart + 1;
    const bStart = h.bLen === 0 ? h.bStart : h.bStart + 1;
    out.push(`@@ -${aStart},${h.aLen} +${bStart},${h.bLen} @@`);
    for (const l of h.lines) {
      const prefix = l.type === "del" ? "-" : l.type === "add" ? "+" : " ";
      out.push(prefix + l.line);
    }
  }
  return out.join("\n") + "\n";
}
