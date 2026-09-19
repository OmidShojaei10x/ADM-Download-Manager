---
name: commit-push
description: >-
  Stages, commits, and pushes changes for the ADM Download Manager (MediaCatch)
  repo on origin/main. Use when the user invokes /commit-push, says کامیت و پوش,
  or asks to commit and push this project without extra confirmation.
disable-model-invocation: true
---

# /commit-push — ADM Download Manager

این اسکیل قراره کامیت و پوش کنه 
برای این پروژه

## Scope

- **Repository root:** workspace containing `media-catch/` (Chrome extension MV3).
- **Remote:** `origin` → `github.com:OmidShojaei10x/ADM-Download-Manager.git`
- **Default branch:** `main`
- **Do not** commit unless this skill is invoked or the user explicitly asked to commit/push in the same turn.

## Workflow (follow in order)

### 1. Inspect (parallel)

Run all three:

```bash
git status
git diff && git diff --stat
git log -5 --oneline
```

If nothing to commit (clean tree, no untracked files that belong in the repo), **stop** and tell the user — do not create an empty commit.

### 2. Draft the commit message

- **Language:** English (matches existing history).
- **Style:** Imperative subject, ≤72 chars; optional body explains **why** (1–2 sentences).
- **Examples from this repo:**
  - `Add per-site activation scope with allowlist and blocklist.`
  - `Fix icon script output path for local repo layout.`
- **Exclude:** `.env`, secrets, `workspace-*.zip`, accidental `.DS_Store` (already gitignored).
- **Include:** `media-catch/**`, `scripts/**`, `README.md`, `.cursor/skills/**` when intentional.

### 3. Stage and commit

```bash
git add <relevant paths>
git commit -m "$(cat <<'EOF'
Subject line here.

Optional why paragraph.
EOF
)"
```

**Git safety (mandatory):**

- Never `git config`, never `--no-verify`, never force-push `main`.
- Never `git commit --amend` unless user explicitly requested amend **and** all amend rules from user rules are satisfied.
- If a hook fails, fix and make a **new** commit (do not amend a failed commit).

### 4. Push

```bash
git push
```

Use `git push -u origin HEAD` only if the branch has no upstream yet.

### 5. Confirm

Run `git status` and report: commit hash, subject, and that `main` is up to date with `origin/main`.

## User-facing reply

When the user wrote in Persian, wrap the final summary in:

```html
<div dir="rtl" align="right">...</div>
```

Keep it short: commit hash, one-line summary, push result.

## Project notes

- Extension lives in `media-catch/`; bump `manifest.json` `version` when shipping user-visible extension changes.
- `*.zip` at repo root is gitignored; do not add unless `.gitignore` changes.
- After extension changes, mention **Reload** in `chrome://extensions` in the reply (one line).

## Do not

- Push to a different remote/branch unless the user named it.
- Commit unrelated drive-by edits; stage only what belongs to the current work.
- Ask "should I push?" — this skill **always pushes** after a successful commit.
