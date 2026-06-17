import { c } from "./ansi.js";
import { select, password, confirm, input } from "./prompt.js";
import {
  CONFIG_DIR,
  PROVIDERS,
  LOLA_SKILLS_DIR,
  isRunningInContainer,
  type RHAgentConfig,
  type CustomEndpoint,
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

function extractEndpointName(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host.split(".");
    return parts[0] === "www" ? parts[1] : parts[0];
  } catch {
    return "custom";
  }
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

interface FetchModelsResult {
  models: string[];
  tlsSkipped: boolean;
}

async function fetchLocalModels(baseUrl: string, apiKey?: string, skipTls = false): Promise<FetchModelsResult> {
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    if (skipTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    process.stdout.write("  Fetching models from server... ");
    const headers: Record<string, string> = {};
    if (apiKey && apiKey !== "no-key") {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 120)}` : ""}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean).sort();
    if (ids.length) {
      console.log(c.green(`${ids.length} found`));
    } else {
      console.log(c.yellow("none found"));
    }
    return { models: ids, tlsSkipped: skipTls };
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    const label = reason.startsWith("HTTP ") ? "server error" : "could not connect";
    console.log(c.yellow(label));
    console.log(c.dim(`    ${reason}`));
    if (!skipTls && isTlsError(reason)) {
      const skip = await confirm({
        message: "TLS certificate verification failed. Skip verification for this endpoint?",
        default: true,
      });
      if (skip) return fetchLocalModels(baseUrl, apiKey, true);
    }
    return { models: [], tlsSkipped: skipTls };
  } finally {
    if (prevTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  }
}

function isTlsError(message: string): boolean {
  return /certificate|CERT|SSL|self.signed|UNABLE_TO_VERIFY/i.test(message);
}

interface ModelChoice {
  model: string;
  tlsSkipped: boolean;
}

async function promptModel(providerId: string, baseUrl?: string, apiKey?: string): Promise<ModelChoice> {
  const prov = PROVIDERS[providerId];

  if (providerId === "custom" && baseUrl) {
    const { models, tlsSkipped } = await fetchLocalModels(baseUrl, apiKey);
    if (models.length) {
      const chosen = await select({
        message: "Choose model:",
        choices: [
          ...models.map((m) => ({ name: m, value: m })),
          { name: "Enter a different model name", value: "__manual__" },
        ],
      });
      const model = chosen === "__manual__" ? await promptManualModel() : chosen;
      return { model, tlsSkipped };
    }
    console.log(c.dim("  Make sure your server is running, or enter the model name manually."));
    return { model: await promptManualModel(), tlsSkipped };
  }

  if (!prov.models.length) return { model: await promptManualModel(), tlsSkipped: false };

  const model = await select({
    message: "Choose default model:",
    choices: prov.models.map((m) => ({
      name: m === prov.defaultModel ? `${m}  (default)` : m,
      value: m,
    })),
    default: prov.defaultModel ?? prov.models[0],
  });
  return { model, tlsSkipped: false };
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
    `\n  ${c.bold("Ready!")} Run ${c.cyan("rh-agent")} to start chatting.\n`,
  );
}

interface ProviderSetup {
  providerId: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  endpointName?: string;
  extras: Record<string, string>;
}

async function configureOneProvider(
  providerId: string,
  usedEndpointNames: Set<string> = new Set(),
): Promise<ProviderSetup | null> {
  let apiKey: string;
  let baseUrl: string | undefined;
  const extras: Record<string, string> = {};

  let endpointName: string | undefined;

  if (providerId === "custom") {
    console.log(
      c.bold("\n  Tip:") + c.dim(" rh-agent uses tool-calling and skill files that require a") +
        c.dim("\n  capable model (≥12B parameters recommended). Smaller models") +
        c.dim("\n  may fail to follow instructions or resolve file paths correctly.") +
        c.dim("\n  Good choices: Gemma 4, Qwen 2.5 32B, Llama 3.3 70B, Mistral Large."),
    );
    baseUrl = await promptBaseUrl();
    const defaultName = extractEndpointName(baseUrl);
    while (true) {
      endpointName = (await input({
        message: `Give this endpoint a short name (${defaultName}):`,
      })).trim() || defaultName;
      const normalized = endpointName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!usedEndpointNames.has(normalized)) {
        usedEndpointNames.add(normalized);
        break;
      }
      console.log(c.red(`  Name "${endpointName}" is already used. Choose a different name.`));
    }
    apiKey = await promptCustomApiKey();
    extras.RH_AGENT_BASE_URL = baseUrl;
  } else {
    apiKey = await promptApiKey(providerId);
    const provExtras = await promptExtraEnvVars(providerId);
    Object.assign(extras, provExtras);
    baseUrl = extras.RH_AGENT_BASE_URL;
  }

  const { model, tlsSkipped } = await promptModel(providerId, baseUrl, apiKey);

  if (tlsSkipped) {
    extras.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

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

  return { providerId, apiKey, model, baseUrl, endpointName, extras };
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
  const usedEndpointNames = new Set<string>();

  // First provider (required)
  const firstProviderId = await promptProvider([], "Choose your default model provider:");
  const firstSetup = await configureOneProvider(firstProviderId, usedEndpointNames);
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

    const configured = setups.map((s) => s.providerId).filter((id) => id !== "custom");
    const nextId = await promptProvider(configured, "Choose an additional provider:");
    const nextSetup = await configureOneProvider(nextId, usedEndpointNames);
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

  // Save all provider keys and build custom endpoint list
  const customSetups = setups.filter((s) => s.providerId === "custom");
  for (const s of setups) {
    if (s.providerId === "custom") continue;
    const prov = PROVIDERS[s.providerId];
    saveEnvKey(prov.envVar, s.apiKey);
    for (const [k, v] of Object.entries(s.extras)) saveEnvKey(k, v);
  }

  // Save custom endpoints with indexed env vars
  const customEndpoints: CustomEndpoint[] = [];
  for (let i = 0; i < customSetups.length; i++) {
    const s = customSetups[i];
    const suffix = customSetups.length === 1 ? "" : `_${i}`;
    const keyVar = `RH_AGENT_API_KEY${suffix}`;
    const urlVar = `RH_AGENT_BASE_URL${suffix}`;
    saveEnvKey(keyVar, s.apiKey);
    saveEnvKey(urlVar, s.baseUrl!);
    for (const [k, v] of Object.entries(s.extras)) {
      if (k !== "RH_AGENT_BASE_URL" && k !== "RH_AGENT_API_KEY") saveEnvKey(k, v);
    }
    customEndpoints.push({
      baseUrl: s.baseUrl!,
      apiKeyEnvVar: keyVar,
      models: [s.model],
      name: s.endpointName || extractEndpointName(s.baseUrl!),
    });
  }

  const primary = setups[0];
  const cfg: RHAgentConfig = {
    provider: primary.providerId,
    model: primary.model,
    configured_providers: [...new Set(setups.map((s) => s.providerId))],
    mcp_enabled: enableMcp,
    api_key_source: "env",
    base_url: primary.baseUrl,
    extra: Object.fromEntries(
      Object.entries(primary.extras).filter(([k]) => k !== "RH_AGENT_BASE_URL"),
    ),
  };
  saveConfig(cfg);
  if (customEndpoints.length) {
    writeModelsJson(customEndpoints);
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
  if (cfg.provider === "custom" && cfg.base_url) {
    writeModelsJson([{
      baseUrl: cfg.base_url,
      apiKeyEnvVar: prov.envVar,
      models: [cfg.model],
    }]);
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
