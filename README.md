<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

# easy-review

A Claude Code plugin that shows you only the high-risk lines of a diff.

LLMs write code faster than anyone can read it, but not every changed line deserves the same attention. easy-review scores each change by what it would cost if it were wrong, shows you the risky lines and hides the rest behind a click. Then you comment, approve or reject from the terminal.

**It does not review your code.** It looks for no bugs and only decides what deserves your eyes. It assumes a strong model has already reviewed the change, and it neither runs nor checks that review. If you skip it, nobody has looked at the hidden lines.

```text
PR #1 feat: add PATCH method for partial user updates
antoniocolagreco-bot wants to merge feat/add-patch-user into main, commit f55c74a.
8 of 86 changed lines are HOT (9%)
78 lines hidden in 7 runs. 0 of 2 sections read.

> 2 COLD lines hidden: API contracts, Adds PATCH to the CORS allowed methods list.

src/app.ts  export function createApp(db: UserDatabase = createDatabase()) {
The user update handler now accepts PATCH as well as PUT.

API contracts
The user update branch now handles PATCH requests with the same code as PUT. The body
is still parsed as a full UpdateUserInput, so partial-update semantics are not applied.
  106 -        if (method === "PUT") {
  107 +        if (method === "PUT" || method === "PATCH") {
```

## Install

You need Claude Code in a terminal, with a mouse, because clicks are the only way to comment and press buttons. Pull request reviews also need `gh`, logged in.

At the Claude Code prompt, run the line below, answer `y` to add the marketplace, then choose a scope.

```text
/plugin install easy-review --marketplace antoniocolagreco/easy-review
```

The plugin needs the fullscreen layout, which is on by default. In tmux it is off, so start Claude Code like this, and add `set -g mouse on` to `~/.tmux.conf`. Use the same start if you have set `CLAUDE_CODE_NO_FLICKER=0`.

```sh
CLAUDE_CODE_NO_FLICKER=1 claude
```

To update, run these in a shell, then restart Claude Code.

```sh
claude plugin marketplace update easy-review
claude plugin update easy-review@easy-review
```

## Commands

Review your uncommitted changes, including new files:

```text
/easy-review
```

Review the current branch from where it left another branch, including uncommitted changes and new files:

```text
/easy-review develop
```

Review a pull request on GitHub:

```text
/easy-review https://github.com/<owner>/<repo>/pull/<number>
```

The plugin never guesses a branch. It compares against the one you name.

## Reading a review

Scroll with the mouse wheel. After you click a line, the left and right arrows move long lines sideways.

Each section shows a title, a description of what the lines do, and the diff. `Mark read` shrinks a section, and it stays read until its content changes. `More context` adds the lines around it.

Click a line starting with `>` to open hidden code. `Mark as HOT` moves it into the main view.

## Commenting

Click a line, click the field that opens above the prompt, type, and press Enter. A toast tells you how each action went.

In a local review, nothing reaches GitHub. Comments stay as drafts until you press `Send to Claude`, and Claude then corrects the code in the session.

In a pull request review, a comment reaches GitHub as soon as you press Enter, as a single line comment. If GitHub refuses it, it stays on its line as `Not posted`, with `Post` to try again. Replies, edits and deletes also go out at once, and a delete asks first. GitHub takes comments only on lines in the diff, so lines added by `More context` cannot have one.

## Finishing a pull request

`Approve` waits until classification has finished.

`Comment` and `Request changes` appear once you have written a summary with `Write summary`, because GitHub requires text for both. `Reject` closes the pull request without merging it, since GitHub has no real reject action.

Each of these asks for confirmation. If the author has pushed a new commit, the plugin sends nothing and reloads the diff.

## How risk is decided

A model splits each change into snippets and scores each one from 0 to 3. The plugin's own code then computes the risk, so the model never decides directly what you see.

```text
risk = impact × (reversibility + detection)     range 0 to 18
HOT when risk >= 6
```

| Score | Impact: the worst harm | Reversibility: recovering in production | Detection: how long a fault stays unseen |
| --- | --- | --- | --- |
| 0 | None | The next deploy fixes it | The compiler fails at once |
| 1 | Small and local | A revert fixes it | An ordinary test catches it |
| 2 | A feature or contract breaks | A revert plus manual cleanup | Only a specific scenario shows it |
| 3 | Data loss, money, security, outage | It cannot be fully undone | Only someone who knows the intent sees it |

Calling `delete(id)` after other code has made the decision scores 1 × (3 + 1) = 4, so it stays hidden. The code that makes that decision is what you want to read.

Section titles come from a fixed list and do not affect the score.

Some changes are always HOT, whatever the model says:

*   paths with a folder or file named `auth`, `authn`, `authz`, `authentication`, `authorization`, `permissions`, `security` or `secrets`
*   anything in `.claude` or `.github/workflows`, and `CODEOWNERS`, `CLAUDE.md` and `AGENTS.md`
*   deleted lines that mention `authorize` or `permission`
*   a lockfile changed with no change to its manifest

A line with no valid score stays visible, marked as not classified. Lockfile changes that come with their manifest, and whitespace-only changes in files where indentation has no meaning, are hidden without calling the model.

## Limits

Models can get a score wrong, so a hidden line can still hold a serious bug. Code can also carry hostile text aimed at the model, and no prompt can guarantee that it wins no low score or misleading summary.

Classification uses Sonnet and starts as soon as the review opens. Above 5,000 changed lines still to classify, the review asks first. It stops at 3,000,000 input tokens, leaving the remaining lines visible, until you press `Continue classification`. Scores are saved, so unchanged code is not scored twice. Model calls stay out of Claude Code's cost totals, and the review header shows the tokens used.

## Development

Run the plugin from a clone. This first load also writes the types that `tsc` needs.

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

The design is in [docs/designs/easy-review.md](docs/designs/easy-review.md).

## License

[MIT](LICENSE)
