import { c } from "./ansi.js";
import { select, password, confirm, input } from "./prompt.js";
import {
  CONFIG_DIR,
  PROVIDERS,
  LOLA_SKILLS_DIR,
  RH_CLIENT_ID_ENV,
  RH_CLIENT_SECRET_ENV,
  RH_SERVICE_ACCOUNT_PAGE,
  type RHAgentConfig,
  loadConfig,
  saveConfig,
  saveEnvKey,
  resolveApiKey,
  resolveRhServiceAccount,
  validateRhServiceAccount,
  validateApiKey,
  maskKey,
} from "./config.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function detectEnvKey(providerId: string): string | undefined {
  return process.env[PROVIDERS[providerId].envVar] || undefined;
}

async function promptProvider(): Promise<string> {
  return select({
    message: "Choose your model provider:",
    choices: Object.entries(PROVIDERS).map(([id, p]) => ({
      name: p.label,
      value: id,
    })),
  });
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

async function promptExtraEnvVars(
  providerId: string,
): Promise<Record<string, string>> {
  const prov = PROVIDERS[providerId];
  const extras: Record<string, string> = {};
  for (const [varName, description] of Object.entries(
    prov.extraEnvVars ?? {},
  )) {
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

async function promptModel(providerId: string): Promise<string> {
  const prov = PROVIDERS[providerId];
  if (!prov.models.length) {
    while (true) {
      const model = await input({ message: "Enter model name:" });
      if (model.trim()) return model.trim();
      console.log(c.red("  Model name cannot be empty."));
    }
  }

  return select({
    message: "Choose default model:",
    choices: prov.models.map((m) => ({
      name: m === prov.defaultModel ? `${m}  (default)` : m,
      value: m,
    })),
    default: prov.defaultModel ?? prov.models[0],
  });
}

async function promptRhAuth(): Promise<{
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
}> {
  console.log(
    c.bold("\n  Red Hat Service Account") +
      "\n  The CVE Explainer skill can optionally use a Red Hat service" +
      " account (Client ID + Client Secret) for enhanced data access." +
      "\n  Without one, CVE lookups fall back to public data only.",
  );

  const choice = await select({
    message: "Do you have a Red Hat service account?",
    choices: [
      {
        name: "Yes -- configure Client ID and Client Secret now",
        value: "configure" as const,
      },
      { name: "No -- show me how to create one", value: "create" as const },
      { name: "Skip -- I'll set it up later", value: "skip" as const },
    ],
  });

  if (choice === "skip") return { enabled: false };

  if (choice === "create") {
    console.log(
      c.bold("\n  Create a service account at:") +
        `\n    ${c.cyan(RH_SERVICE_ACCOUNT_PAGE)}` +
        "\n" +
        "\n  Steps:" +
        `\n    1. Log in to ${c.cyan("console.redhat.com")}` +
        "\n    2. Go to Settings (gear icon) > Service Accounts" +
        `\n    3. Click ${c.bold("Create service account")}` +
        `\n    4. Copy the ${c.bold("Client ID")} and ${c.bold("Client Secret")}` +
        "\n    5. Add the service account to a User Access group with the required roles" +
        "\n" +
        `\n  ${c.dim("Then re-run")} ${c.boldCyan("rh-agent onboard")}${c.dim(" to configure authentication.")}`,
    );
    return { enabled: false };
  }

  const [existingId, existingSecret] = resolveRhServiceAccount();
  if (existingId && existingSecret) {
    console.log(
      c.green("\n  Found existing credentials:") +
        `\n    Client ID: ${existingId}` +
        `\n    Client Secret: ${maskKey(existingSecret)}`,
    );
    const useExisting = await confirm({
      message: "Use these credentials?",
      default: true,
    });
    if (useExisting) {
      return { enabled: true, clientId: existingId, clientSecret: existingSecret };
    }
  }

  console.log(
    c.bold("\n  Enter your Red Hat service account credentials.") +
      `\n  ${c.dim(`Create one at: ${RH_SERVICE_ACCOUNT_PAGE}`)}`,
  );

  while (true) {
    const clientId = (await input({ message: "Client ID:" })).trim();
    if (!clientId) {
      console.log(c.red("  Client ID cannot be empty."));
      continue;
    }

    const clientSecret = (await password({ message: "Client Secret:" })).trim();
    if (!clientSecret) {
      console.log(c.red("  Client Secret cannot be empty."));
      continue;
    }

    process.stdout.write("  Validating service account... ");
    const [ok, msg] = await validateRhServiceAccount(clientId, clientSecret);
    if (ok) {
      console.log(c.boldGreen(msg));
      return { enabled: true, clientId, clientSecret };
    }
    console.log(c.boldRed("FAILED") + ` (${msg})`);
    const retry = await confirm({
      message: "Validation failed. Try again?",
      default: true,
    });
    if (!retry) return { enabled: false };
  }
}

function showCurrentConfig(cfg: RHAgentConfig): void {
  const prov = PROVIDERS[cfg.provider];
  console.log("\n  Current Configuration:");
  console.log(`    Provider:      ${prov?.label ?? cfg.provider}`);
  console.log(`    Model:         ${cfg.model}`);
  console.log(
    `    Red Hat Auth:  ${cfg.rh_auth ? "Configured" : "Not configured"}`,
  );
  console.log(`    API Key Source: ${cfg.api_key_source}`);
  if (cfg.base_url) console.log(`    Base URL:      ${cfg.base_url}`);
  console.log(`    Config Dir:    ${CONFIG_DIR}`);
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
    `\n  ${c.bold("Ready!")} Try:  ${c.cyan('rh-agent "Is CVE-2024-6387 critical?"')}\n`,
  );
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

  const providerId = await promptProvider();
  const apiKey = await promptApiKey(providerId);
  const extras = await promptExtraEnvVars(providerId);
  const model = await promptModel(providerId);
  const rhAuth = await promptRhAuth();

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
    if (!saveAnyway) {
      console.log(c.red("  Onboarding cancelled."));
      return false;
    }
  }

  const prov = PROVIDERS[providerId];
  saveEnvKey(prov.envVar, apiKey);
  for (const [k, v] of Object.entries(extras)) saveEnvKey(k, v);
  if (rhAuth.clientId && rhAuth.clientSecret) {
    saveEnvKey(RH_CLIENT_ID_ENV, rhAuth.clientId);
    saveEnvKey(RH_CLIENT_SECRET_ENV, rhAuth.clientSecret);
  }

  const cfg: RHAgentConfig = {
    provider: providerId,
    model,
    mcp_enabled: true,
    api_key_source: "env",
    base_url: extras.RH_AGENT_BASE_URL,
    rh_auth: rhAuth.enabled,
    extra: Object.fromEntries(
      Object.entries(extras).filter(([k]) => k !== "RH_AGENT_BASE_URL"),
    ),
  };
  saveConfig(cfg);
  console.log(c.green(`\n  Config saved to ${CONFIG_DIR}/`));

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

  const rhClientId = process.env[RH_CLIENT_ID_ENV];
  const rhClientSecret = process.env[RH_CLIENT_SECRET_ENV];
  if (rhClientId) saveEnvKey(RH_CLIENT_ID_ENV, rhClientId);
  if (rhClientSecret) saveEnvKey(RH_CLIENT_SECRET_ENV, rhClientSecret);

  const cfg: RHAgentConfig = {
    provider: providerId,
    model: prov.defaultModel ?? "gpt-4o",
    mcp_enabled: true,
    api_key_source: "env",
    base_url: extras.RH_AGENT_BASE_URL,
    rh_auth: !!(rhClientId && rhClientSecret),
    extra: Object.fromEntries(
      Object.entries(extras).filter(([k]) => k !== "RH_AGENT_BASE_URL"),
    ),
  };
  saveConfig(cfg);
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

  const prov = PROVIDERS[cfg.provider];
  const envVar = prov?.envVar ?? "";
  const key = resolveApiKey(cfg.provider);

  console.log();
  if (key) {
    console.log(`  API Key (${envVar}): ${c.green(maskKey(key))}`);
    process.stdout.write("  Validating API key... ");
    const ok = await validateApiKey(cfg.provider, key);
    console.log(ok ? c.boldGreen("OK") : c.boldRed("FAILED"));
  } else {
    console.log(`  API Key (${envVar}): ${c.red("NOT SET")}`);
  }

  const [rhId, rhSecret] = resolveRhServiceAccount();
  if (rhId && rhSecret) {
    console.log(
      `  Red Hat Service Account: ${c.green("Configured")} (Client ID: ${rhId})`,
    );
    process.stdout.write("  Validating credentials... ");
    const [ok, msg] = await validateRhServiceAccount(rhId, rhSecret);
    console.log(ok ? c.green(msg) : c.red(msg));
  } else {
    console.log(
      c.dim(
        "  Red Hat Service Account: Not configured (run rh-agent onboard to set up)",
      ),
    );
  }

  const skillCount = countSkills();
  console.log(
    skillCount > 0
      ? `  Skills: ${c.green(`${skillCount} installed`)} (via Lola)`
      : `  Skills: ${c.yellow("None")} -- run /lola install rh-basic in the TUI`,
  );

  console.log();
}
