import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync, cpSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR = join(homedir(), ".rh-agent");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const ENV_FILE = join(CONFIG_DIR, ".env");
export const AGENT_DIR = join(CONFIG_DIR, "agent");
export const LOLA_SKILLS_DIR = join(AGENT_DIR, "skills");
export const LOLA_MANIFEST = join(LOLA_SKILLS_DIR, ".lola-manifest.json");
const OLD_SKILLS_DIR = join(CONFIG_DIR, "skills");


export interface ProviderInfo {
  label: string;
  envVar: string;
  piProvider: string;
  models: string[];
  defaultModel: string | null;
  extraEnvVars?: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  openai: {
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    piProvider: "openai",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
    defaultModel: "gpt-4o",
  },
  anthropic: {
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    piProvider: "anthropic",
    models: [
      "claude-sonnet-4-20250514",
      "claude-haiku-35-20241022",
      "claude-opus-4-20250514",
    ],
    defaultModel: "claude-sonnet-4-20250514",
  },
  google: {
    label: "Google (Gemini)",
    envVar: "GEMINI_API_KEY",
    piProvider: "google",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    defaultModel: "gemini-2.5-flash",
  },
  azure: {
    label: "Azure OpenAI",
    envVar: "AZURE_OPENAI_API_KEY",
    piProvider: "openai",
    models: ["gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-4o",
    extraEnvVars: { AZURE_OPENAI_ENDPOINT: "Azure endpoint URL" },
  },
  custom: {
    label: "Custom (OpenAI-compatible endpoint)",
    envVar: "RH_AGENT_API_KEY",
    piProvider: "openai",
    models: [],
    defaultModel: null,
    extraEnvVars: { RH_AGENT_BASE_URL: "Endpoint base URL" },
  },
};

export interface RHAgentConfig {
  provider: string;
  model: string;
  configured_providers: string[];
  mcp_enabled: boolean;
  api_key_source: string;
  base_url?: string;
  extra?: Record<string, string>;
}

export function defaultConfig(): RHAgentConfig {
  return {
    provider: "openai",
    model: "gpt-4o",
    configured_providers: ["openai"],
    mcp_enabled: true,
    api_key_source: "env",
  };
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveConfig(cfg: RHAgentConfig): void {
  ensureConfigDir();
  const data: Record<string, unknown> = {
    provider: cfg.provider,
    model: cfg.model,
    configured_providers: cfg.configured_providers,
    mcp_enabled: cfg.mcp_enabled,
    api_key_source: cfg.api_key_source,
  };
  if (cfg.base_url) data.base_url = cfg.base_url;
  if (cfg.extra && Object.keys(cfg.extra).length > 0) data.extra = cfg.extra;
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + "\n");
}

export function loadConfig(): RHAgentConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    return {
      provider: data.provider ?? "openai",
      model: data.model ?? "gpt-4o",
      configured_providers: data.configured_providers ?? [data.provider ?? "openai"],
      mcp_enabled: data.mcp_enabled ?? true,
      api_key_source: data.api_key_source ?? "env",
      base_url: data.base_url ? adaptBaseUrl(data.base_url) : undefined,
      extra: data.extra ?? {},
    };
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return existsSync(CONFIG_FILE);
}

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  return parseEnv(readFileSync(ENV_FILE, "utf-8"));
}

export function saveEnvKey(keyName: string, keyValue: string): void {
  ensureConfigDir();
  const existing = readEnvFile();
  existing[keyName] = keyValue;
  const lines = Object.entries(existing)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_FILE, lines.join("\n") + "\n");
  chmodSync(ENV_FILE, 0o600);
}

export function resolveApiKey(
  providerId: string,
  cliOverride?: string,
): string | undefined {
  if (cliOverride) return cliOverride;
  const prov = PROVIDERS[providerId];
  if (!prov) return undefined;

  const fromEnv = process.env[prov.envVar];
  if (fromEnv) return fromEnv;

  const fileVals = readEnvFile();
  return fileVals[prov.envVar] || undefined;
}

export async function validateApiKey(
  providerId: string,
  apiKey: string,
): Promise<boolean> {
  try {
    if (providerId === "openai") {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    }
    if (providerId === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    }
    if (providerId === "google") {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      return r.ok;
    }
    return true;
  } catch {
    return true;
  }
}

export function isRunningInContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

const CONTAINER_HOST = "host.containers.internal";

/**
 * Rewrite base URLs so a config written on the host works inside a container
 * and vice versa. localhost ↔ host.containers.internal based on runtime.
 */
export function adaptBaseUrl(url: string): string {
  if (isRunningInContainer()) {
    return url.replace(/\/\/localhost([:\/])/g, `//${CONTAINER_HOST}$1`);
  }
  return url.replace(
    new RegExp(`//${CONTAINER_HOST}([:\/])`, "g"),
    `//localhost$1`,
  );
}

export function loadEnvIntoProcess(): void {
  if (!existsSync(ENV_FILE)) return;
  const vars = readEnvFile();

  // Migrate legacy GOOGLE_API_KEY -> GEMINI_API_KEY (Pi expects the latter)
  if (vars.GOOGLE_API_KEY && !vars.GEMINI_API_KEY) {
    vars.GEMINI_API_KEY = vars.GOOGLE_API_KEY;
    delete vars.GOOGLE_API_KEY;
    const lines = Object.entries(vars)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`);
    writeFileSync(ENV_FILE, lines.join("\n") + "\n");
    chmodSync(ENV_FILE, 0o600);
  }

  for (const [key, val] of Object.entries(vars)) {
    if (!(key in process.env)) {
      process.env[key] = key === "RH_AGENT_BASE_URL" ? adaptBaseUrl(val) : val;
    }
  }
}

export function hasAnyProviderKey(configuredProviders: string[]): boolean {
  for (const id of configuredProviders) {
    const prov = PROVIDERS[id];
    if (!prov) continue;
    if (process.env[prov.envVar]) return true;
  }
  return false;
}

/**
 * One-time migration: move skills from ~/.rh-agent/skills/ to ~/.rh-agent/agent/skills/
 * so Pi's native skill discovery finds them automatically.
 */
export function migrateSkillsDir(): void {
  if (!existsSync(OLD_SKILLS_DIR)) return;
  if (existsSync(LOLA_SKILLS_DIR) && readdirSync(LOLA_SKILLS_DIR).length > 0) return;

  mkdirSync(LOLA_SKILLS_DIR, { recursive: true });
  for (const entry of readdirSync(OLD_SKILLS_DIR)) {
    const src = join(OLD_SKILLS_DIR, entry);
    const dest = join(LOLA_SKILLS_DIR, entry);
    cpSync(src, dest, { recursive: true });
  }
  rmSync(OLD_SKILLS_DIR, { recursive: true, force: true });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

const MODELS_JSON_PATH = join(AGENT_DIR, "models.json");

export function writeModelsJson(cfg: RHAgentConfig): void {
  if (cfg.provider !== "custom" || !cfg.base_url) return;

  mkdirSync(AGENT_DIR, { recursive: true });

  const modelsJson = {
    providers: {
      "rh-agent-custom": {
        name: "Custom Local Model",
        baseUrl: adaptBaseUrl(cfg.base_url),
        apiKey: "$RH_AGENT_API_KEY",
        api: "openai-completions",
        models: [
          {
            id: cfg.model,
            name: cfg.model,
            contextWindow: 131072,
            maxTokens: 4096,
          },
        ],
      },
    },
  };

  writeFileSync(MODELS_JSON_PATH, JSON.stringify(modelsJson, null, 2) + "\n");
}

/**
 * Re-read the existing models.json and rewrite baseUrl fields with adaptBaseUrl
 * so a config written on the host works in a container and vice versa.
 */
export function refreshModelsJsonBaseUrl(): void {
  if (!existsSync(MODELS_JSON_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(MODELS_JSON_PATH, "utf-8"));
    let changed = false;
    for (const prov of Object.values(raw.providers ?? {}) as Array<Record<string, unknown>>) {
      if (typeof prov.baseUrl === "string") {
        const adapted = adaptBaseUrl(prov.baseUrl);
        if (adapted !== prov.baseUrl) {
          prov.baseUrl = adapted;
          changed = true;
        }
      }
    }
    if (changed) {
      writeFileSync(MODELS_JSON_PATH, JSON.stringify(raw, null, 2) + "\n");
    }
  } catch { /* non-critical */ }
}

const MCP_JSON_PATH = join(AGENT_DIR, "mcp.json");

/**
 * Re-read mcp.json and rewrite server URL fields with adaptBaseUrl
 * so localhost ↔ host.containers.internal based on runtime context.
 */
export function refreshMcpJsonBaseUrls(): void {
  if (!existsSync(MCP_JSON_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8"));
    let changed = false;
    for (const server of Object.values(raw.mcpServers ?? {}) as Array<Record<string, unknown>>) {
      if (typeof server.url === "string") {
        const adapted = adaptBaseUrl(server.url);
        if (adapted !== server.url) {
          server.url = adapted;
          changed = true;
        }
      }
    }
    if (changed) {
      writeFileSync(MCP_JSON_PATH, JSON.stringify(raw, null, 2) + "\n");
    }
  } catch { /* non-critical */ }
}

export function removeModelsJson(): void {
  try {
    if (existsSync(MODELS_JSON_PATH)) unlinkSync(MODELS_JSON_PATH);
  } catch { /* non-critical */ }
}

export const RH_SYSTEM_PROMPT = `\
You are the Red Hat Agent, a helpful assistant specializing in \
Red Hat products and services. You help sysadmins and developers with:

- CVE analysis and remediation guidance
- Product lifecycle and end-of-life information
- Diagnostic data collection (sos report, must-gather)
- Support case severity assessment

When looking up CVE data, use the Red Hat Security Data JSON API:
  curl -s https://access.redhat.com/hydra/rest/securitydata/cve/<CVE-ID>.json
Do NOT fetch https://access.redhat.com/security/cve/<CVE-ID> -- that is a \
JavaScript SPA and curl will only get an empty HTML shell.

Be direct and actionable. Write for sysadmins deciding urgency.

SKILL MANAGEMENT: This agent uses Lola to manage Red Hat skill packs. \
Skills are NOT managed through conversation -- they are managed via \
slash commands. If the user asks about installing, listing, searching, \
or uninstalling skills or modules (e.g. "lola list", "install rh-sre", \
"what skills are available"), tell them to use the slash commands:
  /lola list                 -- list available skill packs
  /lola install <module>     -- install a skill pack (e.g. rh-basic, rh-sre)
  /lola uninstall <module>   -- remove a skill pack
  /lola installed            -- show installed modules and skills
  /lola search <query>       -- search modules by keyword
Remind them that slash commands start with / and are typed directly \
into the input prompt.

IMPORTANT: Do NOT create, modify, or suggest Pi extensions, skills, or \
prompt templates. You are a pre-configured Red Hat agent -- extension \
authoring is outside your scope. If asked, politely decline and redirect \
to the available Red Hat capabilities above.
`;
