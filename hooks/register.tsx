import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { currentSession, openReview } from './review'
import { parsePrUrl } from './source-pr'
import { renderBand } from './view-band'
import { renderRow } from './view-row'

const rowId = atom({ plugin: 'easy-review', key: 'rowId' } as const, null)
const page = atom({ plugin: 'easy-review', key: 'page' } as const, 0)
const selected = atom({ plugin: 'easy-review', key: 'selected' } as const, null)
const composer = atom({ plugin: 'easy-review', key: 'composer' } as const, null)
const expanded = atom({ plugin: 'easy-review', key: 'expanded' } as const, [])
const pending = atom({ plugin: 'easy-review', key: 'pending' } as const, null)
const outcome = atom({ plugin: 'easy-review', key: 'outcome' } as const, null)

const PLUGIN = 'easy-review'

const USAGE =
  'Usage: /easy-review reviews uncommitted changes. /easy-review <branch> reviews the current branch against that branch. /easy-review <PR URL> reviews https://github.com/<owner>/<repo>/pull/<number>.'
const BRANCH_NAME = /^[A-Za-z0-9_][\w./-]*$/
const NOT_FULLSCREEN = 'easy-review needs fullscreen. Start Claude Code with CLAUDE_CODE_NO_FLICKER=1 and run it again.'
const NOT_TERMINAL = 'easy-review runs only in the terminal.'

let surface: string | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    surface = e.surface

    await $.command.register({
      name: 'easy-review',
      description: 'Review high-risk lines: uncommitted changes, the current branch against a branch you name, or a GitHub PR by URL.',
    })

    return next(e)
  })

  on('command.run', { command: 'easy-review' }, async ($, e) => {
    if (surface !== null && surface !== 'terminal') {
      return { text: NOT_TERMINAL }
    }

    if (!e.presentation.isFullscreen) {
      return { text: NOT_FULLSCREEN }
    }

    const args = e.args.trim()
    const ref = args === '' ? null : parsePrUrl(args)
    const base = ref === null && BRANCH_NAME.test(args) ? args : undefined

    if (args !== '' && ref === null && base === undefined) {
      return { text: USAGE }
    }

    const id = `review-${await $.clock.now()}`

    await update($, rowId, () => id)
    await update($, page, () => 0)
    await update($, selected, () => null)
    await update($, composer, () => null)
    await update($, expanded, () => [])
    await update($, pending, () => null)
    await update($, outcome, () => null)

    const placed = await $.ui.place({ id })

    if (!placed.isPlaced) {
      return { text: `easy-review could not draw its row: ${placed.reason}` }
    }

    void openReview($, ref !== null ? { kind: 'pr', ref } : { kind: 'local', ...(base === undefined ? {} : { base }) })

    return { text: 'easy-review opened.' }
  })

  on('ui.message', async ($, e, next) => {
    const data = e.data

    if (typeof data === 'object' && data !== null && 'lineKey' in data && typeof data.lineKey === 'string') {
      const lineKey = data.lineKey

      await update($, composer, () => null)
      await update($, selected, now => (now === lineKey ? null : lineKey))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hasWork = (await read($, selected)) !== null || (await read($, composer)) !== null

    if (!hasWork || e.props.hasSurvey || e.surface === 'mobile' || e.surface === 'vscode' || currentSession() === null) {
      return next(e)
    }

    const band = await renderBand($, $.ui.resolve(e))

    return band ?? next(e)
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN || e.surface === 'mobile' || e.surface === 'vscode') {
      return next(e)
    }

    return renderRow($, $.ui.resolve(e), e.props.id)
  })
}
