# easy-review

A Claude Code mod that shows only the high-risk lines of a diff, so a person reads less code after an LLM has already reviewed it.

## Commands

*   `/easy-review` reviews only uncommitted changes, including new files. Comments go to Claude, who corrects the code. Nothing reaches GitHub.
*   `/easy-review <branch>` reviews the current branch from where it left the branch you name, for example `/easy-review develop`, including uncommitted changes and new files. Comments go to Claude here too. Comments go to Claude, who corrects the code. Nothing reaches GitHub.
*   `/easy-review https://github.com/<owner>/<repo>/pull/<number>` reviews a pull request on GitHub. You can comment on a line, reply, edit or delete your comments, resolve discussions, approve, request changes or reject. A line comment reaches GitHub as soon as you press Enter. Comment and Request changes need a summary. Reject closes the PR without merging.

## Needs

*   Claude Code in the terminal, in the fullscreen layout. It is on by default. In tmux, or if `CLAUDE_CODE_NO_FLICKER=0` is set, start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.
*   A mouse: clicks are the only way to comment and to press the buttons. In tmux, also add `set -g mouse on` to `~/.tmux.conf`. This has not been tried with a physical mouse.
*   `git`, and `gh` logged in for PR review. The review shows which `gh` account it uses.

## Install

At the prompt of a Claude Code session in the terminal:

```text
/plugin install easy-review --marketplace antoniocolagreco/easy-review
```

Answer `y` to add the marketplace, then choose a scope.

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
*   Above 5,000 changed lines still to classify, the review asks before it starts. Below that, classification starts as soon as the review opens. It can use the whole budget of 3,000,000 input tokens. Past it, lines stay visible until you press `Continue classification`.
*   No prompt can guarantee that a model ignores hostile text in the code. A hostile hunk can still win a low score or a misleading summary.

## Development

Run the mod from a clone:

```sh
git clone https://github.com/antoniocolagreco/easy-review.git
claude --plugin-dir ./easy-review
```

Check it from inside the clone:

```sh
tsc -p .
claude plugin test .
claude plugin validate .
```

The design is in `docs/designs/easy-review.md`.

## License

MIT. See `LICENSE`.
