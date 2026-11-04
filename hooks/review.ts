import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  DiffFile,
  DiffLine,
  Draft,
  LineLocation,
  ParsedDiff,
  PrInfo,
  PrRef,
  ReviewAction,
  StoredReview,
  Thread,
} from '../types'
import { buildPieces, CONFIRM_LINES, resumeQueue, runQueue, TOKEN_BUDGET } from './classifier-queue'
import type { Queue } from './classifier-queue'
import {
  closePr,
  deleteComment,
  postLineComment,
  replyToThread,
  setThreadResolved,
  submitReview,
  updateComment,
} from './github-actions'
import type { ReviewEvent } from './github-actions'
import { buildLocalMessage } from './local-send'
import { checkCounts, parseDiff } from './parse-diff'
import { emptyReview, readReview, setStoreFullListener, sha256, writeReview } from './review-store'
import { sanitizeLine } from './sanitize'
import { buildView, locateLines, paginate } from './sections'
import type { ExtraLines, View } from './sections'
import { readLocal, readLocalFile } from './source-local'
import { readHead, readPr, readPrFile, readThreads } from './source-pr'

const revision = atom({ plugin: 'easy-review', key: 'revision' } as const, 0)

const CONTEXT_STEP = 20

export type ReviewTarget = { kind: 'local'; base?: string } | { kind: 'pr'; ref: PrRef }

export type Session = {
  target: ReviewTarget
  status: 'loading' | 'confirm' | 'ready' | 'error'
  linesToClassify: number
  message: string
  id: string
  top: string
  branch: string
  baseName: string | null
  commit: string
  pr: PrInfo | null
  login: string
  diff: ParsedDiff | null
  countProblems: string[]
  banners: string[]
  queue: Queue | null
  stored: StoredReview
  threads: Thread[]
  extra: Map<string, ExtraLines>
  generation: number
  cachedKey: string
  cachedView: View | null
  cachedPages: View['blocks'][]
  cachedLocations: Map<string, LineLocation>
  cachedNotes: Map<string, Notes>
  orphanDrafts: number[]
  orphanThreads: number[]
  isPosting: boolean
}

export type Notes = { drafts: number[]; threads: number[] }

let session: Session | null = null
let generation = 0
let changes = 0

export const currentSession = (): Session | null => session

export async function redraw($: EngineInterface): Promise<void> {
  changes += 1

  try {
    await update($, revision, value => value + 1)
  } catch {
    return
  }
}

const newSession = (target: ReviewTarget, stored: StoredReview = emptyReview()): Session => {
  generation += 1

  return {
    target,
    status: 'loading',
    linesToClassify: 0,
    message: '',
    id: '',
    top: '',
    branch: '',
    baseName: null,
    commit: '',
    pr: null,
    login: '',
    diff: null,
    countProblems: [],
    banners: [],
    queue: null,
    stored,
    threads: [],
    extra: new Map(),
    generation,
    cachedKey: '',
    cachedView: null,
    cachedPages: [],
    cachedLocations: new Map(),
    cachedNotes: new Map(),
    orphanDrafts: [],
    orphanThreads: [],
    isPosting: false,
  }
}

const anchorKey = (path: string, side: string, line: number): string => `${path}\n${side}\n${line}`

const lineNumber = (location: LineLocation): number =>
  location.side === 'LEFT' ? (location.line.oldNo ?? 0) : (location.line.newNo ?? 0)

const refreshDrafts = async (current: Session): Promise<void> => {
  const locations = locateLines(current.diff?.files ?? [], current.extra)
  const byAnchor = new Map<string, LineLocation>()

  for (const location of locations.values()) {
    byAnchor.set(anchorKey(location.path, location.side, lineNumber(location)), location)
  }

  const drafts: Draft[] = []

  for (const draft of current.stored.drafts) {
    const location = byAnchor.get(anchorKey(draft.path, draft.side, draft.line))
    const hash = location === undefined ? '' : await sha256(location.line.text)

    drafts.push({ ...draft, hasMoved: hash !== draft.lineHash })
  }

  current.stored = { ...current.stored, drafts }
}

function persist($: EngineInterface, current: Session): Promise<void> {
  return writeReview($, current.id, current.stored)
}

const reviewId = (target: ReviewTarget, top: string, branch: string): string =>
  target.kind === 'local' ? `${top}:${branch}` : `${target.ref.owner}/${target.ref.repo}#${target.ref.number}`

async function loadSource($: EngineInterface, current: Session): Promise<string | null> {
  if (current.target.kind === 'local') {
    const local = await readLocal($, current.target.base)

    if (!local.isRead) {
      return local.message
    }

    current.top = local.source.top
    current.branch = local.source.branch
    current.baseName = local.source.baseName
    current.commit = local.source.commit
    current.id = reviewId(current.target, current.top, current.branch)
    current.diff = parseDiff(local.source.diffText)
    current.countProblems = checkCounts(current.diff.counts, local.source.expected)

    return null
  }

  const pr = await readPr($, current.target.ref)

  if (!pr.isRead) {
    return pr.message
  }

  current.pr = pr.source.info
  current.login = pr.source.login
  current.commit = pr.source.commit
  current.id = reviewId(current.target, '', '')
  current.diff = parseDiff(pr.source.diffText)
  current.countProblems = checkCounts(current.diff.counts, pr.source.expected)

  if (pr.source.banner !== undefined) {
    current.banners.push(pr.source.banner)
  }

  const threads = await readThreads($, current.target.ref)

  if (Array.isArray(threads)) {
    current.threads = threads
  } else {
    current.banners.push(`Could not read the existing discussions: ${threads.error}`)
  }

  return null
}

export async function openReview($: EngineInterface, target: ReviewTarget): Promise<void> {
  session?.queue?.controller.abort()

  const current = newSession(target)

  session = current
  await redraw($)

  const problem = await loadSource($, current)

  if (session !== current) {
    return
  }

  if (problem !== null || current.diff === null) {
    current.status = 'error'
    current.message = problem ?? 'The diff could not be read.'
    await redraw($)

    return
  }

  const saved = await readReview($, current.id)

  current.stored = { ...saved, drafts: saved.drafts.filter(draft => !draft.isSent) }
  setStoreFullListener(() => {
    if (!current.banners.includes(STORE_FULL)) {
      current.banners.push(STORE_FULL)
    }
  })
  await refreshDrafts(current)

  const pieces = await buildPieces($, current.diff.files)

  if (session !== current) {
    return
  }

  const queue: Queue = {
    pieces,
    files: current.diff.files,
    tokensUsed: 0,
    budget: TOKEN_BUDGET,
    isBudgetStopped: false,
    running: 0,
    controller: new AbortController(),
    isCancelled: () => session !== current,
    redraw: () => redraw($),
  }

  const linesToClassify = pieces
    .filter(piece => piece.state === 'pending')
    .reduce((total, piece) => total + piece.lines.filter(line => line.kind !== 'ctx').length, 0)

  current.queue = queue

  if (linesToClassify > CONFIRM_LINES) {
    current.status = 'confirm'
    current.linesToClassify = linesToClassify
    await redraw($)

    return
  }

  current.status = 'ready'
  await runQueue($, queue)
}

export async function confirmClassification($: EngineInterface): Promise<void> {
  if (session?.status === 'confirm' && session.queue !== null) {
    session.status = 'ready'
    await runQueue($, session.queue)
  }
}

export async function cancelClassification($: EngineInterface): Promise<void> {
  if (session?.status === 'confirm') {
    session.status = 'error'
    session.message = 'you cancelled it before classification, so no tokens were used.'
    await redraw($)
  }
}

const STORE_FULL = 'The review store is full. Drafts and verdicts are kept only until Claude Code closes.'

export async function resumeClassification($: EngineInterface): Promise<void> {
  if (session?.queue != null) {
    await resumeQueue($, session.queue)
  }
}

export async function continueClassification($: EngineInterface): Promise<void> {
  if (session?.queue != null) {
    session.queue.budget += TOKEN_BUDGET
    await resumeQueue($, session.queue)
  }
}

export type DrawnView = {
  view: View
  pages: View['blocks'][]
  locations: Map<string, LineLocation>
  notes: Map<string, Notes>
}

const buildNotes = (current: Session, locations: Map<string, LineLocation>): Map<string, Notes> => {
  const byAnchor = new Map<string, string>()
  const notes = new Map<string, Notes>()

  for (const [key, location] of locations) {
    byAnchor.set(anchorKey(location.path, location.side, lineNumber(location)), key)
  }

  const noteFor = (key: string): Notes => {
    const existing = notes.get(key)

    if (existing !== undefined) {
      return existing
    }

    const created: Notes = { drafts: [], threads: [] }

    notes.set(key, created)

    return created
  }

  current.orphanDrafts = []
  current.orphanThreads = []

  current.stored.drafts.forEach((draft, index) => {
    const key = draft.hasMoved ? undefined : byAnchor.get(anchorKey(draft.path, draft.side, draft.line))

    if (key === undefined) {
      current.orphanDrafts.push(index)
    } else {
      noteFor(key).drafts.push(index)
    }
  })

  current.threads.forEach((thread, index) => {
    const key = thread.line === null ? undefined : byAnchor.get(anchorKey(thread.path, thread.side, thread.line))

    if (key === undefined) {
      current.orphanThreads.push(index)
    } else {
      noteFor(key).threads.push(index)
    }
  })

  return notes
}

export const drawnView = (current: Session, expanded: readonly string[]): DrawnView => {
  const key = `${changes}|${expanded.join('\n')}`

  if (current.cachedView !== null && current.cachedKey === key) {
    return {
      view: current.cachedView,
      pages: current.cachedPages,
      locations: current.cachedLocations,
      notes: current.cachedNotes,
    }
  }

  const locations = locateLines(current.diff?.files ?? [], current.extra)
  const notes = buildNotes(current, locations)

  const noteSize = (lineKey: string): number => {
    const note = notes.get(lineKey)

    if (note === undefined) {
      return 0
    }

    const draftSize = note.drafts.reduce((total, index) => total + (current.stored.drafts[index]?.text.length ?? 0) + 200, 0)
    const threadSize = note.threads.reduce(
      (total, index) =>
        total + (current.threads[index]?.comments.reduce((sum, comment) => sum + comment.body.length + 200, 400) ?? 0),
      0,
    )

    return draftSize + threadSize
  }

  const view = buildView({
    files: current.diff?.files ?? [],
    pieces: current.queue?.pieces ?? [],
    read: new Set(current.stored.read),
    promoted: new Set(current.stored.promoted),
    expanded: new Set(expanded),
    extra: current.extra,
    noteSize,
    discussions: lineKey => notes.get(lineKey)?.threads.length ?? 0,
    isClassifying: (current.queue?.running ?? 0) > 0,
  })
  const pages = paginate(view.blocks)

  current.cachedKey = key
  current.cachedView = view
  current.cachedPages = pages
  current.cachedLocations = locations
  current.cachedNotes = notes

  return { view, pages, locations, notes }
}

export async function setRead($: EngineInterface, sectionId: string, isRead: boolean): Promise<void> {
  if (session === null) {
    return
  }

  const others = session.stored.read.filter(one => one !== sectionId)

  session.stored = { ...session.stored, read: isRead ? [...others, sectionId] : others }
  await persist($, session)
  await redraw($)
}

export async function promote($: EngineInterface, runKey: string): Promise<void> {
  if (session === null) {
    return
  }

  session.stored = { ...session.stored, promoted: [...session.stored.promoted.filter(one => one !== runKey), runKey] }
  await persist($, session)
  await redraw($)
}

export async function addContext(
  $: EngineInterface,
  sectionId: string,
  path: string,
  anchor: { first: number; last: number },
): Promise<string | null> {
  const current = session

  if (current === null) {
    return null
  }

  const rows =
    current.target.kind === 'local'
      ? await readLocalFile($, current.top, path)
      : await readPrFile($, current.target.ref, current.commit, path)

  if (rows === null) {
    return `Could not read ${path}.`
  }

  const existing = current.extra.get(sectionId)
  const startBefore = Math.max(1, anchor.first - (existing?.before.length ?? 0) - CONTEXT_STEP)
  const endAfter = Math.min(rows.length, anchor.last + (existing?.after.length ?? 0) + CONTEXT_STEP)
  const prefix = sectionId.slice(0, 12)

  const toLine = (no: number): DiffLine => ({
    key: `x.${prefix}.${no}`,
    kind: 'ctx',
    newNo: no,
    text: sanitizeLine(rows[no - 1] ?? '').text,
  })

  const range = (from: number, to: number): DiffLine[] =>
    Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => toLine(from + index))

  current.extra.set(sectionId, {
    path,
    before: range(startBefore, anchor.first - 1),
    after: range(anchor.last + 1, endAfter),
  })
  await redraw($)

  return null
}

export async function saveDraft($: EngineInterface, location: LineLocation, text: string): Promise<string | null> {
  const current = session
  const trimmed = text.trim()

  if (current === null || trimmed === '') {
    return null
  }

  if (location.isExtra && current.target.kind === 'pr') {
    return 'GitHub takes comments only on lines in the diff.'
  }

  const draft: Draft = {
    path: location.path,
    side: location.side,
    line: lineNumber(location),
    lineHash: await sha256(location.line.text),
    text: trimmed,
    isSent: false,
    hasMoved: false,
  }

  current.stored = { ...current.stored, drafts: [...current.stored.drafts, draft] }
  await persist($, current)

  if (current.target.kind === 'pr') {
    return postDraft($, current.stored.drafts.length - 1)
  }

  await redraw($)

  return null
}

export async function postDraft($: EngineInterface, index: number): Promise<string | null> {
  const current = session
  const draft = current?.stored.drafts[index]

  if (current === null || draft === undefined || current.target.kind !== 'pr') {
    return 'The comment could not be found.'
  }

  if (current.isPosting) {
    return 'Another comment is being posted. This one is kept on its line.'
  }

  const ref = current.target.ref

  current.isPosting = true
  await redraw($)

  try {
    const head = await readHead($, ref)

    if (head === null) {
      return 'Could not read the PR head, so the comment was not posted. It is kept on its line.'
    }

    if (head !== current.commit) {
      void openReview($, { kind: 'pr', ref })

      return `The PR moved to commit ${head.slice(0, 7)}, so the comment was not posted. It is kept, and the diff is being reloaded.`
    }

    const posted = await postLineComment($, ref, current.commit, draft)

    if (!posted.isDone) {
      return `GitHub refused the comment. It is kept on its line: ${posted.error}`
    }

    current.stored = { ...current.stored, drafts: current.stored.drafts.filter(one => one !== draft) }
    await persist($, current)

    const threads = await readThreads($, ref)

    if (!Array.isArray(threads)) {
      return `The comment is on GitHub, but the discussions could not be read again: ${threads.error}`
    }

    current.threads = threads

    return null
  } finally {
    current.isPosting = false
    await redraw($)
  }
}

export async function editDraft($: EngineInterface, index: number, text: string): Promise<void> {
  const current = session

  if (current === null) {
    return
  }

  const trimmed = text.trim()

  current.stored = {
    ...current.stored,
    drafts:
      trimmed === ''
        ? current.stored.drafts.filter((_, at) => at !== index)
        : current.stored.drafts.map((draft, at) => (at === index ? { ...draft, text: trimmed } : draft)),
  }
  await persist($, current)
  await redraw($)
}

export async function saveBody($: EngineInterface, text: string): Promise<void> {
  if (session === null) {
    return
  }

  session.stored = { ...session.stored, body: text.trim() }
  await persist($, session)
  await redraw($)
}

export async function sendToClaude($: EngineInterface): Promise<string> {
  const current = session

  if (current === null || current.target.kind !== 'local') {
    return 'Nothing was sent.'
  }

  const locations = locateLines(current.diff?.files ?? [], current.extra)
  const lineTextOf = (draft: Draft): string => {
    for (const location of locations.values()) {
      if (location.path === draft.path && location.side === draft.side && lineNumber(location) === draft.line) {
        return location.line.text
      }
    }

    return '(the line has moved)'
  }
  const unsent = current.stored.drafts.filter(draft => !draft.isSent)

  if (unsent.length === 0) {
    return 'There are no comments to send.'
  }

  const result = await $.prompt.submit({
    text: buildLocalMessage(unsent.map(draft => ({ draft, lineText: lineTextOf(draft) }))),
  })

  if (result.drop !== undefined) {
    return `Claude did not receive the comments: ${result.drop}`
  }

  current.stored = {
    ...current.stored,
    drafts: current.stored.drafts.map(draft => ({ ...draft, isSent: true })),
  }
  await persist($, current)
  await redraw($)

  return `Sent ${unsent.length} comments to Claude.`
}

const eventOf: Readonly<Record<'Comment' | 'Approve' | 'Request changes', ReviewEvent>> = {
  Comment: 'COMMENT',
  Approve: 'APPROVE',
  'Request changes': 'REQUEST_CHANGES',
}

async function refreshThreads($: EngineInterface, current: Session, ref: PrRef): Promise<void> {
  const threads = await readThreads($, ref)

  if (Array.isArray(threads)) {
    current.threads = threads
  }
}

export async function submitVerdict($: EngineInterface, action: ReviewAction): Promise<string> {
  const current = session

  if (current === null || current.target.kind !== 'pr' || action === 'Send to Claude') {
    return 'Nothing was sent.'
  }

  const ref = current.target.ref
  const head = await readHead($, ref)

  if (head === null) {
    return 'Could not read the PR head, so nothing was sent.'
  }

  if (head !== current.commit) {
    void openReview($, { kind: 'pr', ref })

    return `The PR moved to commit ${head.slice(0, 7)}, so nothing was sent. The diff is being reloaded. The summary and read sections are kept.`
  }

  if (action === 'Reject') {
    if (current.stored.body !== '') {
      const noted = await submitReview($, ref, current.commit, 'COMMENT', current.stored.body)

      if (!noted.isDone) {
        return `GitHub refused the summary, so the PR stays open: ${noted.error}`
      }

      current.stored = { ...current.stored, body: '' }
      await persist($, current)
    }

    const closed = await closePr($, ref)

    if (!closed.isDone) {
      await redraw($)

      return `GitHub refused to close the PR: ${closed.error}`
    }

    if (current.pr !== null) {
      current.pr = { ...current.pr, state: 'closed' }
    }

    await refreshThreads($, current, ref)
    await redraw($)

    return `PR #${ref.number} is closed.`
  }

  const sent = await submitReview($, ref, current.commit, eventOf[action], current.stored.body)

  if (!sent.isDone) {
    return `GitHub refused the review. The summary is kept: ${sent.error}`
  }

  current.stored = { ...current.stored, body: '' }
  await persist($, current)
  await refreshThreads($, current, ref)
  await redraw($)

  const after = await readHead($, ref)
  const done = `${action} sent on commit ${current.commit.slice(0, 7)}.`

  return after !== null && after !== current.commit
    ? `${done} The PR moved to ${after.slice(0, 7)} at the same moment, so this applies to the older commit.`
    : done
}

export async function replyInThread($: EngineInterface, index: number, text: string): Promise<string | null> {
  const current = session
  const thread = current?.threads[index]
  const trimmed = text.trim()

  if (current === null || thread === undefined || trimmed === '') {
    return null
  }

  const result = await replyToThread($, thread.id, trimmed)

  if (!result.isDone) {
    return `GitHub refused the reply: ${result.error}`
  }

  current.threads = current.threads.map((one, at) =>
    at === index ? { ...one, comments: [...one.comments, result.data] } : one,
  )
  await redraw($)

  return null
}

export async function editPostedComment(
  $: EngineInterface,
  threadIndex: number,
  commentIndex: number,
  text: string,
): Promise<string | null> {
  const current = session
  const comment = current?.threads[threadIndex]?.comments[commentIndex]
  const trimmed = text.trim()

  if (current === null || comment === undefined) {
    return null
  }

  if (trimmed === '') {
    const removed = await deleteComment($, comment.id)

    if (!removed.isDone) {
      return `GitHub refused to delete the comment: ${removed.error}`
    }

    current.threads = current.threads
      .map((one, at) =>
        at === threadIndex ? { ...one, comments: one.comments.filter((_, inner) => inner !== commentIndex) } : one,
      )
      .filter(one => one.comments.length > 0)
    await redraw($)

    return null
  }

  const updated = await updateComment($, comment.id, trimmed)

  if (!updated.isDone) {
    return `GitHub refused the edit: ${updated.error}`
  }

  current.threads = current.threads.map((one, at) =>
    at === threadIndex
      ? { ...one, comments: one.comments.map((old, inner) => (inner === commentIndex ? updated.data : old)) }
      : one,
  )
  await redraw($)

  return null
}

export async function resolveThread($: EngineInterface, index: number, isResolved: boolean): Promise<string | null> {
  const current = session
  const thread = current?.threads[index]

  if (current === null || thread === undefined) {
    return null
  }

  const result = await setThreadResolved($, thread.id, isResolved)

  if (!result.isDone) {
    return `GitHub refused the change: ${result.error}`
  }

  current.threads = current.threads.map((one, at) => (at === index ? { ...one, ...result.data } : one))
  await redraw($)

  return null
}

export const fileOf = (current: Session, index: number): DiffFile | undefined => current.diff?.files[index]

export const canApprove = (current: Session): boolean => {
  const queue = current.queue

  return (
    queue !== null &&
    queue.running === 0 &&
    !queue.pieces.some(piece => piece.state === 'aborted' || piece.state === 'running')
  )
}
