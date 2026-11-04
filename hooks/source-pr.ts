import type { EngineInterface } from 'claude-code'

import type { DiffCounts, PrInfo, PrRef, Side, Thread, ThreadComment } from '../types'
import { NO_PATCH_MARK } from './parse-diff'
import { collect } from './process'
import { sanitizeText } from './sanitize'

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9_.][\w.-]*)\/pull\/([1-9]\d*)\/?$/

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id path line diffSide isResolved isOutdated viewerCanReply viewerCanResolve viewerCanUnresolve
          comments(first: 100) {
            nodes { id body author { login } viewerCanUpdate viewerCanDelete }
          }
        }
      }
    }
  }
}`

export type PrSource = {
  info: PrInfo
  login: string
  commit: string
  diffText: string
  expected: DiffCounts
  banner?: string
}

export type PrResult = { isRead: true; source: PrSource } | { isRead: false; message: string }

const fail = (message: string): PrResult => ({ isRead: false, message })

const short = (text: string): string => sanitizeText(text).trim().slice(0, 500)

export const parsePrUrl = (raw: string): PrRef | null => {
  const match = PR_URL.exec(raw.trim())

  if (match === null) {
    return null
  }

  return { owner: match[1] ?? '', repo: match[2] ?? '', number: Number(match[3]) }
}

const pullPath = (ref: PrRef): string => `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const fileToDiff = (raw: unknown): string => {
  const file = asRecord(raw)
  const path = asString(file['filename'])
  const previous = asString(file['previous_filename'])
  const status = asString(file['status'])
  const patch = file['patch']
  const oldName = previous === '' ? path : previous
  const header = [`diff --git a/${oldName} b/${path}`]

  if (status === 'renamed') {
    header.push(`rename from ${oldName}`, `rename to ${path}`)
  }

  if (typeof patch !== 'string') {
    return [...header, NO_PATCH_MARK].join('\n')
  }

  return [
    ...header,
    `--- ${status === 'added' ? '/dev/null' : `a/${oldName}`}`,
    `+++ ${status === 'removed' ? '/dev/null' : `b/${path}`}`,
    patch,
  ].join('\n')
}

async function readDiff($: EngineInterface, ref: PrRef): Promise<{ text: string; banner?: string } | { error: string }> {
  const whole = await collect($, ['gh', 'api', '-H', 'Accept: application/vnd.github.diff', pullPath(ref)])

  if (whole.code === 0) {
    return { text: whole.stdout }
  }

  const list = await collect($, ['gh', 'api', '--paginate', '--slurp', `${pullPath(ref)}/files?per_page=100`])

  if (list.code !== 0) {
    return { error: short(`${whole.stderr} ${list.stderr}`) }
  }

  const pages = parseJson(list.stdout)
  const files = Array.isArray(pages) ? pages.flat() : []

  return {
    text: files.map(fileToDiff).join('\n'),
    banner: 'GitHub refused the full diff, so this review uses its list of files. It stops at 3,000 files, and a file can come with no diff.',
  }
}

export async function readPr($: EngineInterface, ref: PrRef): Promise<PrResult> {
  const user = await collect($, ['gh', 'api', 'user'])

  if (user.code === null) {
    return fail('The gh program could not start. Install it and run gh auth login.')
  }

  if (user.code !== 0) {
    return fail(`gh is not logged in: ${short(user.stderr)}`)
  }

  const pr = await collect($, ['gh', 'api', pullPath(ref)])

  if (pr.code !== 0) {
    return fail(`Could not read PR #${ref.number}: ${short(pr.stderr)}`)
  }

  const data = asRecord(parseJson(pr.stdout))
  const head = asRecord(data['head'])
  const base = asRecord(data['base'])
  const commit = asString(head['sha'])

  if (commit === '') {
    return fail(`GitHub returned no head commit for PR #${ref.number}.`)
  }

  const diff = await readDiff($, ref)

  if ('error' in diff) {
    return fail(`Could not read the diff of PR #${ref.number}: ${diff.error}`)
  }

  return {
    isRead: true,
    source: {
      info: {
        ...ref,
        title: sanitizeText(asString(data['title'])),
        author: sanitizeText(asString(asRecord(data['user'])['login'])),
        headRef: sanitizeText(asString(head['ref'])),
        baseRef: sanitizeText(asString(base['ref'])),
        state: asString(data['state']),
      },
      login: sanitizeText(asString(asRecord(parseJson(user.stdout))['login'])),
      commit,
      diffText: diff.text,
      expected: {
        files: asNumber(data['changed_files']),
        additions: asNumber(data['additions']),
        deletions: asNumber(data['deletions']),
      },
      ...(diff.banner === undefined ? {} : { banner: diff.banner }),
    },
  }
}

export async function readHead($: EngineInterface, ref: PrRef): Promise<string | null> {
  const pr = await collect($, ['gh', 'api', pullPath(ref)])

  if (pr.code !== 0) {
    return null
  }

  const sha = asString(asRecord(asRecord(parseJson(pr.stdout))['head'])['sha'])

  return sha === '' ? null : sha
}

const toComment = (raw: unknown): ThreadComment => {
  const comment = asRecord(raw)

  return {
    id: asString(comment['id']),
    author: sanitizeText(asString(asRecord(comment['author'])['login'])) || 'unknown',
    body: sanitizeText(asString(comment['body']).replaceAll('\n', ' ')),
    canUpdate: comment['viewerCanUpdate'] === true,
    canDelete: comment['viewerCanDelete'] === true,
  }
}

const toThread = (raw: unknown): Thread => {
  const thread = asRecord(raw)
  const comments = asRecord(thread['comments'])['nodes']
  const line = thread['line']

  return {
    id: asString(thread['id']),
    path: sanitizeText(asString(thread['path'])),
    side: (thread['diffSide'] === 'LEFT' ? 'LEFT' : 'RIGHT') satisfies Side,
    line: typeof line === 'number' ? line : null,
    isResolved: thread['isResolved'] === true,
    isOutdated: thread['isOutdated'] === true,
    canReply: thread['viewerCanReply'] === true,
    canResolve: thread['viewerCanResolve'] === true,
    canUnresolve: thread['viewerCanUnresolve'] === true,
    comments: Array.isArray(comments) ? comments.map(toComment) : [],
  }
}

export async function readThreads($: EngineInterface, ref: PrRef): Promise<Thread[] | { error: string }> {
  const threads: Thread[] = []
  let after: string | null = null

  for (;;) {
    const output = await collect($, ['gh', 'api', 'graphql', '--input', '-'], {
      input: JSON.stringify({
        query: THREADS_QUERY,
        variables: { owner: ref.owner, name: ref.repo, number: ref.number, after },
      }),
    })

    if (output.code !== 0) {
      return { error: short(output.stderr) }
    }

    const repository = asRecord(asRecord(asRecord(parseJson(output.stdout))['data'])['repository'])
    const page = asRecord(asRecord(repository['pullRequest'])['reviewThreads'])
    const nodes = page['nodes']
    const info = asRecord(page['pageInfo'])

    threads.push(...(Array.isArray(nodes) ? nodes.map(toThread) : []))

    if (info['hasNextPage'] !== true) {
      return threads
    }

    after = asString(info['endCursor'])
  }
}

export async function readPrFile($: EngineInterface, ref: PrRef, sha: string, path: string): Promise<string[] | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const output = await collect($, [
    'gh',
    'api',
    '-H',
    'Accept: application/vnd.github.raw+json',
    `repos/${ref.owner}/${ref.repo}/contents/${encoded}?ref=${sha}`,
  ])

  return output.code === 0 ? output.stdout.split('\n') : null
}
