import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import {
  PROVIDERS,
  RH_SYSTEM_PROMPT,
  LOLA_SKILLS_DIR,
  LOLA_MANIFEST,
  type RHAgentConfig,
} from "./config.js";
import rhAgentExtension from "./extension.js";
import lolaExtension from "./lola-extension.js";

const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

const APP_NAME = "rh-agent";

function ensurePiBranding(): void {
  try {
    const require = createRequire(import.meta.url);
    const piPkgPath = require.resolve("@earendil-works/pi-coding-agent/package.json");
    const piPkg = JSON.parse(readFileSync(piPkgPath, "utf-8"));
    if (piPkg.piConfig?.name === APP_NAME) return;
    piPkg.piConfig = { ...piPkg.piConfig, name: APP_NAME };
    writeFileSync(piPkgPath, JSON.stringify(piPkg, null, 2) + "\n");
  } catch {
    // Non-critical
  }
}

function ensureQuietStartup(): void {
  try {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    let settings: Record<string, unknown> = {};
    if (existsSync(PI_SETTINGS_PATH)) {
      settings = JSON.parse(readFileSync(PI_SETTINGS_PATH, "utf-8"));
    }
    if (settings.quietStartup !== true) {
      settings.quietStartup = true;
      writeFileSync(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    }
  } catch {
    // Non-critical
  }
}

function collectSkillPaths(): string[] {
  if (!existsSync(LOLA_SKILLS_DIR)) return [];
  return readdirSync(LOLA_SKILLS_DIR)
    .map((name) => join(LOLA_SKILLS_DIR, name))
    .filter(
      (p) => statSync(p).isDirectory() && existsSync(join(p, "SKILL.md")),
    );
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

function buildPiArgs(
  cfg: RHAgentConfig,
  opts: { modelOverride?: string; query?: string },
): string[] {
  const prov = PROVIDERS[cfg.provider] ?? PROVIDERS.openai;
  const modelId = opts.modelOverride ?? cfg.model;
  const args: string[] = [
    "--provider", prov.piProvider,
    "--model", modelId,
    "--system-prompt", RH_SYSTEM_PROMPT,
    "--no-extensions",
    "--no-prompt-templates",
  ];

  for (const skillPath of collectSkillPaths()) {
    args.push("--skill", skillPath);
  }

  if (opts.query) {
    args.push("-p", opts.query);
  }

  return args;
}

/**
 * Launch Pi's full interactive TUI with Red Hat skills and system prompt.
 */
export async function runInteractive(
  cfg: RHAgentConfig,
  modelOverride?: string,
): Promise<void> {
  ensureQuietStartup();
  ensurePiBranding();
  const { main } = await import("@earendil-works/pi-coding-agent");
  await main(buildPiArgs(cfg, { modelOverride }), {
    extensionFactories: [rhAgentExtension, lolaExtension],
  });
}

/**
 * Single-shot query using Pi's print mode.
 */
export async function runQuery(
  cfg: RHAgentConfig,
  query: string,
  modelOverride?: string,
): Promise<void> {
  ensureQuietStartup();
  ensurePiBranding();
  const { main } = await import("@earendil-works/pi-coding-agent");
  await main(buildPiArgs(cfg, { modelOverride, query }), {
    extensionFactories: [rhAgentExtension, lolaExtension],
  });
}
