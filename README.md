# rh-agent

Red Hat Agent -- a Node.js CLI that embeds the [Pi coding agent](https://pi.dev) runtime with bundled Red Hat skills for CVE analysis, lifecycle management, diagnostics, and support case guidance.

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

### 1. Onboard (interactive setup)

```bash
rh-agent onboard
```

The wizard walks you through:
- LLM provider and model selection (OpenAI, Anthropic, Google, Azure, custom)
- API key entry (auto-detects from environment)
- Red Hat service account setup (Client ID + Client Secret for CVE/advisory access)

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
# Interactive Pi session
rh-agent

# Single query
rh-agent "What's the lifecycle status of RHEL 8?"

# Check setup
rh-agent status

# Override model for one run
rh-agent --model gpt-4.1 "Diagnose my OpenShift cluster"
```

## Red Hat Service Account

The CVE Explainer skill can optionally use a [Red Hat service account](https://console.redhat.com/iam/service-accounts) (Client ID + Client Secret) for enhanced CVE, advisory, and errata data access.

### Setup

1. Log in to [console.redhat.com](https://console.redhat.com)
2. Go to **Settings** (gear icon) > **Service Accounts**
3. Click **Create service account** and copy the **Client ID** and **Client Secret**
4. Add the service account to a User Access group with required roles

During `rh-agent onboard`, you'll be prompted to enter these credentials. They are stored securely in `~/.rh-agent/.env`.

For non-interactive/CI setups, set `RH_CLIENT_ID` and `RH_CLIENT_SECRET` in the environment before running onboard.

## Supported Providers

| Provider | Env Var | Auth Choice |
|----------|---------|-------------|
| OpenAI | `OPENAI_API_KEY` | `openai-api-key` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| Google Gemini | `GOOGLE_API_KEY` | `google-api-key` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure-api-key` |
| Custom endpoint | `RH_AGENT_API_KEY` | `custom-api-key` |

## Bundled Skills

These Red Hat skills are bundled inside the package and automatically loaded into every Pi session:

- **CVE Explainer** -- Look up CVEs, advisories, and remediation steps
- **Diagnostics Guide** -- Gather the right diagnostic data (`sos report`, `must-gather`, etc.)
- **Product Lifecycle** -- Check product lifecycle phases and EOL dates
- **Support Severity** -- Assess appropriate support case severity level

Skills are sourced from [RHEcosystemAppEng/agentic-collections](https://github.com/RHEcosystemAppEng/agentic-collections).

## Architecture

```
rh-agent onboard
    |
    +--> Provider / model config               -->  ~/.rh-agent/config.json
    +--> API key + RH service account creds    -->  ~/.rh-agent/.env

rh-agent "query"
    |
    +--> Load config + env vars
    +--> Launch Pi via main() with:
    |     - Provider + model from config
    |     - Skills from bundled src/skills/
    |     - System prompt for Red Hat persona
    |     - rh-agent branding extension
    +--> Stream response to terminal (print mode)

rh-agent (interactive)
    |
    +--> Same setup, but Pi's full TUI mode
    +--> Panels, markdown, tool viz, streaming
```

## Development

```bash
npm install
npm run build       # compile TypeScript to dist/
npm run dev         # run via tsx (no build step)
npm link            # link globally for testing
```
