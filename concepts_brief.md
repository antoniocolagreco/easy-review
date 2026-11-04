# easy-review

* **Author:** Antonio Colagreco
* **Date:** 2026-11-04

## Overview

LLM agents now write almost all code, so human review is the bottleneck. easy-review is a Claude Code mod with a review interface that shows only the HOT sections of a diff: the sections where a human is needed on top of a review already done by an LLM.

The strongest available model always reviews the code first. The mod is used only after that model reports no problems, and it does not run or check that review.

`/easy-review` with no argument reviews the current branch: comments go to Claude, who corrects the code, and nothing reaches GitHub. `/easy-review <PR URL>` reviews a pull request on GitHub: the reviewer reads the code, comments, replies to discussions, approves, requests changes or rejects.

Success means much less time spent on review, while the reviewer stays confident that the code does no harm.

## Analysis

Six reviewers with no knowledge of this conversation examined the concept. They reported 14 blockers, 15 majors and 9 nits. No decision already made by the owner was reopened. Nobody ran anything: claims about the mod API come from reading its documentation, and every claim about GitHub or `gh` comes from reviewers' memory and is unverified.

### What is HOT?

The owner's rule: most code, new or old, is boilerplate, and only a few lines change how the application behaves. The class depends on what the code does, not on whether it is new.

HOT is decided by risk, not by category. Each snippet gets a computed risk score, and a high score means it is shown to the reviewer. Categories are only titles, chosen by the model from a fixed list. The logic that decides whether to delete data is HOT. The delete operation itself is not.

This changes what a section is. The critical lines of a 2,000-line new file sit inside a single git hunk, so a hunk is too large a unit. The classifier must mark line ranges inside a hunk, and the view must show only those lines, with the rest collapsed. Reviewers had assumed one hunk per section, so this part of the concept has not been reviewed.

### What makes a section safe to hide?

Sections can disappear without any judgment: a diff cut at the 4 MiB output limit, a hunkless change the parser skips, an API error, a reply cut at the token limit, a failed hook, or a drawing cut at 100,000 characters. So a section may leave the main view only with a complete, valid COLD verdict tied to its content. Everything else stays visible. Before drawing, the mod must compare the file list and line counts from `git diff --numstat` with its sections.

### Can the classifier be trusted?

A rule in a prompt cannot stop author-written text from steering the model. That text includes code, strings, names, file names, commit messages and the PR description. Many categories also cannot be decided from one hunk, such as "logs without sensitive data" and "demonstrably unchanged".

The proposed pipeline has four layers. Fixed rules set a high risk by path or pattern, and the model cannot lower them. Fixed proofs set zero risk: no change once whitespace is removed, a 100% rename, a known lockfile changed together with its manifest. The model scores each snippet, and the mod's code computes the risk. Any failure leaves the lines shown.

Repository config such as `.gitattributes` is not read, so a PR cannot rewrite its own classification.

### Can a human judge a section alone?

Three lines of context rarely show guards or callers. A reader can see a call to `sanitize(x)` while the new body of `sanitize` was hidden, or a guard removed in one file and a caller added in another. Each section should show its path and enclosing symbol, the intent of the change, the hidden changes in the same file, and a way to expand the context. If a HOT section names a symbol defined in a hidden section, the second section is listed beneath it. Removing a check scores high under the risk rule, and a deleted line naming `authorize` or `permission` is a fixed rule.

Each section should also describe what the snippet does, with no questions. This card is worth more than interface polish.

### What does Approve mean?

A push during review could be approved unseen, because from memory `gh pr review --approve` takes no commit. A review must be tied to exact commits, and submission must re-read the head first. Reviewers suggest submitting through `gh api .../pulls/N/reviews` with `commit_id`.

`$.process` has no documented permission step, so the mod's own screen is the only safeguard. Approve needs a confirmation that names the action, the commit, the sections read and the hidden count, with no hotkey on submit actions and no tool the model can call to submit.

An approval reads as a full review on GitHub and may unlock merging. The owner accepts approving after reading only HOT sections, and the approval does not state this on GitHub.

### Interface limits

These limits were confirmed by reading the API types:

* A `Code` element has no children and no way to press or address a single line, so line comments need a separate mechanism.
* The surface chooses where a pane sits. With the terminal in fullscreen from 110 columns, the pane docks beside the transcript at up to 45% of the terminal's columns: 54 of 120, 90 of 200. Otherwise it sits inline above the prompt. The documentation does not state the inline width, so it must be measured.
* No side-by-side diff prop was found.
* One drawing shows at most 100,000 characters. Past that, a cut `Code` becomes plain code and a `Button` that does not fit disappears.
* `Code` allows tab and newline as its only control characters. Read literally, a file with CRLF line endings or a stray ESC could get a whole drawing refused and blank the review. This is untested and must be tested first.
* Hotkeys are one digit or lowercase letter.

None of these stops the concept. The view is a single-column unified diff, drawn in a row in the chat at full width.

### Other risks

* **Injection into the agent:** text returned by a command reaches a model that holds Bash and the owner's GitHub credentials. Diff text must not travel that way. The mod must never check out PR code, because that brings the PR's agent config into the working tree.
* **Cost:** `$.model.complete` calls stay out of the session's cost totals. A rough estimate, not measured: 1,500 changed lines is about 400k input tokens, and 20,000 lines is about 5M. The review must show usage and enforce a budget. Past the budget, sections go HOT with a banner.
* **Unfinished replies:** `maxTokens` defaults to 1024 and the result has no stop reason, so a cut reply shows up only as a parse failure, which means HOT.
* **Storage:** `$.store` holds 4 MiB of JSON in total and has no version check. Store hashes and drafts, never source code.
* **Interrupted work:** pressing Escape on the turn whose hook called the model aborts the call, and a reload drops timers. Classification needs a resumable queue keyed by section hash.
* **Unstable results:** the same code can change class between runs. Verdicts are stored by content, so a section once HOT stays HOT and a read section stays read.
* **Measuring success:** "drastically" and "confidence" have no number yet. Per-review logging can record changed lines versus HOT lines, seconds to submit, COLD sections opened and "should be HOT" presses.
* **API stability:** the mod API can change between releases, and a failed hook is skipped quietly.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * Show only HOT sections in the main view, with a visible count of what is hidden.
  * Review a GitHub PR: read the code, comment, reply, approve, request changes, reject.
  * Review the local branch and send the comments to Claude.
  * Keep hidden sections reachable.
* **Out-of-Scope Non-Goals:**
  * Actions outside a review, such as merge, labels and CI status.
  * Validating the classifier by replaying historical PRs (owner decision).
  * A guaranteed classifier (owner decision).
* **Proposed Non-Goals, not yet confirmed by the owner:**
  * Side-by-side diff.
  * Function-level sections.
  * Surfaces other than the terminal in v1.
  * Creating PRs.
  * Work running while Claude Code is closed.
  * A chat inside the pane.
  * Per-repository rules in v1.

## Alternatives Weighed

* `$.model.classify`: rejected, it has a fixed prompt and returns only a label.
* `$.model.fork`: rejected, it carries the transcript of the session that wrote the code.
* `gh pr review` as the main path: rejected, no inline comments and no commit pinning (from memory, unverified).
* `$.http.fetch` with a token: rejected, the mod should use one credential path through `gh`.
* Function-level sections: rejected for v1, the module has no Node or WebAssembly, so no syntax parser inside it.
* Rules read from the PR's own head: rejected, a PR could rewrite its own classification.
* A model's judgment that a refactor is unchanged, as grounds for COLD: rejected without named evidence such as a passed check.

Reviewers disagreed on these, so they stay open:

* **Classifier batching:** one call per diff, per file or per section. Recommendation: per section, so one poisoned section cannot sway others, and measure the cost.
* **PR diff source:** `gh pr diff`, or fetching `refs/pull/N/head` and diffing locally. It depends on whether a local clone is required.
* **Approve while classification is running:** disabled, or allowed with a stated count. Recommendation: disabled.
* **Second model confirming each COLD verdict:** recommendation: defer until "should be HOT" presses justify it.

## Key Decisions & Staging for Next Steps

### Decided by the owner

* The mod will be built and its goal is fixed.
* `/easy-review` with no argument is a local review of the branch, from the point where it left the main branch to the current files, including uncommitted and new files. Comments go to Claude with one explicit send, as `file:line`, the text of the line and the reviewer's words. Claude replies in the chat. Nothing reaches GitHub.
* `/easy-review <PR URL>` is a GitHub review. The actions are: read the code, comment, reply, edit own comments, resolve, approve, request changes, reject. Reject closes the PR without merging, because GitHub has no reject action.
* The review is a row in the chat, not a pane, and uses Claude Code's own diff drawing. A mock tested this: `~/.claude/dev-mods/094812cb-7558-404f-ae7b-d7ed355b4239/easy-review-mock`. `design_draft.md` records what was learned.
* Approving after reading only HOT sections is accepted.
* The classifier will sometimes be wrong. The aim is the lowest practical error rate.
* No replay of historical PRs.
* The code will live in its own repository at `~/Projects/easy-review`, under version control.
* The strongest available model reviews all code before the mod is used. The mod does not run or check that review.
* HOT is decided by a computed risk score for each snippet, not by category. High risk is shown to the reviewer.
* Categories are only titles. The model must pick one from a fixed list.
* There are no settings for what counts as HOT.
* The logic that decides a delete is HOT. The delete operation itself is not.
* An approval is a normal GitHub approval, with no added text about what was read.
* The mod runs only in the terminal in fullscreen, PR review accepts only `github.com`, and Reject sends drafts before closing the PR.

### Decided during drafting

These were technical. `design_draft.md` answers each one.

1. How the classifier marks line ranges inside a hunk, and how the view draws what lies between them.
2. Approve conditions.
3. Numeric targets for time saved, and whether hand-written test diffs for each rule are in scope.
4. Token budget and maximum diff size.
5. Whether PR review requires a local clone.
6. Whether a person can move a section from HOT to COLD. Moving from COLD to HOT is assumed.
7. Horizontal scroll for lines wider than the terminal.

### Proposed build order

0. Skeleton with a fixture diff.
1. Local review, read-only, with every section HOT.
2. Classifier with failure handling, cost meter, COLD list and test diffs.
3. Local comments sent to Claude.
4. PR read-only.
5. Comment, reply, approve, request changes and reject, with head check and confirmation.
6. Re-review of changes after a push, and README.

### Prototypes before the spec is fixed

1. Hostile diff drawing: CRLF, ESC, bidirectional Unicode, wrapping.
2. Horizontal scroll in a chat row.
3. Comment, reply, approve, request changes and close with `gh api` on a scratch repository, since all GitHub claims are unverified.
4. Background classification across Escape and reload.
