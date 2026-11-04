# easy-review

*   **Author:** Antonio Colagreco
*   **Status:** Approved
*   **Date:** 2026-11-04

--------------------------------------------------------------------------------

## Overview

easy-review is a Claude Code mod for reviewing code written by LLMs. It shows only the HOT lines of a diff inside the Claude Code chat: the lines with a high risk, where a human should have the last word.

It has two modes, chosen by how it is started:

*   **Local review:** `/easy-review` with no argument reviews only uncommitted changes. `/easy-review <branch>` reviews the current branch against the named branch. The mod never chooses a branch on its own. In both, the reviewer's comments go to Claude, who corrects the code, and nothing reaches GitHub.
*   **Pull request review:** `/easy-review <PR URL>`. It reviews a pull request on GitHub, and the reviewer can comment, reply to discussions, approve, request changes or reject without opening GitHub.

The mod is used after the strongest available model has reviewed the code and reported no problems. The mod does not run or check that review.

## The Problem

LLM agents now write almost all code, for the owner and for collaborators. Code is produced faster than a person can read it, so human review is the bottleneck.

Most changed lines are boilerplate that an LLM can review. Few lines change how the application behaves. A normal diff shows all of them with equal weight, so the reviewer spends time and attention on lines that do not need a human, and has less left for the lines that do.

The proposed solution computes a risk score for each snippet of changed code and shows only high-risk snippets in the main view. Lower-risk snippets stay reachable on request.

**HOT** lines are lines in a snippet with a high risk score. **COLD** lines are all other lines. The kind of code does not decide this: a CSS change that hides a consent banner is HOT, and renaming a tag in Terraform is COLD. The logic that decides whether to delete data is HOT; the delete operation alone is not. Categories are only titles for the reader.

## Goals

*   **Less to read:** the main view shows only HOT lines. Each review states how many changed lines are HOT, as a count and a percentage: "248 of 1,240 changed lines are HOT (20%)". Lines not classified are counted apart. There is no target percentage, and no HOT line is hidden to reach a number.
*   **Nothing lost by accident:** every changed line is either shown or has a valid COLD verdict from the classifier. A line with no valid verdict is shown and marked as not classified.
*   **Hidden code is visible as a count:** the review always states how many sections and lines are hidden, and the reviewer can open them.
*   **Each HOT section explains itself:** it states what the code does, its title from a fixed list, and a description of the snippet.
*   **Review from inside Claude Code:** a normal review needs no visit to github.com.
*   **Local corrections:** in local review, comments reach Claude in one explicit send, and Claude corrects the code.
*   **Pull request actions:** the reviewer can read, comment on a line, reply to a discussion, edit their own comments, resolve a discussion, approve, request changes and reject.
*   **Approval tied to a commit:** an approval applies to the exact commit the reviewer saw. A push during review cannot be approved unseen.

## Non-Goals

*   Running or checking the LLM review that comes before the mod.
*   Actions outside a review: merge, labels, CI status, creating a PR.
*   Validating the classifier by replaying historical PRs.
*   A classifier that is never wrong. The aim is the lowest practical error rate.
*   Side-by-side diff.
*   Surfaces other than the terminal in the first version.
*   A chat inside the review.
*   Claude replying inside a discussion in local review. Claude replies in the chat.
*   Settings for what counts as HOT, either general or per repository. The same risk rule applies everywhere.
*   Work that runs while Claude Code is closed.

## Open Questions

*   **Untested behaviour**: the Technical Plan lists what has only been read in documentation, and the prototype that tests each item.

## Critical User Journeys (CUJs)

### CUJ 1: Review a local branch and get it corrected

*   **Given**: The reviewer has worked on a feature with Claude, and the strongest model has reported no problems.
*   **When**: The reviewer runs `/easy-review`, comments on some lines and presses `Send to Claude`.
*   **Then**: With no argument, the diff covers only uncommitted changes and new files. With `/easy-review <branch>`, it runs from the point where the current branch left the named branch to the current files, including uncommitted and new files. A line at the top says that nothing reaches GitHub. Claude receives each comment with `file:line`, the text of the commented line and the reviewer's words, then corrects the code and replies in the chat.

### CUJ 2: Review a local branch again after corrections

*   **Given**: Claude has changed the code after a review.
*   **When**: The reviewer runs `/easy-review` again.
*   **Then**: Only new or changed sections need reading. Sections already read stay read. A comment on a section that changed is marked, because its line may have moved.

### CUJ 3: Review a PR and approve it

*   **Given**: A PR is open on GitHub, the strongest model has reported no problems, and `gh` is logged in.
*   **When**: The reviewer runs `/easy-review <PR URL>`, reads the HOT sections and presses Approve.
*   **Then**: The review opens at once and shows classification progress. A header states how much is hidden. Before submitting, a confirmation names the commit and the hidden line count. GitHub records the approval on that commit.

### CUJ 4: Comment and request changes on a PR

*   **Given**: The reviewer finds a problem in a HOT section.
*   **When**: The reviewer clicks the line, writes a comment and presses Request changes.
*   **Then**: Comments and the verdict reach GitHub as one review on the commit the reviewer saw. If GitHub refuses it, the review states why and keeps the draft.

### CUJ 5: Take part in a discussion on a PR

*   **Given**: A line already has a discussion from another person.
*   **When**: The reviewer presses `Reply`, writes an answer and later presses `Resolve`.
*   **Then**: The reply appears under the earlier comments. A resolved discussion shrinks to one line, and `Unresolve` reopens it. The reviewer can edit their own comments, and emptying one deletes it.

### CUJ 6: Reject a PR

*   **Given**: The reviewer does not want the PR at all.
*   **When**: The reviewer presses `Reject (close PR)` and confirms.
*   **Then**: The PR is closed without merging. GitHub has no "reject" action, and closing is the nearest real one.

### CUJ 7: Look at hidden code

*   **Given**: The reviewer wants to check something the classifier hid.
*   **When**: The reviewer opens a hidden run or a hidden file.
*   **Then**: The reviewer can read and comment on those lines. The reviewer can also mark a hidden section as HOT, and it joins the main view.

### CUJ 8: The author pushes during a PR review

*   **Given**: The review is open and the author pushes a new commit.
*   **When**: The reviewer presses Approve or Request changes.
*   **Then**: The mod re-reads the PR head, blocks the submission and says the PR moved. Sections already read stay read. Only new or changed sections need reading. Drafts are kept.

### CUJ 9: The classifier fails

*   **Given**: The model returns an error, or a reply that is cut or invalid, for some sections.
*   **When**: The reviewer looks at the review.
*   **Then**: Those sections are shown and marked as not classified. The review never shows "no HOT sections" unless every changed line has a valid verdict and the mod's line count matches the diff's.

## Technical Plan (Architecture)

### Flow

```text
/easy-review            /easy-review <PR URL>
      |                         |
 local source (git)      PR source (gh api)
      +------------+------------+
                   v
        parser: files, hunks, lines
                   v
        count check against git or GitHub
                   v
        row placed at once, every line "pending"
                   v
        classifier queue in the background <--> $.store (verdicts by hash)
                   v
        view: HOT sections, hidden count, HOT percentage
      +------------+------------+
      v                         v
 $.prompt.submit            gh api
 (comments to Claude)       (review on GitHub)
```

The mod runs only in the terminal with Claude Code in fullscreen, which is on by default except in tmux or with `CLAUDE_CODE_NO_FLICKER=0`. On any other surface, or outside fullscreen, `/easy-review` stops and says why, because the mouse is documented only in fullscreen and a compaction outside fullscreen ends the row.

### Reading the diff

Both sources use `$.process.spawn`, because `$.process.run` cuts output at 4 MiB. The mod sets no limit of its own on diff size.

**Local source.** The base is never guessed (owner's decision). A guessed base failed on a real repository: a local `main` left months behind `develop` compared one branch against 4,086 files. With no argument the base is `HEAD`, so only uncommitted changes and new files are reviewed. `/easy-review <branch>` uses the named branch, and a name that does not exist stops the review before any model call. The header states which of the two applies. It then runs:

*   `git merge-base HEAD <branch>` for the starting point, when a branch is named.
*   `git diff --no-color --no-ext-diff --no-textconv -M <base>` for commits and uncommitted changes.
*   `git ls-files --others --exclude-standard -z` for new files, then `git diff --no-index /dev/null <file>` for each one. The mod never runs `git add`, so the index does not change.
*   `git diff --numstat -z <base>` for the count check.

**PR source.** A review needs only the URL and `gh`, with no local clone, so PR code never enters the working tree. The URL must match `https://github.com/<owner>/<repo>/pull/<number>`, and any other host is refused in the first version. The mod reads:

*   `gh api user` for the login, shown in the header, because `gh` can hold more than one account.
*   `gh api repos/<o>/<r>/pulls/<n>` for the title, author, state, head commit, `additions`, `deletions` and `changed_files`.
*   The same path with `Accept: application/vnd.github.diff` for the diff.
*   `pullRequest.reviewThreads` through `gh api graphql` for existing discussions.

If GitHub refuses the diff, the mod falls back to `pulls/<n>/files`. That list stops at 3,000 files, and a file can come back with no `patch`. A file with no `patch` stays visible as one line marked not classified, and any file past the limit is counted in a banner.

**Count check.** Before stating that anything is hidden, the mod compares its parsed files and added and deleted lines with `--numstat` or the PR's own counts. If they differ, a banner states the difference and "no HOT sections" is never shown.

**Parser.** It turns the diff into files, hunks and numbered lines. A change with no hunks (binary, mode change, submodule, rename with edits to no lines) becomes a one-line section. `Code` accepts only tab and newline as control characters, so the parser replaces the others with a visible mark such as `␛`, and marks bidirectional Unicode the same way. A trailing carriage return is removed and the file header says `CRLF`.

### Classifier

The model splits each hunk into snippets and scores each one. The mod's own code computes the risk from those scores and decides what is HOT. The model never answers "HOT or COLD", and there are no settings for what counts as HOT.

#### Risk rule

A snippet is a run of lines that do one thing. The model gives it three scores, assuming the strongest model has already reviewed the code and found no problem. If a score sits between two values, the model must use the higher one.

| Score | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| **Impact:** the worst harm if this code is wrong | None: formatting, comments, moved code with no change | Small and local: a wrong label, a layout fault | A feature or contract breaks for users or other services | Data loss or corruption, money, a security breach, a legal problem, or an outage |
| **Reversibility:** what it takes to recover once in production | Nothing lasting: the next deploy fixes it | A revert fixes it | A revert plus manual cleanup of data or state | It cannot be fully undone: data deleted, events published, secrets leaked |
| **Detection:** how long a fault stays unseen | At once: the compiler or type check fails | An ordinary test would catch it | Only a specific scenario shows it | Only a person who knows the intent would see it, or it appears only in production |

```text
risk = impact × (reversibility + detection)     range 0 to 18
HOT when risk >= 6
```

Impact 0 means risk 0, whatever the other scores are. Impact 3 is HOT unless reversibility and detection add up to 1 or less. The threshold of 6 is a starting number, not a measured one. It is one constant, applied when drawing, so changing it needs no new model calls.

Worked examples, which are also sent to the model:

| Snippet | Impact | Reversibility | Detection | Risk | Result |
| --- | --- | --- | --- | --- | --- |
| Imports and logger setup | 0 | 0 | 0 | 0 | COLD |
| Rename a tag in Terraform | 1 | 1 | 1 | 2 | COLD |
| Call `delete(id)` after another part of the code has decided | 1 | 3 | 1 | 4 | COLD |
| New validation rule on a request | 2 | 1 | 2 | 6 | HOT |
| Timeout lowered from 30 seconds to 3 | 2 | 1 | 3 | 8 | HOT |
| CSS hides the consent banner | 3 | 1 | 2 | 9 | HOT |
| New role allowed on a route | 3 | 2 | 2 | 12 | HOT |
| A check removed from a route | 3 | 2 | 2 | 12 | HOT |
| Condition that decides whether to delete data | 3 | 3 | 2 | 15 | HOT |
| A log line prints a token | 3 | 3 | 3 | 18 | HOT |

#### Fixed rules

Two kinds of rule work without the model's judgment. The model cannot lower the first kind, and author text cannot steer either kind.

*   **Fixed high risk.** These lines get risk 18 whatever the model scores: paths with a segment named `auth`, `authn`, `authz`, `authentication`, `authorization`, `permissions`, `security` or `secrets`; `.github/workflows/`; `CODEOWNERS`; `.claude/`; `CLAUDE.md`; `AGENTS.md`; a deleted line naming `authorize` or `permission`; and a lockfile changed with no manifest of its kind anywhere in the diff. The model is still called, for the title and the texts.
*   **Fixed zero risk.** These need no model call: a rename with `similarity index 100%`, a hunk whose added and deleted lines are equal once whitespace is removed (never for Python, YAML or other languages where indentation has meaning), and a known lockfile when a manifest of its kind is anywhere in the same diff. In a monorepo the lockfile sits at the root and the manifest in a package, so requiring the same folder would mark every normal dependency change as HOT.

#### Titles

Each snippet has exactly one title from this list. A title never changes the risk. A reply with any other title is invalid.

| Title | Covers |
| --- | --- |
| Authentication | Login, sessions, tokens, identity checks |
| Authorization | Roles, permissions, tenant isolation, access rules |
| Secrets and cryptography | Keys, encryption, hashing, signing |
| Input validation and injection | Untrusted input, SQL or command injection, XSS, SSRF |
| Privacy and personal data | Personal data, consent, retention |
| Business logic | Rules, calculations, decisions |
| Domain rules | Invariants, state transitions, lifecycles |
| Payments and money | Charges, refunds, prices, invoices |
| Data models and schemas | Entities, database schema, validation schemas |
| Data shape and mapping | DTOs, payloads, serialization, converters |
| Migrations and bulk writes | Schema migrations, mass updates, backfills |
| Data deletion | Deleting, archiving and purging data |
| Queries and data access | SQL, ORM, repositories, read models |
| Concurrency and transactions | Race conditions, locks, atomicity, idempotency |
| Events and messaging | Kafka, SQS, consumers, producers, ordering |
| Caching | Redis, invalidation, TTL, application caches |
| API contracts | Endpoints, OpenAPI, protobuf, status codes |
| External integrations | Third-party APIs, webhooks, external SDKs |
| Error handling and resilience | Retries, timeouts, circuit breakers, fallbacks, dead-letter queues |
| Jobs and batch processing | Cron, schedulers, periodic processing |
| Feature flags and rollout | Toggles, gradual rollout, functional switches |
| Performance and resource limits | Slow queries, memory, loops, rate limits |
| Infrastructure | Terraform, AWS CDK, networking, IAM |
| Configuration | Environment variables, limits, production settings |
| CI/CD and deployment | Pipelines, build, release, rollback |
| Dependencies and runtime | Packages, libraries, Node.js versions |
| Agent instructions | `CLAUDE.md`, `AGENTS.md`, `.claude/`, prompts |
| Frontend logic | State management, routing, forms, hooks |
| UI components and styling | React UI, HTML, CSS, layout, accessibility |
| Logging and observability | Logs, metrics, tracing, alerts |
| Tests | Unit, integration and E2E tests, fixtures |
| Documentation and content | READMEs, comments, translations, copy |
| Build and tooling | Bundlers, linters, compiler settings |
| Boilerplate | Imports, formatting, wiring, generated code |
| Other | Anything no other title covers |

#### Model call

Hunks that no fixed zero-risk rule covers go to `$.model.complete`, which has no tools and no transcript.

**Unit.** One call per hunk, so one hostile hunk cannot sway another. A hunk over 400 lines is split into pieces of 400, each sent with the 20 lines before it as context only.

**Question.** The system prompt holds the risk scores, the worked examples and the titles, and says that everything between the delimiters is data from an untrusted author. The delimiter is random for each call. Each line is numbered. The PR title and description are not sent, because they are author text the classifier does not need. The reply must be JSON:

```json
{ "snippets": [
  { "from": 1, "to": 18, "title": "Boilerplate",
    "impact": 0, "reversibility": 0, "detection": 0,
    "summary": "Imports and logger setup" },
  { "from": 19, "to": 28, "title": "Business logic",
    "impact": 3, "reversibility": 2, "detection": 2,
    "summary": "...", "description": "..." }
] }
```

**Validation.** The snippets must cover every line once, in order. A gap made only of blank lines joins the neighbouring snippet, because the model often skips them and refusing the reply put a whole piece back on screen. `title` must come from the list, and each score must be a whole number from 0 to 3. `description` is required when the computed risk is 6 or more. Text fields have a length limit and lose control characters. Anything else, including a reply cut at the token limit, leaves the whole piece not classified, and it is shown. An `api-error`, `empty-reply` or invalid reply is retried once.

**Limits.** The model is `sonnet`. It is a starting choice, not a measured one. Each call has `maxTokens` 8000 and `timeoutMs` 120000, and at most 4 calls run at once. The rules are sent as a cached block.

**Budget.** `$.model.complete` stays out of the session's cost totals, so the header shows the tokens used from `usage`. The budget is 3,000,000 input tokens per review. This is a starting number based on the brief's estimate of 400,000 tokens for 1,500 changed lines. Past the budget, unclassified lines stay visible and a banner offers `Continue classification`.

**Queue.** Work starts from the `command.run` hook and continues after it returns. A call that resolves `aborted`, or work dropped by a reload, stays in the queue, and the review offers `Resume classification`. A second `/easy-review` on the same review also resumes it.

**Injection.** No prompt can guarantee the model ignores text in the code. The layers above limit the damage: fixed rules cannot be lowered, the model has no tools, and failure shows the line. A hostile hunk can still win a COLD verdict or a misleading summary. So the summary is labelled as generated, and the code is always drawn below it.

### Sections and hidden code

While classification runs, lines still waiting are counted in the header and not drawn, so the code on screen is only what is already known to be HOT. Once it stops, any line with no valid verdict is drawn and marked as not classified. A section is one run of HOT or not classified lines, with up to 3 lines of context. COLD runs around it are drawn as one clickable line with their title and summary. A file with no HOT lines goes to the hidden list at the end of the review.

*   **Related hidden changes.** After classification, the mod looks for names defined in hidden runs (`function X`, `const X =`, `class X`, `def X`) that also appear in a HOT section. Each match is listed under that section as a collapsed line. This is a text match and will miss some cases.
*   **More context.** Each section has `More context`, which adds 20 lines around it, read from the file (local) or from `repos/<o>/<r>/contents/<path>?ref=<sha>` (PR). GitHub comments apply only to lines in the diff, so these added lines cannot take a comment in PR review.
*   **Moving sections.** The reviewer can mark a hidden run as HOT. There is no way to move HOT to COLD: a section that needs no attention is simply marked read.
*   **Read state.** Each section has `Mark read`. A read section shrinks to one line, stored by content hash, so it stays read after a push or a correction if its content is the same.
*   **Header.** It shows the source, the commit, the login, classification progress, tokens used, `248 of 1,240 changed lines are HOT (20%)`, and the count of lines not classified. Local review adds a line saying nothing reaches GitHub.

### Storage

`$.store` holds at most 4 MiB in total, and source code is never written to it.

| Key | Value |
| --- | --- |
| `verdict:<sha256>` | The checked snippets with their scores, with text limited in length. The hash covers path, piece text, model and rules version, computed with `crypto.subtle`. |
| `review:<id>` | Drafts, read hashes and the hashes of hidden runs marked as HOT. `<id>` is `<repo path>:<branch>` or `<owner>/<repo>#<number>`. |

A draft points to a line by path, side, number and the hash of the line's text. If the line no longer matches, the draft is marked as moved. When the store is full, the oldest `verdict:` keys go first, and drafts are never removed on their own. `--resume` brings no row back, so running `/easy-review` again restores drafts and read state. Two sessions on the same review can overwrite each other's drafts; the first version accepts this.

The parsed diff stays in the module's memory. After a reload the mod reads it again.

### Local actions

`Send to Claude` calls `$.prompt.submit` once, with each comment as `path:line`, the text of the line and the reviewer's words. Claude corrects the code in its own turn and replies in the chat. Sent comments are marked, and they stay visible until the next `/easy-review`.

### GitHub actions

Every action is `gh api` with an argument list and no shell. The body goes through standard input.

| Action | Call | When it is sent |
| --- | --- | --- |
| Comment, Approve, Request changes | `POST pulls/<n>/reviews` with `commit_id`, `event`, `body` and `comments` (`path`, `line`, `side`, optional `start_line`, `start_side`, `body`) | On confirmation, as one review |
| Reply | GraphQL `addPullRequestReviewThreadReply` | When written |
| Edit, delete a posted comment | GraphQL `updatePullRequestReviewComment`, `deletePullRequestReviewComment` | When written |
| Resolve, reopen | GraphQL `resolveReviewThread`, `unresolveReviewThread` | When pressed |
| Reject | `PATCH pulls/<n>` with `state: closed`, after any drafts are sent as a `COMMENT` review | On confirmation |

New comments are local drafts until a verdict is submitted, and they can be edited freely. Replies and changes to posted comments go out at once, because they belong to a discussion that already exists.

**Approve conditions.** Approve is disabled while classification is running or waiting to resume. Otherwise it is available, and unread sections do not block it, because the reviewer decides what to read. The confirmation names the commit, the sections read and the lines hidden.

**Text on the approval.** The mod adds no text. On GitHub it is a normal approval, and nothing states that only HOT lines were read (owner's decision).

**Head check.** Before every verdict, the mod re-reads the PR's head commit. If it differs from the commit on screen, the mod blocks the submission and reloads the diff, as CUJ 8 describes. After a verdict it reads the head again, and if the head moved in that moment it says the verdict applies to the older commit. GitHub's documentation warns only that an old `commit_id` can make comments outdated, so the check belongs to the mod.

**Refusals.** If GitHub refuses a call, the review shows the error and keeps the drafts.

### Safety rules

*   In PR review, no text from the PR reaches the session's model. That code path never calls `$.prompt.submit` or `$.session.append`, and `command.run` returns only fixed text. A test fails if this changes.
*   The mod registers no tool, so the model cannot submit a review.
*   Verdict buttons have no hotkey and always ask for confirmation, because the mod's own screen is the only safeguard before `gh` runs.
*   The URL is checked against the pattern above, and paths are passed as separate arguments and encoded in API paths.
*   `$.process` runs git with repository hooks off, according to its documentation.

### What has and has not been checked

Checked by reading the API types or by a read-only call: `Client` has no wheel event, `$.prompt.submit` exists, `crypto.subtle` exists, the PR fields and the diff header work on a public PR, and the GraphQL mutations and thread fields above exist.

Tested in a real terminal on a scratch local repository, with the real model and SGR mouse events:

1.  **Hostile diff drawing:** CRLF, ESC, bidirectional Unicode and tabs draw as visible marks with no refused drawing. Wide characters were not tried.
2.  **Horizontal scroll and page size:** the arrows move a run's text sideways. A file of 1,500 lines opened as 5 pages, with `Previous` and `Next` working.
3.  **Background queue:** Escape pressed with no turn running did not stop classification. After a reload the row asks for `/easy-review` again, and stored verdicts make no new calls. A stopped call and `Resume classification` are covered only by a test with a stand-in model.
4.  **Classifier cost:** 56,471 tokens for 1,514 changed lines in 8 pieces, almost all of it generated code. This is one sample and well below the brief's estimate.
5.  **Local review, whole loop:** comment, `Send to Claude`, Claude corrects the file, and a second `/easy-review` reuses stored verdicts.
6.  **PR reading:** login, PR fields, diff header and the GraphQL discussions query, on a real public PR.
7.  **Local commands:** `/easy-review` on a clean repository says there is nothing to review and makes no model call, and with a new file it reviews only that file. `/easy-review main` reviews the branch against `main`. A branch that does not exist stops the review.

Not tested yet:

1.  **GitHub writes on a scratch repository:** every action in the table, comments on a line outside the diff, and approving your own PR. From memory, GitHub refuses the last two. These calls have run only against stand-ins, and the mutation names and input fields were read from the GraphQL schema.
2.  **Large diffs:** whether GitHub answers 406, and at what size. The documentation lists the 406 with no explanation.
3.  **Risk rule:** whether the same snippet gets stable scores across runs, and whether a threshold of 6 shows the right lines on the owner's first real reviews.

Known limit: classification starts as soon as the review opens, with no confirmation. With a named branch or a PR URL, a very large diff can use the whole budget of 3,000,000 input tokens.

### Interface (tested with a mock)

The mock has fake data and sends nothing to GitHub. It sits outside the project, in `~/.claude/dev-mods/094812cb-7558-404f-ae7b-d7ed355b4239/easy-review-mock`. It was tried in a real terminal, partly with simulated mouse events and partly by the owner.

*   **Where the review sits:** a row in the chat, placed with `$.ui.place`. It takes the chat's full width and scrolls with the mouse wheel. On opening, the view moves to the start of the row with `$.ui.scroll`, 100 ms after placing it. While the diff loads and classification runs, the row is at least one screen tall, because otherwise the view stays on the bottom and follows the row as it grows. The test kit refuses this scroll, so it was checked only in a real terminal. The owner preferred this to a side pane, which is limited to 45% of the terminal's columns. New chat messages appear below the row, so the review scrolls up while Claude works.
*   **The diff:** Claude Code's own `Code` element with `format: 'diff'`, so it looks like the diffs Claude Code shows natively, with syntax colors. The mod cannot change these colors.
*   **Clicks on a line:** `Code` cannot be pressed, so each run of lines sits in a `Client`, which receives mouse events and maps the row to the line. This needs each line on one row, so long lines are cut with `wrap: 'truncate-end'`.
*   **Hover:** the line under the mouse is redrawn as plain text on a blue background. While hovered it loses its syntax colors and its diff background. A selected line looks the same and also has a `>` in the left column.
*   **Writing a comment:** text fields do not receive the keyboard inside a chat row. Only panes and the band above the prompt do. So the field opens in the band above the prompt, and the reviewer clicks it before typing. The mod cannot give it the keyboard on its own.
*   **Section layout:** the file path, the enclosing function when git reports one in the `@@` line, a summary of the section, a blank line, the title in yellow, then a description of the snippet with no questions, then the diff. COLD runs inside a section appear as one clickable line that expands.
*   **Colors:** the mod's own text uses color names (`yellow`, `green`, `blue`). The real terminal palette is not reachable: only theme keys, names and hex are accepted, and `ansi:blue` is refused.
*   **Mouse:** documented only with the terminal in fullscreen mode.

Two further interface decisions were added during the build:

*   **Horizontal scroll:** `Client` receives no wheel events, so scrolling uses the keyboard. A click on a line also gives that `Client` the keys, and the left and right arrows move its text 8 columns at a time. The `Client` redraws its hunk with each line's text cut at that offset. The highlighter sees cut text, so colors can be wrong on partly visible words.
*   **Pages:** one drawing holds at most 100,000 characters, and past that a `Code` becomes plain text and a `Button` can vanish. The mod splits the review into pages of at most 60,000 characters of serialized props, with `Previous` and `Next` at both ends and the finish box on every page. A section longer than a page is split at a line, and each part gets its own hunk header, because a diff cut mid-hunk does not parse.

## Alternatives Considered

### Alternative A: Categories decide what is HOT

*   **Pros**: Simple to explain. A category is easier to recognize from one hunk than harm is. The reviewer can read the list and know what will be shown.
*   **Cons**: A category does not measure harm. A CSS change can hide a consent banner, and a change to business logic can be a harmless move.
*   **Reason for Rejection**: Owner's decision. Risk decides, and categories are only titles.

### Alternative B: A settings menu for what counts as HOT

*   **Pros**: Each reviewer can tune the review to their own work.
*   **Cons**: It adds a settings screen, and changing the list forces new model calls that cost tokens. It also depends on categories deciding what is HOT, which Alternative A rejects.
*   **Reason for Rejection**: Owner's decision. The same rule applies everywhere.

### Alternative C: The model gives one overall risk score

*   **Pros**: A shorter reply and a simpler prompt.
*   **Cons**: A single number has no stated parts, so nobody can see why a snippet scored as it did, and a hostile hunk needs to move only one value. Three narrow scores with fixed meanings leave the arithmetic to the mod's code.
*   **Reason for Rejection**: Three scores let the mod compute the risk itself, and each score can be checked against its written meaning.

### Alternative D: A side pane for the review

*   **Pros**: The review stays beside the chat. Panes receive the keyboard, so a comment field needs no separate band.
*   **Cons**: A docked pane takes at most 45% of the terminal's columns, 54 of 120. The owner needs at least 80 columns plus overhead, and the plugin cannot choose where the pane sits.
*   **Reason for Rejection**: A row in the chat takes the full width, and the mock showed that it meets the owner's mouse and layout needs.

### Alternative E: `$.model.classify` for classification

*   **Pros**: A single call made for labelling, with no JSON to validate.
*   **Cons**: It has a fixed prompt and returns only a label, so it cannot return scores, line ranges or texts.
*   **Reason for Rejection**: It cannot express what the risk rule needs.

### Alternative F: `$.model.fork` for classification

*   **Pros**: It reuses the session's cached transcript, so it can cost less.
*   **Cons**: It carries the transcript of the session that wrote the code, including that session's own reasoning, into the judgment.
*   **Reason for Rejection**: The classifier must judge the code with no earlier context.

### Alternative G: One model call per diff or per file

*   **Pros**: Fewer calls and fewer input tokens. The model sees more of the change at once.
*   **Cons**: One hostile hunk can sway every other hunk in the same call. A long reply is more likely to be cut, and a cut reply loses the whole call.
*   **Reason for Rejection**: One call per hunk limits both failures to one hunk. The cost is measured by a prototype.

### Alternative H: A second model confirms each low score

*   **Pros**: A hostile hunk would have to deceive two calls.
*   **Cons**: It adds cost to the largest group of snippets, and there is no evidence yet that it is needed.
*   **Reason for Rejection**: Deferred. Reconsider it if reviewers often mark hidden code as HOT.

### Alternative I: Rules read from the repository, such as `.gitattributes`

*   **Pros**: A repository could mark its own generated files as hidden.
*   **Cons**: Read from the PR's head, a PR could rewrite its own classification. Read from the base commit, it is still a form of settings per repository.
*   **Reason for Rejection**: The same rule applies everywhere in the first version.

### Alternative J: A model's judgment that a refactor changes nothing, as a fixed zero risk

*   **Pros**: Large refactors would disappear from the review.
*   **Cons**: "Nothing changed" is the claim a hostile or faulty change would make. Only named evidence, such as equal lines once whitespace is removed, proves it.
*   **Reason for Rejection**: The model scores a refactor like anything else. It gets no shortcut.

### Alternative K: A local clone for PR review

*   **Pros**: `git fetch refs/pull/<n>/head` and a local diff avoid GitHub's limits on diff size, and full files are at hand for context.
*   **Cons**: It requires a clone of every reviewed repository. A checkout would also bring the PR's agent config into the working tree.
*   **Reason for Rejection**: The URL and `gh` are enough for the normal case, and no PR code reaches the working tree. If a prototype shows that GitHub's limits are often reached, a fetch with no checkout is the next option.

### Alternative L: `gh pr review` for verdicts

*   **Pros**: One short command, with nothing to build.
*   **Cons**: From memory, it takes no inline comments and no commit, so a push during review could be approved unseen. This has not been tested.
*   **Reason for Rejection**: `POST pulls/<n>/reviews` documents both `commit_id` and `comments`.

### Alternative M: `$.http.fetch` with a GitHub token

*   **Pros**: No dependency on the `gh` program.
*   **Cons**: The mod would have to obtain and hold a token, which adds a second credential path.
*   **Reason for Rejection**: `gh` is already logged in and holds the credential.

### Alternative N: Sections at function level

*   **Pros**: A section would match how people think about code.
*   **Cons**: The module has no Node or WebAssembly, so it has no syntax parser, and an external parser would be a new dependency per language.
*   **Reason for Rejection**: The model marks snippets by line number, which works for any language.

### Alternative O: Allow Approve while classification is running

*   **Pros**: A reviewer in a hurry does not wait.
*   **Cons**: The reviewer would approve without knowing what is about to be shown.
*   **Reason for Rejection**: Approve waits until classification stops. Lines that fail classification are shown anyway, so a failure does not block it.

### Alternative P: State on GitHub what was read

*   **Pros**: Other people would know that the approval did not cover every line.
*   **Cons**: It adds text that the owner does not want on the review.
*   **Reason for Rejection**: Owner's decision. It is a normal approval.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

All paths are relative to `~/Projects/easy-review`. That folder currently sits inside the git repository of the home directory, so the first step is `git init` there. The mock stays outside the project and is not copied whole: only its diff drawing and row layout are carried over.

The build added three files to the list below: `tsconfig.json` for `tsc -p .`, `hooks/process.ts` for collecting output from `$.process.spawn`, and `hooks/review.ts`, which holds the review session and every action. Two rules of `claude plugin validate` shaped the code: a function that receives `$` from another file must be a function declaration, and each file declares the `atom` values it reads or writes.

### Build order

Each step ends with the verification plan below passing. A prototype runs before the step that depends on it, outside the project, and its result is written into this document.

| Step | Work | Prototype first | Files |
| --- | --- | --- | --- |
| 0 | Skeleton: the row drawn from a fixture diff, with no git and no model | Hostile diff drawing; horizontal scroll and page size | 1 to 6, 12, 13, 21 to 25 |
| 1 | Local review, read-only, with every section marked not classified | None | 7 |
| 2 | Classifier, risk rule, failure handling, tokens shown, hidden list | Background queue; classifier cost; risk rule | 14 to 20 |
| 3 | Comments sent to Claude, drafts and read state | None | 9, 11 |
| 4 | PR review, read-only, with existing discussions | Large diffs | 8 |
| 5 | Comment, reply, approve, request changes, reject, head check | GitHub on a scratch repository | 10 |
| 6 | Re-review after a push or a correction, README | None | 11, 20, 21, 26 |

### Target Files to Create/Modify

#### 1. `.gitignore` (Create)

*   **Type / Scope**: Git configuration.
*   **Proposed Changes**: Ignore `.claude-plugin/types/`, which the engine writes when it loads the mod.

#### 2. `.claude-plugin/plugin.json` (Create)

*   **Type / Scope**: Mod manifest.
*   **Proposed Changes**: Name `easy-review`, version `0.1.0`, a one-line description, and `"types": "./types/index.d.ts"`. No `userConfig`, because there are no settings.

#### 3. `hooks/hooks.json` (Create)

*   **Type / Scope**: Module list.
*   **Proposed Changes**: `{ "modules": ["./register.tsx"] }`.

#### 4. `types/index.d.ts` (Create)

*   **Type / Scope**: Type contract for `$.state`.
*   **Proposed Changes**: The types below, and `PluginState['easy-review']` with `rowId`, `review`, `page`, `selected`, `composer`, `threads`, `expanded`, `pending` and `outcome`.

```text
DiffLine   { key, kind: add|del|ctx, oldNo?, newNo?, text }
Snippet    { from, to, title, impact, reversibility, detection, summary, description? }
Verdict    { state: pending|scored|failed|fixed-zero, snippets?, fixedHigh: boolean }
Section    { id, path, symbol?, title, summary, description, lines, hiddenBefore, hiddenAfter, related, hash, isRead }
HiddenFile { path, title, summary, lineCount }
Review     { id, mode: local|pr, commit, login?, pr?, counts, sectionsTotal, pagesTotal, tokensUsed, banners }
Draft      { path, side, line, lineHash, text, isSent, hasMoved }
Thread     { id, path, side, line, isResolved, isOutdated, comments, canResolve }
```

#### 5. `hooks/register.tsx` (Create)

*   **Type / Scope**: Hooks module, event wiring only.
*   **Proposed Changes**: On `session.start`, register `easy-review`. On `command.run`, stop with a fixed message unless the surface is the terminal and `presentation.isFullscreen` is true. An empty argument starts local review, a valid PR URL starts PR review, and anything else prints the usage. Place the row at once, report a failed `$.ui.place`, then start reading. `ui.message` receives clicks from `diff-client.tsx`. `ui.render` draws `Placed` through `view-row.tsx` and `AbovePrompt` through `view-band.tsx`, and returns `next(e)` for other plugins and surfaces.

#### 6. `hooks/diff-client.tsx` (Create)

*   **Type / Scope**: Surface module.
*   **Proposed Changes**: Carried over from the mock: `Code` with `format: 'diff'`, the `>` column, hover, and a click that posts `{ lineKey }`. New: `onKey` handles the left and right arrows, moves the text 8 columns at a time, and keeps the offset in local state.

#### 7. `hooks/source-local.ts` (Create)

*   **Type / Scope**: Data access.
*   **Proposed Changes**: Takes the named branch, if any, and runs the git commands listed in the Technical Plan through `$.process.spawn`, joining the pieces. New files are added to the same diff text. Exit code 1 from `git diff --no-index` counts as success. Returns the diff text, the counts from `--numstat`, the branch, the named base and the head commit. Stops with a message outside a repository or when the named branch does not exist.

#### 8. `hooks/source-pr.ts` (Create)

*   **Type / Scope**: Data access.
*   **Proposed Changes**: `parsePrUrl` checks the URL against the fixed pattern. Reads the login, PR fields, diff and review threads with `gh api`, following pagination for threads and files. Falls back to `pulls/<n>/files` if the diff is refused. Reports a missing `gh`, a failed login and a closed PR as messages. Exposes `readHead` for the head check and `readFileLines` for `More context`.

#### 9. `hooks/local-send.ts` (Create)

*   **Type / Scope**: Output for local review.
*   **Proposed Changes**: Builds one message with each draft as `path:line`, the current text of the line and the reviewer's words, and calls `$.prompt.submit`. Marks the drafts as sent. A send with no drafts is not possible, because the button is disabled.

#### 10. `hooks/github-actions.ts` (Create)

*   **Type / Scope**: Output for PR review.
*   **Proposed Changes**: One function per row of the GitHub actions table, each calling `gh api` with an argument list and the body on standard input. `submitReview` runs the head check, sends the review, then reads the head again. `reject` sends drafts as a `COMMENT` review, then closes the PR. Every function returns success or GitHub's error text. None of them removes drafts on failure.

#### 11. `hooks/review-store.ts` (Create)

*   **Type / Scope**: Storage.
*   **Proposed Changes**: Reads and writes `verdict:<sha256>` and `review:<id>` in `$.store`, with writes in sequence. When `set` is refused for size, it deletes the oldest `verdict:` keys and tries again. If it still fails, it adds a banner and keeps the values in memory for the session. Computes hashes with `crypto.subtle`.

#### 12. `hooks/parse-diff.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: Turns unified diff text into files, hunks and numbered lines, keeping the function name from each `@@` line. Handles new, deleted, renamed, binary, mode-only and submodule changes, quoted paths, and `\ No newline at end of file`. A change with no hunks becomes one entry. Returns its own counts for `checkCounts`, which compares them with `--numstat` or the PR's counts and returns the difference.

#### 13. `hooks/sanitize.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: Replaces control characters other than tab with visible marks, marks bidirectional Unicode, removes a trailing carriage return and reports it for the file header. Used on all text drawn, including text returned by the model.

#### 14. `hooks/titles.ts` (Create)

*   **Type / Scope**: Data.
*   **Proposed Changes**: The list of 35 titles from the Technical Plan, written out in full, with what each covers. The prompt and the validator read it.

#### 15. `hooks/risk.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: `RISK_THRESHOLD = 6`, `FIXED_HIGH_RISK = 18`, `computeRisk(impact, reversibility, detection)` and `isHot(risk)`. This is the only file that holds the rule.

#### 16. `hooks/fixed-rules.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: `fixedHigh(file, line)` and `fixedZero(file, hunk, allFiles)` from the Technical Plan's lists, including the lockfile and manifest names and the languages where indentation has meaning. Paths are matched by whole segment, so `author/` does not match `auth`.

#### 17. `hooks/classifier-prompt.ts` (Create)

*   **Type / Scope**: Prompt text.
*   **Proposed Changes**: The system prompt in English, with the three scores and their meanings, the rule to use the higher value, the worked examples, the titles, the reply format and the rule that delimited text is untrusted data. `buildPiece` adds the random delimiter, the path, the context lines and the numbered lines. Holds `RULES_VERSION`, which goes into the verdict hash.

#### 18. `hooks/classifier-reply.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: Parses the JSON and applies every check in the Validation paragraph. Returns snippets or a failure reason, and never a partial result.

#### 19. `hooks/classifier-queue.ts` (Create)

*   **Type / Scope**: Background work.
*   **Proposed Changes**: Splits hunks into pieces, applies fixed zero risk, reads stored verdicts, and runs up to 4 `$.model.complete` calls with an `AbortController`. Adds up `usage`, stops at the budget, retries once, and returns `aborted` pieces to the queue. Exposes `resume`, used by the `Resume classification` and `Continue classification` buttons and by a second `/easy-review`. Each finished piece updates `$.state` so the row redraws.

#### 20. `hooks/sections.ts` (Create)

*   **Type / Scope**: Pure logic.
*   **Proposed Changes**: Combines lines and verdicts into sections, hidden runs and the hidden file list. Applies fixed high risk and `isHot`. Treats failed and pending lines as visible. Adds 3 lines of context, finds related hidden changes by name, and computes the header counts. Splits sections into pages of at most 60,000 characters of serialized props, with a new hunk header on each split part.

#### 21. `hooks/view-row.tsx` (Create)

*   **Type / Scope**: Drawing.
*   **Proposed Changes**: Carried over from the mock: sections, threads, hidden runs, finish box and confirmation. New: header, banners, classification progress, `Previous` and `Next`, `Mark read`, `More context`, `Mark as HOT`, and `Generated` beside each summary. The finish box shows `Send to Claude` in local review, and Comment, Approve, Request changes and Reject in PR review. Verdict buttons have no hotkey.

#### 22. `hooks/view-band.tsx` (Create)

*   **Type / Scope**: Drawing.
*   **Proposed Changes**: Carried over from the mock: the comment, reply and edit fields in the band above the prompt, with `Cancel`.

#### 23. `tests/fixtures.ts` (Create)

*   **Type / Scope**: Test data.
*   **Proposed Changes**: Hand-written diffs, each written out in full: a normal change, a new file, a rename, a binary file, a mode change, CRLF, ESC, bidirectional Unicode, a lockfile with and without its manifest, an auth path, a long hunk over 400 lines, and one hunk for each worked example. Model replies are written out beside them.

#### 24. `tests/parse-and-rules.test.ts` (Create)

*   **Type / Scope**: Unit tests.
*   **Proposed Changes**: Parser output and counts for each fixture, `checkCounts` with a difference, `sanitize`, every row of the worked examples in `computeRisk`, the boundaries of the threshold, and every fixed rule, including `author/` not matching.

#### 25. `tests/review.test.tsx` (Create)

*   **Type / Scope**: Tests with the engine's test kit.
*   **Proposed Changes**: Carried over from the mock: line click, comment, edit, delete, threads, confirmations. New, with hooks standing in for `process.spawn` and `model.complete`:
    *   Replies with a gap, an overlap, an unknown title, a score of 4, cut JSON or an API error all leave the lines shown and marked not classified.
    *   "No HOT sections" appears only when every line has a verdict and the counts match.
    *   Fixed high risk overrides a low score from the model.
    *   A stored verdict makes no new call.
    *   Past the budget, lines stay visible and the banner appears.
    *   Approve is disabled while classification runs.
    *   In PR review, no hook sees `prompt.submit` or `session.append`.
    *   Local send calls `prompt.submit` once, with `path:line`, the line and the words.
    *   A moved head blocks the verdict and keeps the drafts.
    *   A GitHub error keeps the drafts and shows the text.
    *   Reject sends drafts before closing.
    *   A second `/easy-review` restores drafts and read state.
    *   Outside fullscreen, the command stops with its message.

#### 26. `README.md` (Create)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: What the mod does, the two commands, the needs (`CLAUDE_CODE_NO_FLICKER=1` for fullscreen, `gh` logged in for PR review), how to load it with `claude --plugin-dir`, and the risk rule in short. It also states that an approval given through the mod does not say what was read. No licence or marketplace file in the first version, because sharing the mod has not been requested.

### Verification Plan

*   **Compilation/Build**: `tsc -p .`.
*   **Unit Tests**: `claude plugin test .`.
*   **Static Analysis & Linting**: `claude plugin validate .`. Warnings about a licence or icon are expected.
*   **Test Coverage Requirement**: No percentage. Every case listed in files 24 and 25 must exist and pass.
*   **E2E/Integration**: A real terminal in `tmux` with `CLAUDE_CODE_NO_FLICKER=1 claude --plugin-dir .`, using SGR mouse sequences for wheel, hover, click and arrows, read back with `capture-pane`. Step 3 runs on a real branch. Step 5 runs every action on a scratch repository created by the owner, never on a real PR.
*   **Success Measures**: For the owner's first real reviews, record the HOT percentage, the time to submit and how often hidden code was marked as HOT. These decide whether the threshold of 6 stays. The mod does not record them on its own in the first version.

--------------------------------------------------------------------------------

*Drafted with EGM*
