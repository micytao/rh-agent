# rh-agent

Red Hat Agent -- a Node.js CLI that embeds the [Pi coding agent](https://pi.dev) runtime with Red Hat agentic skills for CVE analysis, lifecycle management, diagnostics, and support case guidance.

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js 18+** | Runs the rh-agent CLI and Pi runtime | [nodejs.org](https://nodejs.org) |

## Install

```bash
npm install -g .
```

Or run directly without global install:

```bash
npx rh-agent
```

## Quick Start

### 1. Onboard

```bash
rh-agent onboard
```

The wizard walks you through:

- **Default provider and model** -- OpenAI, Anthropic, Google Gemini, Azure OpenAI, or a custom OpenAI-compatible endpoint (Ollama, vLLM, LM Studio)
- **Additional providers** -- configure as many as you like; switch between them in the TUI with `/model`
- **API key entry** -- auto-detects keys already in your environment

If no configuration exists, `rh-agent` launches the wizard automatically on first run.

### 2. Run a query

```bash
rh-agent "Is CVE-2024-6387 critical?"
```

### 3. Interactive chat

```bash
rh-agent
```

### 4. Non-interactive setup (CI/scripts)

```bash
export OPENAI_API_KEY=sk-...
rh-agent onboard --non-interactive --auth-choice openai-api-key
```

## Usage

```bash
rh-agent                      # Interactive TUI
rh-agent "query"              # Single-query mode
rh-agent status               # Show config and validate keys
rh-agent onboard              # Re-run setup wizard
rh-agent --model gpt-4.1 "q"  # Override model for one run
rh-agent --session <id>        # Resume a previous session
```

## Multi-Provider Support

You can configure multiple model providers during onboarding. All API keys are loaded at startup, so Pi discovers models from every configured provider.

- The first provider you configure becomes the **default** (used on launch).
- Switch between providers and models at any time with the `/model` command in the TUI.
- `rh-agent status` validates keys for all configured providers.

## Local Model Support

Select **Custom (OpenAI-compatible endpoint)** during onboarding to use a local inference server. The wizard offers presets for:

| Server | Default URL |
|--------|-------------|
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| LM Studio | `http://localhost:1234/v1` |

Available models are fetched from the server automatically. A capable model (≥12B parameters) is recommended for reliable tool-calling and skill usage.

## Supported Providers

| Provider | Env Var | Auth Choice (CI) |
|----------|---------|-------------------|
| OpenAI | `OPENAI_API_KEY` | `openai-api-key` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| Google Gemini | `GEMINI_API_KEY` | `google-api-key` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure-api-key` |
| Custom endpoint | `RH_AGENT_API_KEY` | `custom-api-key` |

## Skills (Lola)

Skills are managed by the **Lola** extension inside the TUI. They are installed to `~/.rh-agent/agent/skills/` and persist across sessions.

```
/lola list                    # List available skill packs
/lola install rh-basic        # Install core Red Hat skills
/lola install <module>        # Install a specific pack
```

Available skills include:

- **CVE Explainer** -- Look up CVEs, advisories, and remediation steps
- **Diagnostics Guide** -- Gather the right diagnostic data (`sos report`, `must-gather`, etc.)
- **Product Lifecycle** -- Check product lifecycle phases and EOL dates
- **Support Severity** -- Assess appropriate support case severity level

Skills are sourced from [RHEcosystemAppEng/agentic-collections](https://github.com/RHEcosystemAppEng/agentic-collections).

## Container

### Quick install (recommended)

Run the one-liner to install a `rh-agent` wrapper that uses Podman or Docker under the hood:

```bash
curl -sSL https://raw.githubusercontent.com/RHEcosystemAppEng/rh-agent/main/install.sh | sh
```

Then use it exactly like the native CLI:

```bash
rh-agent                    # interactive TUI
rh-agent onboard            # setup wizard
rh-agent "query"            # single query
```

To uninstall: `rm ~/.local/bin/rh-agent`

### Build from source

```bash
podman build -t rh-agent -f Containerfile .

podman run -it --rm \
  -v ~/.rh-agent:/home/node/.rh-agent \
  -v $(pwd):/workspace \
  -w /workspace \
  rh-agent
```

### Notes

- The `~/.rh-agent` volume mount persists configuration, API keys, and skills across runs.
- The workspace mount (`-v $(pwd):/workspace`) lets session exports and file operations work on your host filesystem.
- The container comes with the `rh-basic` skill pack pre-installed.
- Local model endpoints (Ollama, vLLM, etc.) work automatically -- rh-agent rewrites `localhost` to `host.containers.internal` at runtime when running inside a container.

## Architecture

```
~/.rh-agent/
├── config.json          # Provider, model, configured_providers list
├── .env                 # API keys for all configured providers
└── agent/
    ├── settings.json    # Pi runtime settings
    ├── models.json      # Custom endpoint model definitions (if configured)
    └── skills/          # Lola-managed skill packs
        ├── rh-basic/
        └── ...

rh-agent onboard
    ├── Configure one or more providers + API keys  →  config.json, .env
    └── Custom endpoint → models.json

rh-agent / rh-agent "query"
    ├── Load config + ALL provider keys into process.env
    ├── Launch Pi via main() with:
    │     Default provider + model
    │     System prompt (Red Hat persona)
    │     rh-agent branding extension
    │     Lola skill extension
    └── Pi's ModelRegistry discovers all providers → /model to switch
```

## Development

```bash
npm install
npm run build       # compile TypeScript to dist/
npm run dev         # run via tsx (no build step)
npm link            # link globally for testing
```
