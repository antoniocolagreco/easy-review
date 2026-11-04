import type { EngineInterface } from 'claude-code'

import type { Draft, PrRef, Thread, ThreadComment } from '../types'
import { sanitizeText } from './sanitize'

export type ActionResult<T> = { isDone: true; data: T } | { isDone: false; error: string }

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const errorText = (stdout: string, stderr: string): string => {
  const body = asRecord(parseJson(stdout))
  const errors = body['errors']
  const details = Array.isArray(errors)
    ? errors.map(item => (typeof item === 'string' ? item : String(asRecord(item)['message'] ?? ''))).filter(text => text !== '')
    : []
  const message = typeof body['message'] === 'string' ? body['message'] : ''

  return sanitizeText([stderr.trim(), message, ...details].filter(text => text !== '').join(': ')).slice(0, 500) || 'GitHub gave no reason.'
}

async function callGh($: EngineInterface, argv: readonly string[], body: unknown): Promise<ActionResult<unknown>> {
  try {
    const result = await $.process.run(['gh', 'api', ...argv, '--input', '-'], {
      stdin: JSON.stringify(body),
      timeoutMs: 60000,
    })

    return result.exitCode === 0
      ? { isDone: true, data: parseJson(result.stdout) }
      : { isDone: false, error: errorText(result.stdout, result.stderr) }
  } catch (error) {
    return { isDone: false, error: sanitizeText(error instanceof Error ? error.message : String(error)) }
  }
}

async function graphql($: EngineInterface, query: string, variables: Record<string, unknown>): Promise<ActionResult<Record<string, unknown>>> {
  const result = await callGh($, ['graphql'], { query, variables })

  if (!result.isDone) {
    return result
  }

  const body = asRecord(result.data)

  return Array.isArray(body['errors'])
    ? { isDone: false, error: errorText(JSON.stringify(body), '') }
    : { isDone: true, data: asRecord(body['data']) }
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

export function submitReview(
  $: EngineInterface,
  ref: PrRef,
  commit: string,
  event: ReviewEvent,
  body: string,
): Promise<ActionResult<unknown>> {
  return callGh($, ['-X', 'POST', `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`], {
    commit_id: commit,
    event,
    body,
  })
}

export function postLineComment($: EngineInterface, ref: PrRef, commit: string, draft: Draft): Promise<ActionResult<unknown>> {
  return callGh($, ['-X', 'POST', `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments`], {
    commit_id: commit,
    path: draft.path,
    line: draft.line,
    side: draft.side,
    body: draft.text,
  })
}

export function closePr($: EngineInterface, ref: PrRef): Promise<ActionResult<unknown>> {
  return callGh($, ['-X', 'PATCH', `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`], { state: 'closed' })
}

const COMMENT_FIELDS = 'id body author { login } viewerCanUpdate viewerCanDelete'

const toComment = (raw: unknown): ThreadComment => {
  const comment = asRecord(raw)

  return {
    id: String(comment['id'] ?? ''),
    author: sanitizeText(String(asRecord(comment['author'])['login'] ?? 'unknown')),
    body: sanitizeText(String(comment['body'] ?? '').replaceAll('\n', ' ')),
    canUpdate: comment['viewerCanUpdate'] === true,
    canDelete: comment['viewerCanDelete'] === true,
  }
}

export async function replyToThread($: EngineInterface, threadId: string, body: string): Promise<ActionResult<ThreadComment>> {
  const result = await graphql(
    $,
    `mutation($id: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
        comment { ${COMMENT_FIELDS} }
      }
    }`,
    { id: threadId, body },
  )

  return result.isDone
    ? { isDone: true, data: toComment(asRecord(result.data['addPullRequestReviewThreadReply'])['comment']) }
    : result
}

export async function updateComment($: EngineInterface, commentId: string, body: string): Promise<ActionResult<ThreadComment>> {
  const result = await graphql(
    $,
    `mutation($id: ID!, $body: String!) {
      updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
        pullRequestReviewComment { ${COMMENT_FIELDS} }
      }
    }`,
    { id: commentId, body },
  )

  return result.isDone
    ? { isDone: true, data: toComment(asRecord(result.data['updatePullRequestReviewComment'])['pullRequestReviewComment']) }
    : result
}

export async function deleteComment($: EngineInterface, commentId: string): Promise<ActionResult<null>> {
  const result = await graphql(
    $,
    `mutation($id: ID!) {
      deletePullRequestReviewComment(input: { id: $id }) { clientMutationId }
    }`,
    { id: commentId },
  )

  return result.isDone ? { isDone: true, data: null } : result
}

const THREAD_FIELDS = 'isResolved viewerCanReply viewerCanResolve viewerCanUnresolve'

export type ThreadState = Pick<Thread, 'isResolved' | 'canReply' | 'canResolve' | 'canUnresolve'>

export async function setThreadResolved($: EngineInterface, threadId: string, isResolved: boolean): Promise<ActionResult<ThreadState>> {
  const field = isResolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  const result = await graphql(
    $,
    `mutation($id: ID!) { ${field}(input: { threadId: $id }) { thread { ${THREAD_FIELDS} } } }`,
    { id: threadId },
  )

  if (!result.isDone) {
    return result
  }

  const thread = asRecord(asRecord(result.data[field])['thread'])

  return {
    isDone: true,
    data: {
      isResolved: thread['isResolved'] === true,
      canReply: thread['viewerCanReply'] === true,
      canResolve: thread['viewerCanResolve'] === true,
      canUnresolve: thread['viewerCanUnresolve'] === true,
    },
  }
}
