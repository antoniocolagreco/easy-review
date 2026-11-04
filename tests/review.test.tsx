import { expect, mock, test } from 'claude-code/testing'

import {
  LOW_RISK_REPLY,
  PR_JSON,
  PR_MOVED_JSON,
  SERVICE_DIFF,
  SERVICE_NUMSTAT,
  SERVICE_REPLY,
  THREADS_JSON,
  TWO_FILES_DIFF,
  TWO_FILES_NUMSTAT,
} from './fixtures'

type Body = Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>
type Dollar = Parameters<Body>[0]
type TestOn = Parameters<Body>[1]

const USAGE = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const LOCAL_ID = 'review-1'
const PR_URL = 'https://github.com/acme/app/pull/7'

const ROW = {
  plugin: 'easy-review',
  component: 'Placed',
  requestId: LOCAL_ID,
  surface: 'terminal',
  props: { id: LOCAL_ID, plugin: 'easy-review' },
} as const

const BAND = {
  plugin: 'easy-review',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type World = {
  modelReply?: string | { isAnswered: false; reason: 'api-error'; status: number; error: 'server_error' }
  usage?: typeof USAGE
  head?: string[]
  runFails?: string
  numstat?: string
  submitted?: string[]
  closed?: string[]
  promptTexts?: string[]
  modelCalls?: { count: number }
  diff?: string
  slowModel?: boolean
  abortNext?: { isOn: boolean }
}

const engineWorld = (on: TestOn, world: World) => {
  const heads = world.head ?? []

  on('command.register', () => ({ value: { command: 'easy-review' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1 }))
  on('ui.place', () => ({ value: { isPlaced: true, requestId: LOCAL_ID } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    world.promptTexts?.push(e.text)

    return { text: e.text }
  })
  on('model.complete', (_, e) => {
    if (world.modelCalls !== undefined) {
      world.modelCalls.count += 1
    }

    if (world.abortNext?.isOn === true) {
      world.abortNext.isOn = false

      return { value: { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE } }
    }

    const lineCount = world.slowModel === true ? Number(/Score lines 1 to (\d+)/.exec(e.prompt)?.[1] ?? 1) : 0
    const reply =
      lineCount > 0
        ? JSON.stringify({
            snippets: [{ from: 1, to: lineCount, title: 'Other', impact: 0, reversibility: 0, detection: 0, summary: 'A value' }],
          })
        : (world.modelReply ?? SERVICE_REPLY)

    return {
      value:
        typeof reply === 'string'
          ? { isAnswered: true as const, text: reply, usage: world.usage ?? USAGE }
          : { ...reply, usage: world.usage ?? USAGE },
    }
  })
  on('process.spawn', async function* (_, e) {
    const line = e.argv.join(' ')
    let stdout = ''
    let code = 0

    if (line.includes('rev-parse --show-toplevel')) {
      stdout = '/repo\n'
    } else if (line.includes('rev-parse HEAD')) {
      stdout = 'abc1234abc1234\n'
    } else if (line.includes('symbolic-ref')) {
      stdout = 'origin/main\n'
    } else if (line.includes('merge-base')) {
      stdout = 'base123\n'
    } else if (line.includes('--abbrev-ref')) {
      stdout = 'feature\n'
    } else if (line.includes('--numstat')) {
      stdout = world.numstat ?? SERVICE_NUMSTAT
    } else if (line.includes('ls-files')) {
      stdout = ''
    } else if (line.startsWith('git') && line.includes(' diff ')) {
      stdout = world.diff ?? SERVICE_DIFF
    } else if (line === 'cat -- src/service.ts') {
      stdout = Array.from({ length: 40 }, (_, index) => `row ${index + 1}`).join('\n')
    } else if (line === 'gh api user') {
      stdout = JSON.stringify({ login: 'antonio' })
    } else if (line.includes('Accept: application/vnd.github.diff')) {
      stdout = SERVICE_DIFF
    } else if (line.startsWith('gh api graphql')) {
      stdout = THREADS_JSON
    } else if (line === 'gh api repos/acme/app/pulls/7') {
      stdout = heads.length > 0 ? (heads.shift() ?? PR_JSON) : PR_JSON
    } else {
      code = 1
    }

    if (stdout !== '') {
      yield { stream: 'stdout' as const, text: stdout }
    }

    return { value: { code, signal: null } }
  })
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')

    if (world.runFails !== undefined) {
      return { value: { exitCode: 1, stdout: '', stderr: world.runFails, isStdoutTruncated: false, isStderrTruncated: false } }
    }

    if (line.includes('/reviews')) {
      world.submitted?.push(e.init?.stdin ?? '')
    } else if (line.includes('PATCH')) {
      world.closed?.push(e.init?.stdin ?? '')
    }

    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c2', body: e.init?.stdin?.includes('Fine') === true ? 'Fine' : 'x', author: { login: 'antonio' }, viewerCanUpdate: true, viewerCanDelete: true } } } }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
}

const start = async ($: Dollar, args = '', isFullscreen = true) => {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  return $.command.run({
    command: 'easy-review',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen, columns: 125 },
  })
}

const FIRST_HOT_LINE = 'diff-section-'

const clientKeyOf = async (ui: { findAll: (query: { type: string }) => Promise<readonly { key?: string | undefined }[]> }): Promise<string> => {
  const clients = await ui.findAll({ type: 'Client' })
  const key = clients.map(one => one.key).find(one => one?.startsWith(FIRST_HOT_LINE) === true)

  if (key === undefined) {
    throw new Error('no diff of a section is drawn')
  }

  return key
}

test('the local review shows HOT sections, the percentage and the hidden count', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /Local review of feature/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nothing reaches GitHub/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /4 of 7 changed lines are HOT \(57%\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 lines hidden in 2 runs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Authorization$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Allows only the owner \(generated\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Throws forbidden unless/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /export function suspend/ })).toBeDefined()
  await ui.unmount()
})

test('a reply that fails leaves every line shown as not classified', async ($, on) => {
  mock.store(on)
  engineWorld(on, { modelReply: '{"snippets":[{"from":1' })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /7 lines not classified/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Not classified: the reply is not valid JSON/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No HOT sections/ })).toBeUndefined()
  await ui.unmount()
})

test('an API error leaves every line shown, after one retry', async ($, on) => {
  const modelCalls = { count: 0 }

  mock.store(on)
  engineWorld(on, {
    modelCalls,
    modelReply: { isAnswered: false, reason: 'api-error', status: 500, error: 'server_error' },
  })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /Not classified: API error 500/ })).toBeDefined()
  expect(modelCalls.count).toBe(2)
  await ui.unmount()
})

test('"No HOT sections" appears only with a verdict for every line and matching counts', async ($, on) => {
  const allLow = JSON.stringify({
    snippets: [{ from: 1, to: 10, title: 'Other', impact: 1, reversibility: 0, detection: 1, summary: 'Small' }],
  })

  mock.store(on)
  engineWorld(on, { modelReply: allLow })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /No HOT sections/ })).toBeDefined()
  await ui.unmount()
})

test('a count mismatch shows a banner and never "No HOT sections"', async ($, on) => {
  const allLow = JSON.stringify({
    snippets: [{ from: 1, to: 10, title: 'Other', impact: 1, reversibility: 0, detection: 1, summary: 'Small' }],
  })

  mock.store(on)
  engineWorld(on, { modelReply: allLow, numstat: '9\t1\tsrc/service.ts\0' })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /added lines: read 6, expected 9/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No HOT sections/ })).toBeUndefined()
  await ui.unmount()
})

test('a stored verdict makes no new model call', async ($, on) => {
  const modelCalls = { count: 0 }

  mock.store(on)
  engineWorld(on, { modelCalls })
  await start($)

  const first = await $.ui.mount(ROW)

  expect(modelCalls.count).toBe(1)
  await first.unmount()
  await start($)

  const second = await $.ui.mount(ROW)

  expect(await second.find({ type: 'Text', text: /4 of 7 changed lines are HOT/ })).toBeDefined()
  expect(modelCalls.count).toBe(1)
  await second.unmount()
})

test('past the budget, lines stay visible and the banner appears', async ($, on) => {
  const usage = { input_tokens: 4000000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const modelCalls = { count: 0 }

  mock.store(on)
  engineWorld(on, { usage, modelCalls, diff: TWO_FILES_DIFF, numstat: TWO_FILES_NUMSTAT, slowModel: true })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(modelCalls.count).toBeLessThan(6)
  expect(await ui.find({ type: 'Text', text: /The token budget is used up/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'continue-classification' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /lines not classified/ })).toBeDefined()
  await ui.unmount()
})

test('a stopped call leaves lines shown, blocks Approve and can be resumed', async ($, on) => {
  mock.store(on)
  engineWorld(on, { abortNext: { isOn: true } })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /Classification stopped with 1 pieces left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7 lines not classified/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'review-approve' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Approve waits for classification/ })).toBeDefined()
  await ui.press({ key: 'resume-classification' })
  expect(await ui.find({ type: 'Text', text: /4 of 7 changed lines are HOT/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'review-approve' })).toBeDefined()
  await ui.unmount()
})

test('a click on a line opens the band and saves a draft, which can be edited and deleted', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})
  await start($)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  expect(await band.find({ type: 'Text', text: /Comment on src\/service.ts/ })).toBeDefined()
  await band.input({ key: 'comment-field', text: 'Check this', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /Draft: Check this/ })).toBeDefined()
  await ui.press({ key: 'edit-draft-0' })
  await band.input({ key: 'draft-edit-0', text: 'Check that', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /Draft: Check that/ })).toBeDefined()
  await ui.press({ key: 'edit-draft-0' })
  await band.input({ key: 'draft-edit-0', text: '', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /Draft: / })).toBeUndefined()
  await band.unmount()
  await ui.unmount()
})

test('local send calls prompt.submit once with the place, the line and the words', async ($, on) => {
  const promptTexts: string[] = []

  mock.store(on)
  engineWorld(on, { promptTexts })
  await start($)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  expect(await ui.find({ type: 'Button', key: 'send-to-claude' })).toBeUndefined()
  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'Wrong check', kind: 'submit' })
  await ui.press({ key: 'send-to-claude' })
  expect(promptTexts.length).toBe(1)
  expect(promptTexts[0]).toContain('src/service.ts:12')
  expect(promptTexts[0]).toContain('const isOwner = user.id === agreement.ownerId')
  expect(promptTexts[0]).toContain('Wrong check')
  expect(await ui.find({ type: 'Text', text: /Sent: Wrong check/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
})

test('a second /easy-review restores drafts and read state, and drops sent comments', async ($, on) => {
  mock.store(on)
  engineWorld(on, { promptTexts: [] })
  await start($)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)
  const end = (await ui.findAll({ type: 'Button' })).map(one => one.key).find(one => one?.startsWith('read-') === true)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'Keep me', kind: 'submit' })
  await ui.press({ key: end ?? '' })
  expect(await ui.find({ type: 'Text', text: /1 of 1 sections read/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
  await start($)

  const again = await $.ui.mount(ROW)

  expect(await again.find({ type: 'Text', text: /1 of 1 sections read/ })).toBeDefined()
  expect(await again.find({ type: 'Button', key: 'send-to-claude' })).toBeDefined()
  await again.unmount()
})

test('outside fullscreen the command stops with its message', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})

  const result = await start($, '', false)

  expect(result.text).toContain('needs fullscreen')
})

test('a wrong argument prints the usage', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})

  const result = await start($, 'https://gitlab.com/acme/app/pull/7')

  expect(result.text).toContain('Usage')
})

test('a PR review shows the login, the discussion and the verdict buttons', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})

  const result = await start($, PR_URL)

  expect(result.text).toBe('easy-review opened.')

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /PR #7 Add suspension/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /You review as antonio/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /collaborator: Is the owner check enough\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'review-approve' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'send-to-claude' })).toBeUndefined()
  await ui.unmount()
})

test('in PR review nothing reaches the session model', async ($, on) => {
  const promptTexts: string[] = []
  const session = mock.session(on)
  const submitted: string[] = []

  mock.store(on)
  engineWorld(on, { promptTexts, submitted })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)

  await ui.press({ key: 'review-approve' })
  await ui.press({ key: 'confirm' })
  expect(submitted.length).toBe(1)
  expect(promptTexts).toEqual([])
  expect(session.appended().length).toBe(0)
  await ui.unmount()
})

test('approve asks for confirmation and sends the commit on screen', async ($, on) => {
  const submitted: string[] = []

  mock.store(on)
  engineWorld(on, { submitted })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)

  await ui.press({ key: 'review-approve' })
  expect(await ui.find({ type: 'Text', text: /Approve on commit abc1234\? You read 0 of 1 sections, and 3 changed lines are hidden/ })).toBeDefined()
  expect(submitted.length).toBe(0)
  await ui.press({ key: 'confirm' })

  const body = JSON.parse(submitted[0] ?? '{}') as Record<string, unknown>

  expect(body['event']).toBe('APPROVE')
  expect(body['commit_id']).toBe('abc1234abc1234abc1234abc1234abc1234abc12')
  expect(body['body']).toBe('')
  expect(await ui.find({ type: 'Text', text: /Approve sent on commit abc1234/ })).toBeDefined()
  await ui.unmount()
})

test('a comment and request changes reach GitHub as one review on the right side and line', async ($, on) => {
  const submitted: string[] = []

  mock.store(on)
  engineWorld(on, { submitted })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'Not enough', kind: 'submit' })
  await ui.press({ key: 'review-changes' })
  await ui.press({ key: 'confirm' })

  const body = JSON.parse(submitted[0] ?? '{}') as { event: string; body: string; comments: unknown[] }

  expect(body.event).toBe('REQUEST_CHANGES')
  expect(body.body).toBe('See the line comments.')
  expect(body.comments).toEqual([{ path: 'src/service.ts', line: 12, side: 'RIGHT', body: 'Not enough' }])
  expect(await ui.find({ type: 'Text', text: /Draft: Not enough/ })).toBeUndefined()
  await band.unmount()
  await ui.unmount()
})

test('a moved head blocks the verdict and keeps the drafts', async ($, on) => {
  const submitted: string[] = []

  mock.store(on)
  engineWorld(on, { submitted, head: [PR_JSON, PR_MOVED_JSON, PR_MOVED_JSON] })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'Stay', kind: 'submit' })
  await ui.press({ key: 'review-approve' })
  await ui.press({ key: 'confirm' })
  expect(submitted.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /The PR moved to commit def5678, so nothing was sent/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Draft: Stay/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
})

test('a GitHub error keeps the drafts and shows the text', async ($, on) => {
  mock.store(on)
  engineWorld(on, { runFails: 'gh: Unprocessable Entity (HTTP 422)' })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'Stay', kind: 'submit' })
  await ui.press({ key: 'review-changes' })
  await ui.press({ key: 'confirm' })
  expect(await ui.find({ type: 'Text', text: /GitHub refused the review.*HTTP 422/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Draft: Stay/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
})

test('reject asks for confirmation, sends drafts first, then closes the PR', async ($, on) => {
  const submitted: string[] = []
  const closed: string[] = []

  mock.store(on)
  engineWorld(on, { submitted, closed })
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)
  const key = await clientKeyOf(ui)

  await ui.pointer({ in: key, type: 'down', x: 2, y: 0, button: 'left' })
  await band.input({ key: 'comment-field', text: 'No', kind: 'submit' })
  await ui.press({ key: 'review-reject' })
  expect(await ui.find({ type: 'Text', text: /Close PR #7 without merging it\?/ })).toBeDefined()
  expect(closed.length).toBe(0)
  await ui.press({ key: 'confirm' })
  expect((JSON.parse(submitted[0] ?? '{}') as { event: string }).event).toBe('COMMENT')
  expect(JSON.parse(closed[0] ?? '{}')).toEqual({ state: 'closed' })
  expect(await ui.find({ type: 'Text', text: /PR #7 is closed/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
})

test('a reply and a resolve go out at once', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})
  await start($, PR_URL)

  const ui = await $.ui.mount(ROW)
  const band = await $.ui.mount(BAND)

  await ui.press({ key: 'reply-thread-0' })
  await band.input({ key: 'reply-0', text: 'Fine', kind: 'submit' })
  expect(await ui.find({ type: 'Text', text: /antonio: Fine/ })).toBeDefined()
  await ui.press({ key: 'resolve-thread-0' })
  expect(await ui.find({ type: 'Text', text: /Resolved \(2 comments\)/ })).toBeDefined()
  await band.unmount()
  await ui.unmount()
})

test('More context adds lines from the file around a section', async ($, on) => {
  mock.store(on)
  engineWorld(on, {})
  await start($)

  const ui = await $.ui.mount(ROW)
  const more = (await ui.findAll({ type: 'Button' })).map(one => one.key).find(one => one?.startsWith('more-') === true)

  await ui.press({ key: more ?? '' })

  const keys = (await ui.findAll({ type: 'Client' })).map(one => one.key ?? '')
  const before = keys.find(key => key.startsWith('diff-before-')) ?? ''
  const after = keys.find(key => key.startsWith('diff-after-')) ?? ''

  expect(JSON.stringify(await ui.drawn({ in: before }))).toContain('row 11')
  expect(JSON.stringify(await ui.drawn({ in: after }))).toContain('row 16')
  await ui.unmount()
})

test('a hidden run can be opened and marked as HOT', async ($, on) => {
  mock.store(on)
  engineWorld(on, { modelReply: LOW_RISK_REPLY.replace('"to":2', '"to":10') })
  await start($)

  const ui = await $.ui.mount(ROW)

  expect(await ui.find({ type: 'Text', text: /0 of 7 changed lines are HOT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Hidden files/ })).toBeDefined()
  await ui.press({ key: 'toggle-file:src/service.ts' })

  const hot = (await ui.findAll({ type: 'Button' })).map(one => one.key).find(one => one?.startsWith('hot-') === true)

  await ui.press({ key: hot ?? '' })
  expect(await ui.find({ type: 'Text', text: /7 of 7 changed lines are HOT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /You marked this as HOT/ })).toBeDefined()
  await ui.unmount()
})
