/**
 * Pi extension that rebrands the TUI header and provides a
 * provider-categorized /model command for rh-agent.
 */
import type { ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { c, truncateToWidth, visibleWidth } from "./ansi.js";
import { collectModuleSummary, seedMcpJson, removeMcpJson } from "./runner.js";
import { loadConfig, saveConfig } from "./config.js";

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
          theme.fg("dim", "  rh-agent v") +
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

  // ── /model: provider-categorized model switcher ──

  pi.registerCommand("model", {
    description: "Switch model (select by provider, then model)",

    async handler(args: string, ctx: ExtensionCommandContext) {
      const available = ctx.modelRegistry.getAvailable();
      if (available.length === 0) {
        ctx.ui.notify("No models available — run /login or check your API keys", "warning");
        return;
      }

      const currentId = ctx.model?.id;
      const currentProvider = ctx.model?.provider;

      // Direct model switch: /model <name>
      const search = args.trim();
      if (search) {
        const exact = available.find(
          (m) => m.id === search || `${m.provider}/${m.id}` === search,
        );
        const fuzzy = exact ?? available.find(
          (m) => m.id.includes(search) || m.provider.includes(search),
        );
        if (fuzzy) {
          const ok = await pi.setModel(fuzzy);
          if (!ok) ctx.ui.notify(`Failed to switch to ${fuzzy.id} (missing API key?)`, "warning");
          return;
        }
        ctx.ui.notify(`No model matching "${search}"`, "warning");
        return;
      }

      // Group models by provider
      const byProvider = new Map<string, typeof available>();
      for (const m of available) {
        const list = byProvider.get(m.provider) ?? [];
        list.push(m);
        byProvider.set(m.provider, list);
      }

      // Build provider menu
      const providerOptions: string[] = [];
      const providerKeys: string[] = [];
      for (const [prov, models] of byProvider) {
        const displayName = ctx.modelRegistry.getProviderDisplayName(prov);
        const isCurrent = prov === currentProvider;
        const dot = isCurrent ? "●" : "○";
        const label = `${dot} ${displayName}  (${models.length} model${models.length > 1 ? "s" : ""})`;
        providerOptions.push(label);
        providerKeys.push(prov);
      }

      const selectedProvider = await ctx.ui.select("Select provider", providerOptions);
      if (!selectedProvider) return;

      const provIdx = providerOptions.indexOf(selectedProvider);
      const provKey = providerKeys[provIdx];
      const models = byProvider.get(provKey)!;

      // Build model menu within the selected provider
      const provDisplayName = ctx.modelRegistry.getProviderDisplayName(provKey);
      const modelOptions = models.map((m) => {
        const isCurrent = m.id === currentId && m.provider === currentProvider;
        const dot = isCurrent ? "●" : "○";
        return `${dot} ${m.id}`;
      });

      const selectedModel = await ctx.ui.select(`Select model — ${provDisplayName}`, modelOptions);
      if (!selectedModel) return;

      const modelIdx = modelOptions.indexOf(selectedModel);
      const model = models[modelIdx];

      const ok = await pi.setModel(model);
      if (!ok) {
        ctx.ui.notify(`Failed to switch to ${model.id} (missing API key?)`, "warning");
      }
    },

    getArgumentCompletions(prefix: string) {
      return null;
    },
  });

  // ── /mcp: MCP status and enable/disable toggle ──
  // Only register when the adapter is NOT loaded (mcp_enabled: false) to avoid
  // conflicting with the adapter's own /mcp command (which causes mcp:1, mcp:2).
  const mcpCfg = loadConfig();
  if (!mcpCfg?.mcp_enabled) {
    pi.registerCommand("mcp", {
      description: "Enable Red Hat Security MCP  (/mcp enable)",

      async handler(args: string, ctx: ExtensionCommandContext) {
        const sub = args.trim().toLowerCase();
        const cfg = loadConfig();

        if (sub === "enable") {
          if (cfg) {
            cfg.mcp_enabled = true;
            saveConfig(cfg);
            seedMcpJson();
          }
          ctx.ui.notify(
            "MCP enabled. Exit and re-run rh-agent to connect, then run /mcp-auth to authenticate.",
            "info",
          );
          return;
        }

        ctx.ui.notify(
          "MCP: disabled\n" +
            "  Run /mcp enable to activate Red Hat Security MCP",
          "info",
        );
      },

      getArgumentCompletions(prefix: string) {
        return "enable".startsWith(prefix)
          ? [{ label: "enable", value: "enable" }]
          : null;
      },
    });
  } else {
    pi.registerCommand("mcp-off", {
      description: "Disable MCP (takes effect on next run)",

      async handler(_args: string, ctx: ExtensionCommandContext) {
        const cfg = loadConfig();
        if (cfg) {
          cfg.mcp_enabled = false;
          saveConfig(cfg);
          removeMcpJson();
        }
        ctx.ui.notify("MCP disabled. Exit and re-run rh-agent to apply.", "info");
      },

      getArgumentCompletions() { return null; },
    });
  }
};

export default rhAgentExtension;
