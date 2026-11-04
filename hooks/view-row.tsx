import { atom, read, update } from 'claude-code'
import type { Elements as AllElements, EngineInterface, RenderElement } from 'claude-code'

import type { Block, Composer, DiffLine, Draft, HeadingBlock, ReviewAction, Thread } from '../types'
import {
  addContext,
  canApprove,
  continueClassification,
  currentSession,
  drawnView,
  promote,
  redraw,
  resolveThread,
  resumeClassification,
  sendToClaude,
  setRead,
  submitVerdict,
} from './review'
import type { Notes, Session } from './review'

const rowId = atom({ plugin: 'easy-review', key: 'rowId' } as const, null)
const revision = atom({ plugin: 'easy-review', key: 'revision' } as const, 0)
const pageAtom = atom({ plugin: 'easy-review', key: 'page' } as const, 0)
const selected = atom({ plugin: 'easy-review', key: 'selected' } as const, null)
const composer = atom({ plugin: 'easy-review', key: 'composer' } as const, null)
const expanded = atom({ plugin: 'easy-review', key: 'expanded' } as const, [])
const pending = atom({ plugin: 'easy-review', key: 'pending' } as const, null)
const outcome = atom({ plugin: 'easy-review', key: 'outcome' } as const, null)

export type Elements = AllElements['terminal'] | AllElements['desktop']

const formatCount = (value: number): string => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const percent = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 100))

const commentCount = (count: number): string => `${count} ${count === 1 ? 'comment' : 'comments'}`

const splitAfterNotes = (lines: readonly DiffLine[], notes: ReadonlyMap<string, Notes>): DiffLine[][] => {
  const runs: DiffLine[][] = []
  let run: DiffLine[] = []

  for (const line of lines) {
    run.push(line)

    if (notes.has(line.key)) {
      runs.push(run)
      run = []
    }
  }

  return run.length > 0 ? [...runs, run] : runs
}

const confirmText = (current: Session, action: ReviewAction, hiddenLines: number, read: number, total: number): string => {
  const commit = current.commit.slice(0, 7)
  const number = current.pr?.number ?? 0
  const moved = current.stored.drafts.filter(draft => draft.hasMoved).length
  const movedNote = moved > 0 ? ` ${moved} comments on moved lines stay as drafts.` : ''

  if (action === 'Reject') {
    return `Close PR #${number} without merging it?${movedNote}`
  }

  return `${action} on commit ${commit}? You read ${read} of ${total} sections, and ${formatCount(hiddenLines)} changed lines are hidden.${movedNote}`
}

export async function renderRow($: EngineInterface, elements: Elements, rowKey: string): Promise<RenderElement> {
  const { Box, Button, Client, Text } = elements
  const current = currentSession()
  const activeRow = await read($, rowId)

  if (activeRow !== rowKey || current === null) {
    return <Text dimColor>easy-review: this review was reopened further down, or Claude Code reloaded the mod. Run /easy-review again.</Text>
  }

  await read($, revision)

  if (current.status === 'loading') {
    return <Text dimColor>easy-review: reading the diff...</Text>
  }

  if (current.status === 'error') {
    return <Text color="red">easy-review stopped: {current.message}</Text>
  }

  const picked = await read($, selected)
  const open = await read($, expanded)
  const action = await read($, pending)
  const result = await read($, outcome)
  const pageIndex = await read($, pageAtom)
  const { view, pages, notes } = drawnView(current, open)
  const { counts } = view
  const safePage = Math.min(pageIndex, pages.length - 1)
  const blocks = pages[safePage] ?? []
  const queue = current.queue
  const finished = queue?.pieces.filter(piece => piece.state !== 'pending' && piece.state !== 'running').length ?? 0
  const totalPieces = queue?.pieces.length ?? 0
  const isClassifying = (queue?.running ?? 0) > 0
  const stopped = queue?.pieces.filter(piece => piece.state === 'aborted').length ?? 0
  const isPr = current.target.kind === 'pr'
  const isOpenPr = current.pr?.state === 'open'
  const drafts = current.stored.drafts
  const unsent = drafts.filter(draft => !draft.isSent).length

  const toggle = (key: string) =>
    update($, expanded, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key]))

  const openComposer = async (target: Composer) => {
    await update($, selected, () => null)
    await update($, composer, () => target)
  }

  const say = (message: string | null) => update($, outcome, () => message)

  const drawDraft = (draft: Draft, index: number) => (
    <Box key={`draft-${index}`} justifyContent="space-between" borderStyle="round" paddingX={1} marginLeft={8}>
      <Text>
        {draft.isSent ? 'Sent' : draft.hasMoved ? `Moved (${draft.path}:${draft.line})` : 'Draft'}: {draft.text}
      </Text>
      {!draft.isSent && (
        <Button key={`edit-draft-${index}`} plain dimColor onPress={() => openComposer({ kind: 'draft', index })}>
          Edit
        </Button>
      )}
    </Box>
  )

  const drawThread = (thread: Thread, index: number) =>
    thread.isResolved ? (
      <Box key={`thread-${index}`} marginLeft={8}>
        <Text dimColor>Resolved ({thread.comments.length} comments) </Text>
        {thread.canUnresolve && (
          <Button
            key={`unresolve-thread-${index}`}
            plain
            dimColor
            onPress={async () => say(await resolveThread($, index, false))}
          >
            Unresolve
          </Button>
        )}
      </Box>
    ) : (
      <Box key={`thread-${index}`} flexDirection="column" borderStyle="round" paddingX={1} marginLeft={8}>
        {thread.isOutdated && <Text dimColor>Outdated: {thread.path}</Text>}
        {thread.comments.map((comment, commentIndex) => (
          <Box key={`comment-${index}-${commentIndex}`} justifyContent="space-between">
            <Text>
              {comment.author}: {comment.body}
            </Text>
            {(comment.canUpdate || comment.canDelete) && (
              <Button
                key={`edit-comment-${index}-${commentIndex}`}
                plain
                dimColor
                onPress={() => openComposer({ kind: 'edit', thread: index, comment: commentIndex })}
              >
                Edit
              </Button>
            )}
          </Box>
        ))}
        <Box>
          {thread.canReply && (
            <Button key={`reply-thread-${index}`} onPress={() => openComposer({ kind: 'reply', thread: index })}>
              Reply
            </Button>
          )}
          {thread.canResolve && (
            <Button key={`resolve-thread-${index}`} onPress={async () => say(await resolveThread($, index, true))}>
              Resolve
            </Button>
          )}
        </Box>
      </Box>
    )

  const drawHeading = (block: HeadingBlock) => {
    if (block.isRead) {
      return (
        <Box key={`heading-${block.sectionId}`} marginTop={1} justifyContent="space-between">
          <Text dimColor>
            Read: {block.path} {block.title === undefined ? '' : `(${block.title})`}
          </Text>
          <Button key={`unread-${block.sectionId}`} plain dimColor onPress={() => setRead($, block.sectionId, false)}>
            Mark unread
          </Button>
        </Box>
      )
    }

    return (
      <Box key={`heading-${block.sectionId}`} flexDirection="column" marginTop={1}>
        <Text weight="semibold">
          {block.path}
          {block.symbol === undefined ? '' : `  ${block.symbol}`}
        </Text>
        {block.summary !== '' && <Text>{block.summary} (generated)</Text>}
        {block.isCrlf && <Text dimColor>This file uses CRLF line endings.</Text>}
        <Box marginTop={1}>
          <Text color="yellow">{block.title ?? block.status ?? ''}</Text>
        </Box>
        {block.description !== undefined && <Text dimColor>{block.description}</Text>}
        {block.isPromoted && <Text dimColor>You marked this as HOT.</Text>}
      </Box>
    )
  }

  const drawBlock = (block: Block) => {
    switch (block.kind) {
      case 'heading':
        return drawHeading(block)
      case 'lines':
        return (
          <Box key={`lines-${block.id}`} flexDirection="column">
            {splitAfterNotes(block.lines, notes).map((run, runIndex) => {
              const last = run.at(-1)
              const note = last === undefined ? undefined : notes.get(last.key)

              return (
                <Box key={`run-${block.id}-${runIndex}`} flexDirection="column">
                  <Client
                    key={`diff-${block.id}-${runIndex}`}
                    module="./diff-client.tsx"
                    width="100%"
                    props={{ lines: run, path: block.path, selectedKey: picked }}
                  />
                  {note?.threads.map(index => {
                    const thread = current.threads[index]

                    return thread === undefined ? null : drawThread(thread, index)
                  })}
                  {note?.drafts.map(index => {
                    const draft = drafts[index]

                    return draft === undefined ? null : drawDraft(draft, index)
                  })}
                </Box>
              )
            })}
          </Box>
        )
      case 'section-end': {
        const anchor = block.anchor

        return (
          <Box key={`end-${block.sectionId}`}>
            <Button key={`read-${block.sectionId}`} plain dimColor onPress={() => setRead($, block.sectionId, true)}>
              Mark read
            </Button>
            <Text> </Text>
            {anchor !== undefined && (
              <Button
                key={`more-${block.sectionId}`}
                plain
                dimColor
                onPress={async () => say(await addContext($, block.sectionId, block.path, anchor))}
              >
                More context
              </Button>
            )}
          </Box>
        )
      }
      case 'hidden-run':
        return (
          <Box key={`hidden-${block.runKey}`} flexDirection="column">
            <Button key={`toggle-${block.runKey}`} plain dimColor onPress={() => toggle(block.runKey)}>
              {block.isOpen ? 'v' : '>'} {block.lineCount} COLD lines hidden: {block.title}, {block.summary}
              {block.discussions > 0 ? ` (${block.discussions} discussions)` : ''}
            </Button>
            {block.isOpen && (
              <Button key={`hot-${block.runKey}`} plain dimColor onPress={() => promote($, block.runKey)}>
                Mark as HOT
              </Button>
            )}
          </Box>
        )
      case 'related':
        return (
          <Button key={`toggle-${block.runKey}`} plain dimColor onPress={() => toggle(block.runKey)}>
            {block.isOpen ? 'v' : '>'} Related hidden change: {block.name} in {block.path} ({block.lineCount} lines)
          </Button>
        )
      case 'hidden-title':
        return (
          <Box key="hidden-title" marginTop={1}>
            <Text weight="semibold">Hidden files</Text>
          </Box>
        )
      case 'hidden-file':
        return block.lineCount === 0 ? (
          <Text key={`file-${block.fileKey}`} dimColor>
            {block.path}: {block.summary}
          </Text>
        ) : (
          <Button key={`toggle-${block.fileKey}`} plain dimColor onPress={() => toggle(block.fileKey)}>
            {block.isOpen ? 'v' : '>'} {block.path} ({block.lineCount} lines, {block.summary})
            {block.discussions > 0 ? ` (${block.discussions} discussions)` : ''}
          </Button>
        )
    }
  }

  const pager =
    pages.length > 1 ? (
      <Box>
        {safePage > 0 && (
          <Button key="page-previous" onPress={() => update($, pageAtom, () => safePage - 1)}>
            Previous
          </Button>
        )}
        <Text> Page {safePage + 1} of {pages.length} </Text>
        {safePage < pages.length - 1 && (
          <Button key="page-next" onPress={() => update($, pageAtom, () => safePage + 1)}>
            Next
          </Button>
        )}
      </Box>
    ) : null

  const sendVerdict = async (kind: ReviewAction) => {
    await update($, pending, () => null)
    await say('Sending...')
    await say(await submitVerdict($, kind))
    await redraw($)
  }

  const isNoHot =
    counts.hot === 0 && counts.notClassified === 0 && view.isComplete && current.countProblems.length === 0 && !isClassifying

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        {current.pr === null ? (
          <Box flexDirection="column">
            <Text weight="semibold">
              Local review of {current.branch}, commit {current.commit.slice(0, 7)}
            </Text>
            <Text color="yellow">Nothing reaches GitHub. Comments go to Claude.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text weight="semibold">
              PR #{current.pr.number} {current.pr.title}
            </Text>
            <Text dimColor>
              {current.pr.author} wants to merge {current.pr.headRef} into {current.pr.baseRef}, commit{' '}
              {current.commit.slice(0, 7)}. You review as {current.login}.
            </Text>
            {!isOpenPr && <Text color="yellow">This PR is {current.pr.state}.</Text>}
          </Box>
        )}
        <Text>
          {formatCount(counts.hot)} of {formatCount(counts.changed)} changed lines are HOT ({percent(counts.hot, counts.changed)}%)
        </Text>
        {counts.notClassified > 0 && <Text color="yellow">{formatCount(counts.notClassified)} lines not classified</Text>}
        <Text dimColor>
          {formatCount(counts.hiddenLines)} lines hidden in {counts.hiddenRuns} {counts.hiddenRuns === 1 ? 'run' : 'runs'}. {counts.sectionsRead} of {counts.sections} sections read. Tokens used:{' '}
          {formatCount(queue?.tokensUsed ?? 0)}.
        </Text>
        {isClassifying && (
          <Text color="yellow">
            Classifying: {finished} of {totalPieces} pieces done.
          </Text>
        )}
        {stopped > 0 && !isClassifying && (
          <Box>
            <Text color="yellow">Classification stopped with {stopped} pieces left. </Text>
            <Button key="resume-classification" onPress={() => resumeClassification($)}>
              Resume classification
            </Button>
          </Box>
        )}
        {queue?.isBudgetStopped === true && !isClassifying && (
          <Box>
            <Text color="yellow">The token budget is used up. Unclassified lines stay visible. </Text>
            <Button key="continue-classification" onPress={() => continueClassification($)}>
              Continue classification
            </Button>
          </Box>
        )}
        {current.countProblems.length > 0 && (
          <Text color="red">The diff read does not match the expected counts: {current.countProblems.join(', ')}</Text>
        )}
        {current.banners.map((banner, index) => (
          <Text key={`banner-${index}`} color="yellow">
            {banner}
          </Text>
        ))}
        {isNoHot && <Text color="green">No HOT sections.</Text>}
      </Box>
      {pager}
      {blocks.map(drawBlock)}
      {current.orphanDrafts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text weight="semibold">Comments on lines that moved</Text>
          {current.orphanDrafts.map(index => {
            const draft = drafts[index]

            return draft === undefined ? null : drawDraft(draft, index)
          })}
        </Box>
      )}
      {current.orphanThreads.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text weight="semibold">Discussions on lines outside this diff</Text>
          {current.orphanThreads.map(index => {
            const thread = current.threads[index]

            return thread === undefined ? null : drawThread(thread, index)
          })}
        </Box>
      )}
      {pager}
      <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
        <Text weight="semibold">Finish your review</Text>
        {!isPr ? (
          <Box flexDirection="column">
            <Text dimColor>{commentCount(unsent)} to send.</Text>
            {unsent > 0 ? (
              <Button key="send-to-claude" variant="primary" onPress={async () => say(await sendToClaude($))}>
                Send to Claude
              </Button>
            ) : (
              <Text dimColor>Click a line to write a comment.</Text>
            )}
          </Box>
        ) : !isOpenPr ? (
          <Text dimColor>This PR is {current.pr?.state}, so no verdict can be sent.</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>
              {commentCount(unsent)} in this review.{current.stored.body === '' ? '' : ` Summary: ${current.stored.body}`}
            </Text>
            {action === null ? (
              <Box>
                <Button key="review-body" onPress={() => openComposer({ kind: 'body' })}>
                  Write summary
                </Button>
                {(unsent > 0 || current.stored.body !== '') && (
                  <Button key="review-comment" onPress={() => update($, pending, () => 'Comment')}>
                    Comment
                  </Button>
                )}
                {canApprove(current) ? (
                  <Button key="review-approve" variant="primary" onPress={() => update($, pending, () => 'Approve')}>
                    Approve
                  </Button>
                ) : (
                  <Text dimColor> Approve waits for classification. </Text>
                )}
                {(unsent > 0 || current.stored.body !== '') && (
                  <Button key="review-changes" onPress={() => update($, pending, () => 'Request changes')}>
                    Request changes
                  </Button>
                )}
                <Button key="review-reject" onPress={() => update($, pending, () => 'Reject')}>
                  Reject (close PR)
                </Button>
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text>{confirmText(current, action, counts.hiddenLines, counts.sectionsRead, counts.sections)}</Text>
                <Box>
                  <Button key="confirm" variant="primary" onPress={() => sendVerdict(action)}>
                    Confirm
                  </Button>
                  <Button key="cancel" onPress={() => update($, pending, () => null)}>
                    Cancel
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )}
        {result !== null && <Text color="green">{result}</Text>}
      </Box>
    </Box>
  )
}
