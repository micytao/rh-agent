import { c } from "./ansi.js";
import { select, password, confirm, input } from "./prompt.js";
import {
  CONFIG_DIR,
  PROVIDERS,
  LOLA_SKILLS_DIR,
  isRunningInContainer,
  type RHAgentConfig,
  loadConfig,
  saveConfig,
  saveEnvKey,
  resolveApiKey,
  validateApiKey,
  maskKey,
  writeModelsJson,
  removeModelsJson,
} from "./config.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function detectEnvKey(providerId: string): string | undefined {
  return process.env[PROVIDERS[providerId].envVar] || undefined;
}

async function promptProvider(
  exclude: string[] = [],
  label = "Choose your model provider:",
): Promise<string> {
  const choices = Object.entries(PROVIDERS)
    .filter(([id]) => !exclude.includes(id))
    .map(([id, p]) => ({ name: p.label, value: id }));
  return select({ message: label, choices });
}

async function promptApiKey(providerId: string): Promise<string> {
  const prov = PROVIDERS[providerId];
  const existing = detectEnvKey(providerId);

  if (existing) {
    console.log(
      c.green(`\n  Found ${prov.envVar} in environment`) +
        ` (${maskKey(existing)})`,
    );
    const useIt = await confirm({ message: "Use this key?", default: true });
    if (useIt) return existing;
  }

  while (true) {
    const key = await password({
      message: `Enter your ${prov.label} API key:`,
    });
    if (key.trim()) return key.trim();
    console.log(c.red("  Key cannot be empty."));
  }
}

function getBaseUrlPresets() {
  const inContainer = isRunningInContainer();
  const host = inContainer ? "host.containers.internal" : "localhost";
  return [
    { name: `Ollama       (http://${host}:11434/v1)`, value: `http://${host}:11434/v1` },
    { name: `vLLM         (http://${host}:8000/v1)`,  value: `http://${host}:8000/v1` },
    { name: `LM Studio    (http://${host}:1234/v1)`,  value: `http://${host}:1234/v1` },
    { name: "Enter a custom URL",                      value: "__custom__" },
  ];
}

async function promptBaseUrl(): Promise<string> {
  if (isRunningInContainer()) {
    console.log(
      c.bold("\n  Tip:") + c.dim(" Running inside a container. Presets use") +
        c.dim("\n  host.containers.internal to reach services on your host machine."),
    );
  }

  const choice = await select({
    message: "Select your local inference endpoint:",
    choices: getBaseUrlPresets(),
  });

  if (choice !== "__custom__") return choice;

  while (true) {
    const url = (await input({ message: "Base URL:" })).trim();
    if (url) return url;
    console.log(c.red("  Base URL cannot be empty."));
  }
}

async function promptCustomApiKey(): Promise<string> {
  const key = (await input({
    message: "API key (leave blank if not required):",
  })).trim();
  return key || "no-key";
}

async function promptExtraEnvVars(
  providerId: string,
): Promise<Record<string, string>> {
  const prov = PROVIDERS[providerId];
  const extras: Record<string, string> = {};
  for (const [varName, description] of Object.entries(
    prov.extraEnvVars ?? {},
  )) {
    if (varName === "RH_AGENT_BASE_URL") continue;
    const existing = process.env[varName];
    if (existing) {
      console.log(
        c.green(`\n  Found ${varName} in environment`) + ` (${existing})`,
      );
      const useIt = await confirm({ message: "Use this value?", default: true });
      if (useIt) {
        extras[varName] = existing;
        continue;
      }
    }
    while (true) {
      const val = await input({
        message: `Enter ${description} (${varName}):`,
      });
      if (val.trim()) {
        extras[varName] = val.trim();
        break;
      }
      console.log(c.red("  Value cannot be empty."));
    }
  }
  return extras;
}

async function fetchLocalModels(baseUrl: string): Promise<string[]> {
  try {
    process.stdout.write("  Fetching models from server... ");
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean).sort();
    if (ids.length) {
      console.log(c.green(`${ids.length} found`));
    } else {
      console.log(c.yellow("none found"));
    }
    return ids;
  } catch (e) {
    console.log(c.yellow("could not connect"));
    return [];
  }
}

async function promptModel(providerId: string, baseUrl?: string): Promise<string> {
  const prov = PROVIDERS[providerId];

  if (providerId === "custom" && baseUrl) {
    const models = await fetchLocalModels(baseUrl);
    if (models.length) {
      return select({
        message: "Choose model:",
        choices: [
          ...models.map((m) => ({ name: m, value: m })),
          { name: "Enter a different model name", value: "__manual__" },
        ],
      }).then((v) => v === "__manual__" ? promptManualModel() : v);
    }
    console.log(c.dim("  Make sure your server is running, or enter the model name manually."));
    return promptManualModel();
  }

  if (!prov.models.length) return promptManualModel();

  return select({
    message: "Choose default model:",
    choices: prov.models.map((m) => ({
      name: m === prov.defaultModel ? `${m}  (default)` : m,
      value: m,
    })),
    default: prov.defaultModel ?? prov.models[0],
  });
}

async function promptManualModel(): Promise<string> {
  while (true) {
    const model = await input({ message: "Enter model name:" });
    if (model.trim()) return model.trim();
    console.log(c.red("  Model name cannot be empty."));
  }
}

function showCurrentConfig(cfg: RHAgentConfig): void {
  const prov = PROVIDERS[cfg.provider];
  console.log("\n  Current Configuration:");
  console.log(`    Default Provider: ${prov?.label ?? cfg.provider}`);
  console.log(`    Default Model:    ${cfg.model}`);
  if (cfg.configured_providers.length > 1) {
    const names = cfg.configured_providers
      .map((id) => PROVIDERS[id]?.label ?? id)
      .join(", ");
    console.log(`    All Providers:    ${names}`);
  }
  console.log(`    API Key Source:   ${cfg.api_key_source}`);
  if (cfg.base_url) console.log(`    Base URL:         ${cfg.base_url}`);
  console.log(`    Config Dir:       ${CONFIG_DIR}`);
}

function countSkills(): number {
  if (!existsSync(LOLA_SKILLS_DIR)) return 0;
  return readdirSync(LOLA_SKILLS_DIR).filter((name) => {
    const skillPath = join(LOLA_SKILLS_DIR, name);
    return statSync(skillPath).isDirectory() && existsSync(join(skillPath, "SKILL.md"));
  }).length;
}

function postInstallSummary(): void {
  const count = countSkills();
  if (count > 0) {
    console.log(c.green(`\n  ${count} skill(s) already installed.`));
  } else {
    console.log(
      c.bold("\n  Next: install Red Hat skills with Lola") +
        `\n    ${c.cyan("rh-agent")}${c.dim("                        (start interactive mode)")}` +
        `\n    ${c.cyan("/lola list")}${c.dim("                      (see available skill packs)")}` +
        `\n    ${c.cyan("/lola install rh-basic")}${c.dim("          (install core skills)")}`,
    );
  }
  console.log(
    `\n  ${c.bold("Ready!")} Try:  ${c.cyan('rh-agent "Is CVE-2026-31431 critical?"')}\n`,
  );
}

interface ProviderSetup {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  extras: Record<string, string>;
}

async function configureOneProvider(
  providerId: string,
): Promise<ProviderSetup | null> {
  let apiKey: string;
  let baseUrl: string | undefined;
  const extras: Record<string, string> = {};

  if (providerId === "custom") {
    console.log(
      c.bold("\n  Tip:") + c.dim(" rh-agent uses tool-calling and skill files that require a") +
        c.dim("\n  capable model (≥12B parameters recommended). Smaller models") +
        c.dim("\n  may fail to follow instructions or resolve file paths correctly.") +
        c.dim("\n  Good choices: Gemma 4, Qwen 2.5 32B, Llama 3.3 70B, Mistral Large."),
    );
    baseUrl = await promptBaseUrl();
    apiKey = await promptCustomApiKey();
    extras.RH_AGENT_BASE_URL = baseUrl;
  } else {
    apiKey = await promptApiKey(providerId);
    const provExtras = await promptExtraEnvVars(providerId);
    Object.assign(extras, provExtras);
    baseUrl = extras.RH_AGENT_BASE_URL;
  }

  const model = await promptModel(providerId, baseUrl);

  if (providerId !== "custom") {
    process.stdout.write("\n  Validating API key... ");
    const valid = await validateApiKey(providerId, apiKey);
    if (valid) {
      console.log(c.boldGreen("OK"));
    } else {
      console.log(c.boldRed("FAILED"));
      const saveAnyway = await confirm({
        message: "API key validation failed. Save anyway?",
        default: false,
      });
      if (!saveAnyway) return null;
    }
  }

  return { providerId, apiKey, model, baseUrl, extras };
}

export async function runOnboard(opts: {
  nonInteractive?: boolean;
  authChoice?: string;
}): Promise<boolean> {
  console.log(c.boldRed("\n  Red Hat Agent") + c.dim(" -- Setup\n"));

  const existing = loadConfig();
  if (existing && !opts.nonInteractive) {
    showCurrentConfig(existing);
    const update = await confirm({
      message: "Configuration exists. Update settings?",
      default: true,
    });
    if (!update) {
      console.log(c.dim("  Keeping current configuration."));
      return true;
    }
  }

  if (opts.nonInteractive) {
    return runNonInteractive(opts.authChoice);
  }

  const setups: ProviderSetup[] = [];

  // First provider (required)
  const firstProviderId = await promptProvider([], "Choose your default model provider:");
  const firstSetup = await configureOneProvider(firstProviderId);
  if (!firstSetup) {
    console.log(c.red("  Onboarding cancelled."));
    return false;
  }
  setups.push(firstSetup);

  // Additional providers (optional loop)
  const allProviderIds = Object.keys(PROVIDERS);
  while (setups.length < allProviderIds.length) {
    console.log(
      c.dim("\n  Tip: You can switch between providers at any time using ") +
        c.cyan("/model") + c.dim(" in the TUI."),
    );
    const addMore = await confirm({
      message: "Add another model provider?",
      default: false,
    });
    if (!addMore) break;

    const configured = setups.map((s) => s.providerId);
    const nextId = await promptProvider(configured, "Choose an additional provider:");
    const nextSetup = await configureOneProvider(nextId);
    if (nextSetup) setups.push(nextSetup);
  }

  // MCP opt-in
  console.log(
    c.bold("\n  Red Hat Security MCP") +
      c.dim(" provides direct access to CVE and advisory data."),
  );
  console.log(
    c.dim("  Without MCP, security skills still work via web search."),
  );
  const enableMcp = await confirm({
    message: "Enable Red Hat Security MCP? (requires browser auth on first use)",
    default: false,
  });
  if (enableMcp) {
    console.log(
      c.dim("  After setup, run ") + c.cyan("/mcp-auth") +
        c.dim(" in the TUI to authenticate."),
    );
  }

  // Save all provider keys
  let hasCustom = false;
  let customSetup: ProviderSetup | undefined;
  for (const s of setups) {
    const prov = PROVIDERS[s.providerId];
    saveEnvKey(prov.envVar, s.apiKey);
    for (const [k, v] of Object.entries(s.extras)) saveEnvKey(k, v);
    if (s.providerId === "custom") {
      hasCustom = true;
      customSetup = s;
    }
  }

  const primary = setups[0];
  const cfg: RHAgentConfig = {
    provider: primary.providerId,
    model: primary.model,
    configured_providers: setups.map((s) => s.providerId),
    mcp_enabled: enableMcp,
    api_key_source: "env",
    base_url: primary.baseUrl,
    extra: Object.fromEntries(
      Object.entries(primary.extras).filter(([k]) => k !== "RH_AGENT_BASE_URL"),
    ),
  };
  saveConfig(cfg);
  if (hasCustom && customSetup) {
    writeModelsJson({
      ...cfg,
      provider: "custom",
      base_url: customSetup.baseUrl,
      model: customSetup.model,
    });
  } else {
    removeModelsJson();
  }

  console.log(c.green(`\n  Config saved to ${CONFIG_DIR}/`));
  if (setups.length > 1) {
    console.log(
      c.dim("  Configured providers: ") +
        setups.map((s) => PROVIDERS[s.providerId].label).join(", "),
    );
    console.log(
      c.dim("  Default: ") + PROVIDERS[primary.providerId].label +
        c.dim("  (switch with /model in the TUI)"),
    );
  }

  postInstallSummary();
  return true;
}

async function runNonInteractive(authChoice?: string): Promise<boolean> {
  const providerMap: Record<string, string> = {
    "openai-api-key": "openai",
    "anthropic-api-key": "anthropic",
    "google-api-key": "google",
    "azure-api-key": "azure",
    "custom-api-key": "custom",
  };

  if (!authChoice) {
    console.log(c.red("  --auth-choice required in non-interactive mode"));
    return false;
  }

  const providerId = providerMap[authChoice];
  if (!providerId) {
    console.log(c.red(`  Unknown auth choice: ${authChoice}`));
    console.log(`  Valid choices: ${Object.keys(providerMap).join(", ")}`);
    return false;
  }

  const prov = PROVIDERS[providerId];
  const apiKey = process.env[prov.envVar];
  if (!apiKey) {
    console.log(c.red(`  ${prov.envVar} not found in environment`));
    return false;
  }

  const extras: Record<string, string> = {};
  for (const varName of Object.keys(prov.extraEnvVars ?? {})) {
    const val = process.env[varName];
    if (val) extras[varName] = val;
  }

  saveEnvKey(prov.envVar, apiKey);
  for (const [k, v] of Object.entries(extras)) saveEnvKey(k, v);

  const cfg: RHAgentConfig = {
    provider: providerId,
    model: prov.defaultModel ?? "gpt-4o",
    configured_providers: [providerId],
    mcp_enabled: true,
    api_key_source: "env",
    base_url: extras.RH_AGENT_BASE_URL,
    extra: Object.fromEntries(
      Object.entries(extras).filter(([k]) => k !== "RH_AGENT_BASE_URL"),
    ),
  };
  saveConfig(cfg);
  if (cfg.provider === "custom") {
    writeModelsJson(cfg);
  } else {
    removeModelsJson();
  }
  console.log(c.green(`  Config saved to ${CONFIG_DIR}/`));
  return true;
}

export async function runStatus(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) {
    console.log(
      c.yellow("\n  No configuration found.") +
        ` Run ${c.boldCyan("rh-agent onboard")} to get started.\n`,
    );
    return;
  }

  showCurrentConfig(cfg);

  console.log();
  for (const id of cfg.configured_providers) {
    const prov = PROVIDERS[id];
    if (!prov) continue;
    const key = resolveApiKey(id);
    const isDefault = id === cfg.provider;
    const label = prov.label + (isDefault ? " (default)" : "");
    if (key) {
      process.stdout.write(`  ${label} (${prov.envVar}): ${c.green(maskKey(key))} -- `);
      const ok = await validateApiKey(id, key);
      console.log(ok ? c.boldGreen("OK") : c.boldRed("FAILED"));
    } else {
      console.log(`  ${label} (${prov.envVar}): ${c.red("NOT SET")}`);
    }
  }

  const skillCount = countSkills();
  console.log(
    skillCount > 0
      ? `  Skills: ${c.green(`${skillCount} installed`)} (via Lola)`
      : `  Skills: ${c.yellow("None")} -- run /lola install rh-basic in the TUI`,
  );

  console.log();
}
