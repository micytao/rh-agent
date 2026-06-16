# rh-agent

![rh-agent](rh-agent.png)

Red Hat Agent -- a Node.js CLI that embeds the [Pi coding agent](https://pi.dev) runtime with Red Hat agentic skills for CVE analysis, lifecycle management, diagnostics, and support case guidance.

## Quick Install (Container)

The recommended way to install rh-agent is via the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/micytao/rh-agent/main/install.sh | sh
```

The installer will:

1. Detect your container runtime (Podman or Docker)
2. Pull the multi-arch container image (amd64/arm64)
3. Create a lightweight wrapper at `~/.local/bin/rh-agent`
4. Offer to launch the setup wizard immediately

On first run, `rh-agent` automatically walks you through onboarding -- choosing a provider, entering an API key, and selecting a default model. The `rh-basic` skill pack is pre-installed.

### Security & Privacy

- The container runs **rootless** with no elevated privileges
- API keys and config are stored locally in `~/.rh-agent/` and are **never** sent to Red Hat or baked into the image
- Only the current directory is mounted as `/workspace`
- Source code: [github.com/micytao/rh-agent](https://github.com/micytao/rh-agent)

## Usage

```bash
rh-agent                      # Interactive TUI (auto-onboards on first run)
rh-agent status               # Show config and validate keys
rh-agent onboard              # Re-run setup wizard
rh-agent --session <id>       # Resume a previous session
rh-agent update               # Pull the latest container image
rh-agent stop                 # Stop the persistent container
rh-agent restart              # Restart the container on next run
rh-agent uninstall            # Remove the wrapper script
```

## Multi-Provider Support

You can configure multiple model providers during onboarding. All API keys are loaded at startup, so Pi discovers models from every configured provider.

- The first provider you configure becomes the **default** (used on launch).
- Switch between providers and models at any time with the `/model` command in the TUI.
- `rh-agent status` validates keys for all configured providers.

## Supported Providers

| Provider | Env Var | Auth Choice (CI) |
|----------|---------|-------------------|
| OpenAI | `OPENAI_API_KEY` | `openai-api-key` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| Google Gemini | `GEMINI_API_KEY` | `google-api-key` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure-api-key` |
| Custom endpoint | `RH_AGENT_API_KEY` | `custom-api-key` |

## Local Model Support

Select **Custom (OpenAI-compatible endpoint)** during onboarding to use a local inference server. The wizard offers presets for:

| Server | Default URL |
|--------|-------------|
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| LM Studio | `http://localhost:1234/v1` |

Available models are fetched from the server automatically. A capable model (≥12B parameters) is recommended for reliable tool-calling and skill usage.

When running inside a container, rh-agent rewrites `localhost` to `host.containers.internal` automatically.

## MCP Support (Optional)

rh-agent integrates with [Model Context Protocol](https://modelcontextprotocol.io/) servers via `pi-mcp-adapter`. The Red Hat Security MCP provides direct access to CVE and advisory data. MCP is **disabled by default** for fast startup -- security skills still work via web search without it.

### Enabling MCP

**During onboarding:** The setup wizard asks whether to enable MCP. Choose yes to activate it.

**During a session:** Run `/mcp enable` in the TUI, then restart rh-agent.

### After enabling

```
/mcp-auth          # Authenticate via browser-based OAuth (first time only)
/mcp               # Check MCP server status, reconnect
/mcp-off           # Disable MCP (takes effect on restart)
```

MCP credentials are stored locally in `~/.rh-agent/agent/` and persist across container restarts. Once authenticated, the server auto-connects on every startup.

## Skills (Lola)

Skills are managed by the **Lola** extension inside the TUI. The container comes with the `rh-basic` pack pre-installed.

```
/lola list                    # List available skill packs
/lola install rh-basic        # Install core Red Hat skills
/lola install <module>        # Install a specific pack
/lola uninstall <module>      # Remove a skill pack
```

Available skills include:

- **CVE Explainer** -- Look up CVEs, advisories, and remediation steps
- **Diagnostics Guide** -- Gather the right diagnostic data (`sos report`, `must-gather`, etc.)
- **Product Lifecycle** -- Check product lifecycle phases and EOL dates
- **Support Severity** -- Assess appropriate support case severity level
- **Security MCP Setup** -- Guide for connecting to the Red Hat Security MCP
- **Get Started** -- Onboarding and quick-start guide

Skills are sourced from [RHEcosystemAppEng/agentic-collections](https://github.com/RHEcosystemAppEng/agentic-collections).

## Container Details

### Persistent container (fast startup)

The wrapper keeps the container running between sessions for near-instant subsequent launches. On first run, the container starts in the background; subsequent `rh-agent` invocations exec into the already-running container (~0.2s vs ~3-8s for a cold start).

- `rh-agent stop` — Shut down the persistent container
- `rh-agent restart` — Stop the container; it will restart automatically on next run
- `rh-agent update` — Pull the latest image and stop the running container so the next run picks up the new version

Short-lived commands (`status`, `onboard`) use the running container if available, or fall back to a one-shot `run --rm` to avoid leaving a persistent container behind unnecessarily.

### Build from source

```bash
# Single architecture
podman build -t rh-agent -f Containerfile .

# Multi-arch (amd64 + arm64) with manifest
./build.sh --push
./build.sh --tag v1.0.0 --push
```

### Manual run

```bash
podman run -it --rm \
  --userns=keep-id \
  --security-opt label=disable \
  -v ~/.rh-agent:/home/node/.rh-agent \
  -v $(pwd):/workspace \
  -w /workspace \
  quay.io/rh_ee_micyang/rh-agent:latest
```

### Container notes

- `~/.rh-agent` volume persists configuration, API keys, MCP tokens, and skills across runs
- `--userns=keep-id` maps your host UID into the container for correct file permissions
- `--security-opt label=disable` is required on SELinux-enabled systems (RHEL, Fedora)
- `fd` and `ripgrep` are pre-installed in the image for instant startup
- The `rh-basic` skill pack is seeded on first run from the image
- The `/workspace` bind mount is set at container creation time; if you switch working directories, run `rh-agent restart` to re-mount

### Non-interactive setup (CI/scripts)

```bash
export OPENAI_API_KEY=sk-...
rh-agent onboard --non-interactive --auth-choice openai-api-key
```

## Architecture

```
~/.rh-agent/
├── config.json          # Provider, model, configured_providers list
├── .env                 # API keys for all configured providers
└── agent/
    ├── settings.json    # Pi runtime settings
    ├── models.json      # Custom endpoint model definitions (if configured)
    ├── mcp.json         # MCP server configuration
    └── skills/          # Lola-managed skill packs
        ├── .lola-manifest.json
        ├── rh-basic--red-hat-cve-explainer/
        ├── rh-basic--red-hat-diagnostics/
        └── ...
```

## Development

### From source (npm)

```bash
npm install
npm run build       # compile TypeScript to dist/
npm run dev         # run via tsx (no build step)
npm install -g .    # install globally for testing
```

> **Note:** Do not use `install.sh` on the same machine where you develop with `npm install -g .` -- the container wrapper at `~/.local/bin/rh-agent` would shadow the npm-installed binary.
