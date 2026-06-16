import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  CONFIG_DIR,
  AGENT_DIR,
  PROVIDERS,
  RH_SYSTEM_PROMPT,
  LOLA_MANIFEST,
  migrateSkillsDir,
  type RHAgentConfig,
} from "./config.js";
import rhAgentExtension from "./extension.js";
import lolaExtension from "./lola-extension.js";

const MCP_JSON_PATH = join(AGENT_DIR, "mcp.json");

// ── Pi branding: must run BEFORE the first dynamic import() of the SDK ──
// Pi reads piConfig from its own package.json at module load time to set
// APP_NAME (exit message, export filenames) and CONFIG_DIR_NAME (paths).
// We patch it here so the dynamic import picks up our values.
mkdirSync(AGENT_DIR, { recursive: true });
migrateSkillsDir();

// Patch Pi's branding and built-in /model command.
// In containers, this is done at image build time (node_modules is read-only
// under rootless podman). The runtime patching here covers dev/npm installs.
try {
  const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const piDistRoot = dirname(dirname(piEntry));
  const piPkgPath = join(piDistRoot, "package.json");
  const piPkg = JSON.parse(readFileSync(piPkgPath, "utf-8"));

  const alreadyPatched = piPkg.version === "99.0.0"
    && piPkg.piConfig?.name === "rh-agent"
    && piPkg.piConfig?.configDir === ".rh-agent";

  if (!alreadyPatched) {
    piPkg.piConfig = { ...piPkg.piConfig, name: "rh-agent", configDir: ".rh-agent" };
    piPkg.version = "99.0.0";
    writeFileSync(piPkgPath, JSON.stringify(piPkg, null, 2) + "\n");

    const interactivePath = join(piDistRoot, "dist", "modes", "interactive", "interactive-mode.js");
    const slashCmdsPath = join(piDistRoot, "dist", "core", "slash-commands.js");

    if (existsSync(interactivePath)) {
      let src = readFileSync(interactivePath, "utf-8");
      const modelBlock = /if\s*\(text\s*===\s*"\/model"\s*\|\|\s*text\.startsWith\("\/model "\)\)\s*\{[^}]*\}/;
      if (modelBlock.test(src)) {
        src = src.replace(modelBlock, "/* rh-agent: /model handled by extension */");
        writeFileSync(interactivePath, src);
      }
    }

    if (existsSync(slashCmdsPath)) {
      let src = readFileSync(slashCmdsPath, "utf-8");
      const modelEntry = /\{\s*name:\s*"model"[^}]*\},?\s*/;
      if (modelEntry.test(src)) {
        src = src.replace(modelEntry, "");
        writeFileSync(slashCmdsPath, src);
      }
    }
  }
} catch { /* non-critical -- in containers, patching is done at build time */ }

// After patching, Pi's APP_NAME → "rh-agent" → ENV_AGENT_DIR → "RH-AGENT_CODING_AGENT_DIR"
process.env["RH-AGENT_CODING_AGENT_DIR"] = AGENT_DIR;
// pi-mcp-adapter reads PI_CODING_AGENT_DIR for token/cache storage
process.env["PI_CODING_AGENT_DIR"] = AGENT_DIR;

// Suppress Pi's default [Skills] / [Extensions] listing at startup.
// rh-agent shows its own banner via rhAgentExtension instead.
const SETTINGS_PATH = join(AGENT_DIR, "settings.json");
try {
  let settings: Record<string, unknown> = {};
  if (existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  }
  if (settings.quietStartup !== true) {
    settings.quietStartup = true;
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  }
} catch { /* non-critical */ }

/** Seed mcp.json with Red Hat Security MCP when MCP is first enabled. */
export function seedMcpJson(): void {
  if (existsSync(MCP_JSON_PATH)) return;
  try {
    writeFileSync(
      MCP_JSON_PATH,
      JSON.stringify(
        {
          mcpServers: {
            "red-hat-security": {
              type: "http",
              url: "https://security-mcp.api.redhat.com/mcp",
              lifecycle: "eager",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
  } catch { /* non-critical */ }
}

/** Remove mcp.json when MCP is disabled. */
export function removeMcpJson(): void {
  try {
    if (existsSync(MCP_JSON_PATH)) unlinkSync(MCP_JSON_PATH);
  } catch { /* non-critical */ }
}

export interface ModuleSummary {
  module: string;
  count: number;
}

/** Per-module skill counts read from .lola-manifest.json */
export function collectModuleSummary(): { modules: ModuleSummary[]; total: number } {
  if (!existsSync(LOLA_MANIFEST)) return { modules: [], total: 0 };
  try {
    const manifest: Record<string, string[]> = JSON.parse(
      readFileSync(LOLA_MANIFEST, "utf-8"),
    );
    const modules: ModuleSummary[] = Object.entries(manifest).map(
      ([mod, skills]) => ({ module: mod, count: skills.length }),
    );
    const total = modules.reduce((sum, m) => sum + m.count, 0);
    return { modules, total };
  } catch {
    return { modules: [], total: 0 };
  }
}

function resolveMcpAdapterPath(): string | null {
  try {
    const req = createRequire(import.meta.url);
    return req.resolve("pi-mcp-adapter/index.ts");
  } catch {
    return null;
  }
}

function buildPiArgs(
  cfg: RHAgentConfig,
  opts: { modelOverride?: string; sessionId?: string },
): string[] {
  const prov = PROVIDERS[cfg.provider] ?? PROVIDERS.openai;
  const modelId = opts.modelOverride ?? cfg.model;
  const piProvider = cfg.provider === "custom" ? "rh-agent-custom" : prov.piProvider;

  const args: string[] = [
    "--provider", piProvider,
    "--model", modelId,
    "--system-prompt", RH_SYSTEM_PROMPT,
    "--no-extensions",
    "--no-prompt-templates",
  ];

  if (cfg.mcp_enabled) {
    const adapterPath = resolveMcpAdapterPath();
    if (adapterPath) {
      args.push("-e", adapterPath);
    }
  }

  if (opts.sessionId) {
    args.push("--session", opts.sessionId);
  }

  return args;
}

/**
 * Launch Pi's full interactive TUI with Red Hat skills and system prompt.
 */
export async function runInteractive(
  cfg: RHAgentConfig,
  modelOverride?: string,
  sessionId?: string,
): Promise<void> {
  const { main } = await import("@earendil-works/pi-coding-agent");
  await main(buildPiArgs(cfg, { modelOverride, sessionId }), {
    extensionFactories: [rhAgentExtension, lolaExtension],
  });
}
