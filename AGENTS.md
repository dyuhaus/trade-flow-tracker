# Agent Guide

This repository is model- and harness-agnostic. `AGENTS.md` is the portable
entrypoint for Codex, Hermes, Claude Code, and any future assistant harness.

## Rules

- Read `/home/dyadmin/AGENTS.md` first for the machine-level contract.
- Read this repo's `README.md`, manifests, scripts, and tests before changing
  behavior.
- If `CLAUDE.md` exists in this repo, read it as project-specific historical
  guidance. Preserve its project intent while translating Claude-specific wording
  to the active harness.
- Do not require a specific model, provider, or API unless the project explicitly
  implements that provider. Keep provider names, model names, base URLs, and keys
  in environment variables or documented config.
- Keep durable state in repo files and deterministic scripts, not in one
  harness's memory or chat history.
- Never read, print, commit, or publish secrets, local `.env` values,
  credentials, generated databases, or private user data.
- Use the project's native test/build commands for validation; document any
  missing or unavailable checks.


## Git Workflow (machine standard)
This repo follows /home/dyadmin/AGENTS.md "Git Workflow Standard".
- Default branch: main (protected, PR-only, squash merge)
- Branches: feat/ fix/ chore/ docs/ exp/ (+ agent/<harness>/ optional)
- Commits: Conventional Commits; hooks must pass; never --no-verify
- Review: CodeRabbit auto-reviews PRs (config: .coderabbit.yaml); address all
  findings, then request David's approval (agent PRs require it)
- Deploy coupling: <none | "merging main deploys to X — humans merge">
- Long-lived branch exceptions: <none | list + purpose>
