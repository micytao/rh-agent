const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function wrap(code: string, text: string): string {
  return `${ESC}${code}m${text}${RESET}`;
}

/** Visible character width, ignoring ANSI escape sequences. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

/** Truncate a string with ANSI codes to fit within `maxWidth` visible chars. */
export function truncateToWidth(text: string, maxWidth: number): string {
  let visible = 0;
  let i = 0;
  while (i < text.length && visible < maxWidth) {
    if (text[i] === "\x1b") {
      const end = text.indexOf("m", i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    visible++;
    i++;
  }
  // Include any trailing ANSI sequences (resets) right after the cut point
  while (i < text.length && text[i] === "\x1b") {
    const end = text.indexOf("m", i);
    if (end === -1) break;
    i = end + 1;
  }
  return text.slice(0, i);
}

export const c = {
  bold: (text: string) => wrap("1", text),
  dim: (text: string) => wrap("2", text),
  red: (text: string) => wrap("31", text),
  green: (text: string) => wrap("32", text),
  yellow: (text: string) => wrap("33", text),
  cyan: (text: string) => wrap("36", text),
  boldRed: (text: string) => wrap("1;31", text),
  boldGreen: (text: string) => wrap("1;32", text),
  boldCyan: (text: string) => wrap("1;36", text),
  /** Brand red (#EE0000) using truecolor escape */
  rhRed: (text: string) => wrap("1;38;2;238;0;0", text),
};
