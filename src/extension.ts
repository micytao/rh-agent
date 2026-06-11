/**
 * Pi extension that rebrands the TUI header for rh-agent.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { c, truncateToWidth, visibleWidth } from "./ansi.js";
import { collectModuleSummary } from "./runner.js";

function getVersion(): string {
  try {
    const pkgPath = resolve(new URL(".", import.meta.url).pathname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

const BANNER = [
  "         __                                 __ ",
  "   _____/ /_        ____ _____ ____  ____  / /_",
  "  / ___/ __ \\______/ __ `/ __ `/ _ \\/ __ \\/ __/",
  " / /  / / / /_____/ /_/ / /_/ /  __/ / / / /_  ",
  "/_/  /_/ /_/      \\__,_/\\__, /\\___/_/ /_/\\__/  ",
  "                       /____/                  ",
];

const rhAgentExtension: ExtensionFactory = (pi) => {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const version = getVersion();

    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        const art = BANNER.map((line) => truncateToWidth(c.rhRed(line), width));
        const info = truncateToWidth(
          theme.fg("dim", "  Red Hat Agent v") +
          theme.fg("dim", version) +
          theme.fg("dim", " (powered by Pi)"),
          width,
        );

        const { modules, total } = collectModuleSummary();

        if (total === 0) {
          const hint = truncateToWidth(
            theme.fg("dim", "  Skills: none installed  |  ") +
            c.cyan("/lola install rh-basic") +
            theme.fg("dim", " to get started"),
            width,
          );
          return ["", ...art, "", info, hint, ""];
        }

        const summaryLine = truncateToWidth(
          theme.fg("dim", `  Skills: ${total} installed`),
          width,
        );

        const sep = theme.fg("dim", "  |  ");
        const sepWidth = visibleWidth(sep);
        const indent = "    ";
        const indentWidth = indent.length;

        const moduleLines: string[] = [];
        let currentLine = indent;
        let currentWidth = indentWidth;

        for (let i = 0; i < modules.length; i++) {
          const chip = c.cyan(modules[i].module) + theme.fg("dim", ` (${modules[i].count})`);
          const chipWidth = visibleWidth(chip);

          if (i === 0) {
            currentLine += chip;
            currentWidth += chipWidth;
          } else if (currentWidth + sepWidth + chipWidth <= width) {
            currentLine += sep + chip;
            currentWidth += sepWidth + chipWidth;
          } else {
            moduleLines.push(truncateToWidth(currentLine, width));
            currentLine = indent + chip;
            currentWidth = indentWidth + chipWidth;
          }
        }
        moduleLines.push(truncateToWidth(currentLine, width));

        return ["", ...art, "", info, summaryLine, ...moduleLines, ""];
      },
      invalidate() {},
    }));

    ctx.ui.setTitle("rh-agent");
  });
};

export default rhAgentExtension;
