# PMO Agent

Phase 1 builds a PMO status-audit CLI for the MAAS platform.

The main object is a Feishu Project story in the `MAAS_平台` space. GitLab `dev.aminer.cn/open-platform` is treated as delivery evidence, not as the source of project truth.

## Current Capabilities

- Reads GitLab `open-platform` projects, merge requests, commits, and pipelines.
- Normalizes Feishu Project MCP story records into a stable `Story` model.
- Matches GitLab evidence to stories by story id, story link, title keywords, branch text, commit/MR text, and owner hints.
- Detects missing goal, owner, schedule, test plan, next step, stale status, failed pipeline, blocked MR, and delivery/status mismatch risks.
- Renders a Markdown PMO audit report and writes a local backup under `reports/`.
- Can create a Feishu document through `lark-mcp` after Feishu user OAuth is valid.

## Setup

```bash
pnpm install
cp .env.example .env.local
```

Set `GITLAB_TOKEN` in `.env.local`, or rely on the existing macOS git credential for `dev.aminer.cn`.

Feishu Project MCP must be enabled for the `MAAS_平台` space before real stories can be read:

- MCP URL: `https://project.feishu.cn/mcp_server/v1`
- Space: `MAAS_平台`
- Space URL: `https://project.feishu.cn/7358164361912909827_1719375156/story/homepage`

The CLI intentionally fails with setup instructions if Feishu Project MCP is not authorized. It does not use fake data unless `--stories-fixture` is explicitly provided.

## Commands

Run tests:

```bash
pnpm test
```

Type-check:

```bash
pnpm build
```

Run a local development audit with fixture stories and real GitLab evidence:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --dry-run \
  --stories-fixture tests/fixtures/stories.json \
  --max-projects 3
```

Run against real Feishu Project MCP:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --dry-run
```

Create a Feishu document report after both Feishu Project MCP and `lark-mcp` OAuth are authorized:

```bash
FEISHU_PROJECT_MCP_URL=https://project.feishu.cn/mcp_server/v1 \
pnpm pmo:audit -- --date 2026-05-31 --output feishu-doc
```

## Safety Boundaries

Phase 1 is read-only for Feishu Project, GitLab, and Feishu IM.

- It does not send Feishu messages.
- It does not update Feishu Project fields.
- It does not write GitLab comments.
- It only creates a Feishu document when `--output feishu-doc` is requested.
