# PMO Agent Requirements

Status: Draft for confirmation  
Date: 2026-05-31  
Repo: `hongliang-zhang/pmo_agent`  
Runtime basis: `z-mono` Agent Runtime

## 1. Product Thesis

PMO Agent should be a low-interruption project intelligence agent for the MaaS platform.

It should answer two recurring questions:

1. Across the whole MaaS platform, what changed today, in which repos, by whom, and what product or engineering capability did those changes advance?
2. Across the whole MaaS platform, what is each person working on, what is the current progress, what risks exist, and what happens next?

The core product value is not a prettier commit digest. The agent should convert scattered engineering signals into a project-management state model: workstreams, owners, progress, blockers, risks, next milestones, and confidence level. It should ask people only when passive evidence is insufficient or contradictory.

## 2. Current Context

### 2.1 GitHub target

The PMO Agent repo is connected at:

- GitHub repo: https://github.com/hongliang-zhang/pmo_agent
- Local checkout: `/Users/zhanghongliang/Documents/PMO agent/pmo_agent`

The repository is currently empty, so this document is the first product artifact.

### 2.2 z-mono as the agent core

The local z-mono repo is a pnpm monorepo at:

- `/Users/zhanghongliang/Documents/ai_emoloyee_platform_2/z-mono`

The relevant runtime shape:

- `packages/dispatcher`: receives IM events, normalizes messages, deduplicates receipts, creates sandbox runtimes, and returns replies to IM.
- `packages/gateway`: trusted sandbox-facing API for session events, LLM proxy, storage, and action proxy.
- `packages/actions`: trusted third-party integration service. This is the right place to add GitHub, GitLab, Feishu, calendar, and code-intelligence actions.
- `packages/agent-sdk`: lets an agent running in sandbox use gateway, persistent files, LLM adapter, and dynamically fetched action schemas.
- `packages/db`: current platform state is focused on agents, IM configs, conversations, session events, and IM message receipts.
- `packages/ai-employee-platform`: polished product prototype for AI employee workflows, but many surfaces should be treated as mock-driven until backend wiring is verified.

Important architectural constraints inherited from z-mono:

- Sandbox is untrusted and must not receive platform secrets.
- Gateway is the trusted chokepoint for all sandbox-accessible platform capabilities.
- Third-party credentials belong in Actions Service, not in sandbox and preferably not directly in gateway.
- Session events should become the append-only trace of user messages, assistant responses, tool calls, and tool results.
- New PMO integrations should extend Actions Service and storage schema without breaking dispatcher/gateway trust boundaries.

## 3. External Integration Research

GitHub is the first integration because the requested product starts from repo activity. The design should use event ingestion plus scheduled reconciliation.

Relevant GitHub capabilities:

- Webhooks can deliver `push`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `issues`, `deployment`, `deployment_status`, `status`, `workflow_job`, and `workflow_run` events. These cover code movement, review, issue state, deployment state, and CI state. Source: GitHub webhook event docs, https://docs.github.com/en/webhooks/webhook-events-and-payloads
- `push` events represent activity on a branch including commits, tags, branch deletion, or template-created repos. `pull_request` events represent activity on PRs, with separate events for review comments, reviews, and review threads.
- The commits REST API supports listing commits, getting a single commit, finding PRs associated with a commit, and comparing two refs. Compare responses need pagination for large ranges; changed files are only included on the first page and limited for the full comparison. Source: GitHub commits REST docs, https://docs.github.com/en/rest/commits/commits
- GraphQL commit objects expose `associatedPullRequests`, which helps connect raw commits to merged PRs or open PRs when commits are not yet on the default branch. Source: GitHub GraphQL commits docs, https://docs.github.com/en/graphql/reference/commits
- For production automation, a GitHub App is better than a long-lived personal token: GitHub notes that GitHub App installation-token rate limits scale with repositories and organization users. Source: GitHub REST rate limit docs, https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- Webhook security should use a secret and verify `X-Hub-Signature-256`, and processing should use delivery IDs for idempotency and redelivery handling. Source: GitHub webhook best practices, https://docs.github.com/webhooks/using-webhooks/best-practices-for-using-webhooks and https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries

Because z-mono itself is currently connected to GitLab (`https://dev.aminer.cn/open-platform/z-mono.git`), the PMO Agent should be designed as multi-SCM from day one:

- Phase 1 can implement GitHub first because `pmo_agent` lives on GitHub.
- The domain model should call the source `scm_provider`, not `github`.
- GitLab support should be a provider module with the same normalized event model.

## 4. Product Principles

1. Passive first, interrupt last.
   The agent should infer from commits, PRs, issues, reviews, CI, deployment events, docs, and prior conversations before asking a person.

2. Evidence before summary.
   Every project status should link to source evidence: PR, commit, issue, deployment, CI run, doc, or check-in answer.

3. Confidence is first-class.
   The agent should say “confirmed”, “likely”, or “unknown” rather than present guesses as facts.

4. People are not repos.
   A person’s status is inferred from workstreams, ownership, review activity, blockers, and planned next steps, not just commit count.

5. Change summaries should be product-aware.
   The summary should map repo changes to MaaS platform capabilities: runtime, gateway, dispatcher, actions, SDK, dashboard, agent templates, reliability, infra, security, and product UI.

6. PMO is a state system, not a chat assistant.
   Chat is one interface. The real asset is a continuously updated project graph.

## 5. Core User Stories

### 5.1 Daily repo intelligence

As a PM / platform lead, I want to ask:

- “今天 MaaS 平台有哪些 repo 更新？”
- “每个 repo 谁更新了，更新了什么？”
- “哪些更新是功能，哪些是 bugfix / infra / refactor / docs？”
- “哪些改动可能影响发布、稳定性、安全或架构边界？”
- “今天有哪些 PR 还卡着？”

Expected output:

- Repo-level summary grouped by product area.
- Author / reviewer / merger attribution.
- PR and commit evidence links.
- Change category and risk rating.
- Notable files and affected modules.
- Release/deploy impact if CI/deployment data exists.

### 5.2 People progress intelligence

As a PM / lead, I want to ask:

- “每个人最近在做什么？”
- “当前进展如何？”
- “有什么风险？”
- “下一步预计什么时候？”
- “谁可能需要帮助或决策？”

Expected output:

- Person-level workstream list.
- Evidence-backed progress.
- Blockers and risk signals.
- Next expected action and time.
- Confidence level.
- Suggested minimal follow-up questions only when needed.

### 5.3 Low-interruption check-ins

As a team member, I should not be spammed by the PMO Agent.

The agent should only ask me when:

- I own a workstream with no fresh evidence for a configured threshold.
- A PR, CI, deployment, or review signal contradicts the current status.
- A deadline is near and next-step evidence is missing.
- A blocker is likely but not confirmed.
- A human decision is required.

The check-in should be short and answerable in one message:

- “我看到你在做 gateway session events，PR 还没合并。当前是开发中、等 review、还是被问题卡住？预计下一步时间是？”

The agent should avoid asking:

- When a person pushed commits or updated a PR recently and the state is clear.
- When another source already answered the same question.
- Multiple questions to the same person in a short quiet window.

## 6. Functional Requirements

### 6.1 Repo registry

The agent needs a managed list of MaaS platform repos.

Required fields:

- Provider: `github`, later `gitlab`.
- Owner / org / project path.
- Repo name.
- Default branch.
- Product area.
- Criticality: high / medium / low.
- Ownership hints: team, primary owner, fallback owner.
- Ingestion mode: webhook, scheduled poll, manual.
- Active status: active / archived / ignored.

Initial config should support manual YAML/JSON because repo discovery can be noisy.

### 6.2 SCM event ingestion

The system should ingest:

- Push events.
- PR opened / synchronized / reopened / closed / merged.
- PR review submitted.
- PR review comments and unresolved threads.
- Issue creation / update / close if issues are used for work tracking.
- CI status and workflow run events.
- Deployment and deployment status events.
- Repository created / archived / visibility changed events.

Ingestion must be idempotent:

- Store provider delivery ID.
- Store provider event ID and raw payload hash.
- Allow redelivery replay.
- Never process the same delivery twice as a new event.

### 6.3 Scheduled reconciliation

Webhooks are not enough. The agent should also run scheduled reconciliation:

- List recent commits per repo since last checkpoint.
- Compare default branch checkpoint to current head.
- Fetch PRs updated since last checkpoint.
- Fetch associated PRs for orphan commits.
- Fetch workflow/deployment status for changed refs.
- Backfill missing events after downtime.

### 6.4 Change understanding

For each repo update, the agent should infer:

- What changed: concise functional summary.
- Why it likely changed: based on PR title/body, issue links, commit messages, touched files, tests, docs.
- Affected area: runtime, gateway, dispatcher, actions, SDK, DB, sandbox, UI, infra, docs, tests.
- Change type: feature, bugfix, reliability, security, refactor, docs, test, dependency, config.
- Risk level: low / medium / high.
- Evidence links.
- Whether the change needs human review in the digest.

For large diffs, the first version should summarize metadata and changed files, then fetch patch details selectively for high-impact files.

### 6.5 Project/workstream model

The agent should normalize activities into workstreams.

Workstream fields:

- Title.
- Product area.
- Owning person.
- Supporting people.
- Linked repos.
- Linked PRs / issues / commits / docs.
- Status: not started, active, waiting review, blocked, at risk, done, shipped.
- Progress: narrative plus optional percentage if evidence supports it.
- Current milestone.
- Next step.
- Next expected time.
- Risks.
- Confidence.
- Last evidence timestamp.

Workstream creation should start from PRs/issues/branch names and be refined by agent summaries.

### 6.6 People state model

The agent should maintain a person profile:

- GitHub/GitLab usernames and emails.
- Feishu/IM identity later.
- Default team / role.
- Current workstreams.
- Recent authored commits.
- Recent PRs opened/updated/merged.
- Reviews requested / completed.
- Blocking dependencies.
- Check-in history and quiet hours.

The output should distinguish:

- Author: wrote commits.
- PR owner: owns delivery.
- Reviewer: unblocks or blocks others.
- Merger/releaser: shipped change.
- Mentioned/stakeholder: involved but not necessarily owner.

### 6.7 Risk detection

Risk signals:

- High criticality repo changed without PR or review.
- PR has unresolved review threads.
- CI failing or pending beyond threshold.
- Deployment failed or stale.
- Large diff in gateway/auth/db/actions/sandbox files.
- Migration changed.
- Secrets/config/deploy files touched.
- Workstream has no evidence update near deadline.
- Multiple people blocked on one reviewer.
- Repeated force-push / revert / hotfix patterns.
- z-mono architecture boundary risk, for example sandbox directly accessing DB or actions directly.

Risk output should include:

- Signal.
- Evidence.
- Severity.
- Suggested next action.
- Whether to interrupt someone.

### 6.8 Digest and query interfaces

Daily digest should include:

- Executive summary.
- Repo update table.
- Product-area summary.
- Person progress table.
- Risks and blockers.
- Decisions needed.
- “No need to ask” items where evidence is sufficient.
- Suggested check-ins.

Ad hoc queries should support:

- “今天/昨天/本周 maas 有什么变化？”
- “z-mono 今天谁动了什么？”
- “某个人当前在做什么？”
- “哪些项目有风险？”
- “哪些 PR 卡住？”
- “某个模块最近变化原因是什么？”

### 6.9 Minimal check-in engine

The agent should decide whether to ask based on:

- Evidence freshness.
- Workstream criticality.
- Deadline proximity.
- Contradiction level.
- Person quiet hours.
- Recent questions count.
- Whether a team-level answer already covers it.

Question budget:

- Default max 1 question per person per day.
- Default max 3 questions per daily digest cycle.
- Escalation allowed for high severity release/security risk.

Question style:

- One short message.
- Include what the agent already knows.
- Ask for a structured answer: status, blocker, next step, ETA.
- Avoid generic “进展如何”.

## 7. Non-Functional Requirements

### 7.1 Security

- Use GitHub App installation tokens in production rather than long-lived PATs.
- Store provider credentials only in trusted service/action environment.
- Verify webhook signatures before parsing business logic.
- Do not expose SCM tokens to sandbox.
- Record raw payloads with secret redaction.
- Use least-privilege provider permissions.

### 7.2 Reliability

- Webhook endpoint should acknowledge quickly and enqueue work.
- Worker processing should be retryable.
- Idempotency should use provider delivery IDs.
- Scheduled reconciliation should repair missed events.
- Every generated PM summary should be traceable to stored evidence.

### 7.3 Privacy and interruption control

- Keep a per-person question ledger.
- Respect quiet hours and weekends.
- Allow “don’t ask me about this workstream again today”.
- Avoid public escalation unless severity or policy requires it.

### 7.4 Observability

Track:

- Ingestion lag.
- Events processed / failed / replayed.
- Reconciliation gaps.
- Summary generation success.
- Check-ins sent / answered / ignored.
- False-positive risk flags.
- User corrections to agent summaries.

## 8. Proposed Architecture on z-mono

### 8.1 Runtime flow

```text
GitHub/GitLab webhooks
  -> PMO ingestion API / worker
  -> normalized event store
  -> evidence graph
  -> PMO agent sandbox
       -> gateway
       -> actions service tools
       -> LLM reasoning
  -> daily digest / ad hoc answer / low-touch check-in
```

### 8.2 z-mono package mapping

Recommended split:

- New app/repo code in `pmo_agent` for PMO-specific product, schema, and workers.
- Extend z-mono Actions Service with SCM actions if PMO runs as a sandbox agent:
  - `github_list_recent_activity`
  - `github_get_pr`
  - `github_get_commit`
  - `github_compare_refs`
  - `github_list_workflow_runs`
  - `github_search_issues_prs`
  - future `gitlab_*`
- Add PMO-specific storage outside sandbox:
  - events
  - normalized changes
  - workstreams
  - people identities
  - digests
  - check-in ledger
- Use gateway/session events for agent conversation and tool-call trace.

The PMO Agent should not put provider tokens or raw SCM access inside sandbox. Sandbox should request SCM facts through gateway/actions.

### 8.3 Suggested data model

Tables/entities:

- `scm_providers`
- `repositories`
- `repo_owners`
- `provider_identities`
- `people`
- `webhook_deliveries`
- `scm_events`
- `commits`
- `pull_requests`
- `reviews`
- `ci_runs`
- `deployments`
- `change_summaries`
- `workstreams`
- `workstream_evidence`
- `person_workstream_states`
- `risks`
- `digests`
- `checkins`
- `agent_corrections`

Key design choice: store raw provider facts separately from agent interpretations. Interpretations can be regenerated when prompts/models improve.

## 9. MVP Definition

### 9.1 MVP goal

Produce a reliable daily MaaS platform PM digest and answer ad hoc questions from GitHub activity with evidence links and minimal manual check-ins.

### 9.2 MVP scope

In scope:

- Manual repo registry.
- GitHub authentication using local token for prototype, GitHub App shape documented for production.
- Scheduled pull ingestion for recent commits and PRs.
- Optional webhook receiver if deploy target is available.
- Commit/PR normalization.
- Repo daily summary.
- Person daily summary.
- Risk signal detection for CI failure, stale PR, large/high-risk file changes, and no-update workstreams.
- Markdown daily digest generation.
- CLI or simple agent chat entrypoint.
- Documentation of future GitLab support because z-mono is GitLab-hosted.

Out of scope for MVP:

- Fully automated Feishu check-ins.
- Bi-directional project-management updates.
- Perfect ETA prediction.
- Organization-wide GitHub App installation UI.
- Full dashboard.
- Multi-tenant SaaS controls.

### 9.3 MVP success criteria

For a configured repo list and date range, the agent can answer:

- Which repos changed.
- Who changed them.
- What changed in plain language.
- Which changes map to which MaaS capability area.
- Which PRs are stale, failing, or blocked.
- What each active person appears to be working on.
- What the agent is uncertain about and who it would ask.

## 10. Implementation Plan After Confirmation

Phase 0: Repo bootstrap

- Add project README.
- Add env template.
- Add product docs and architecture notes.
- Choose stack after confirming whether this should be a standalone app or a z-mono package.

Phase 1: GitHub data ingestion

- Define repo registry config.
- Implement GitHub client.
- Implement recent commits / PRs / compare ingestion.
- Persist normalized evidence.
- Add idempotent checkpoints.

Phase 2: Summarization and state model

- Build change classification.
- Build person attribution.
- Build workstream inference.
- Build risk rules.
- Generate daily Markdown digest.

Phase 3: Agent interface on z-mono runtime

- Expose PMO data/actions through Actions Service-compatible tools.
- Implement PMO agent prompt and query workflows.
- Store query/session traces.

Phase 4: Low-interruption check-ins

- Add uncertainty scoring.
- Add question budget.
- Add check-in ledger.
- Add Feishu/IM send action after confirmation.

Phase 5: GitLab and MaaS platform hardening

- Add GitLab provider.
- Add z-mono-specific architecture boundary checks.
- Add deployment/CI integrations.
- Add dashboard if needed.

## 11. Open Questions for Confirmation

1. Source control scope: should MVP monitor only GitHub repos, or must it also monitor GitLab immediately because z-mono currently lives on `dev.aminer.cn`?
2. Repo list: which repos are the MaaS platform source of truth besides z-mono?
3. Output channel: should daily digest go to Feishu, GitHub issue, local Markdown, or a web page first?
4. Identity map: do we have a mapping between GitHub/GitLab usernames and real team members?
5. Check-ins: should MVP only recommend questions, or is it allowed to send Feishu messages automatically after approval?
6. Time window: daily digest should use China timezone day boundaries by default?
7. PM taxonomy: should capability areas follow z-mono package names first, or your MaaS product modules?

## 12. My Current Understanding

The right first version is a PMO intelligence loop:

1. Ingest code and collaboration evidence from repos.
2. Normalize it into repo/person/workstream state.
3. Generate evidence-backed daily and ad hoc summaries.
4. Detect uncertainty and risk.
5. Ask only targeted follow-up questions when the evidence is insufficient.

Technically, this should be implemented as a PMO-specific product layer that can run with z-mono’s agent runtime. The agent itself should remain untrusted and should access GitHub/GitLab through trusted Actions Service tools, preserving z-mono’s gateway/actions/sandbox boundary.
