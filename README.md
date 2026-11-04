# easy-review

A Claude Code mod that shows only the high-risk lines of a diff, so a person reads less code after an LLM has already reviewed it.

## Commands

*   `/easy-review` reviews the current branch, from where it left the main branch to the current files, including uncommitted and new files. Comments go to Claude, who corrects the code. Nothing reaches GitHub.
*   `/easy-review https://github.com/<owner>/<repo>/pull/<number>` reviews a pull request on GitHub. You can comment on a line, reply, edit your comments, resolve discussions, approve, request changes or reject. Reject closes the PR without merging.

## Needs

*   Claude Code in the terminal, in fullscreen: `CLAUDE_CODE_NO_FLICKER=1`.
*   `git`, and `gh` logged in for PR review. The review shows which `gh` account it uses.

## Load it

```sh
CLAUDE_CODE_NO_FLICKER=1 claude --plugin-dir ~/Projects/easy-review
```

## How to use it

*   Scroll with the mouse wheel.
*   Click a line to write a comment. The field opens above the prompt: click it, type, press Enter.
*   After a click, the left and right arrows move long lines sideways.
*   Click a `>` line to open hidden code. `Mark as HOT` moves it into the main view.
*   `Mark read` shrinks a section. It stays read while its content does not change.

## The risk rule

A model splits each hunk into snippets and scores each one from 0 to 3 on impact, reversibility and detection. The mod's own code computes:

```text
risk = impact × (reversibility + detection)     range 0 to 18
HOT when risk >= 6
```

Categories are only titles, chosen from a fixed list. A few paths and lines always count as high risk: authentication, permissions, security and secrets paths, CI workflows, agent instruction files, deleted lines naming `authorize` or `permission`, and a lockfile changed with no manifest change. A line with no valid score stays visible and is marked as not classified.

## Things to know

*   An approval through the mod is a normal GitHub approval. It does not say that only HOT lines were read.
*   Model calls stay out of Claude Code's cost totals. The review header shows the tokens used.
*   The budget is 3,000,000 input tokens per review. Past it, lines stay visible until you press `Continue classification`.
*   No prompt can guarantee that a model ignores hostile text in the code. A hostile hunk can still win a low score or a misleading summary.

## Development

```sh
tsc -p .
claude plugin test .
claude plugin validate .
```

The design is in `docs/designs/easy-review.md`.
