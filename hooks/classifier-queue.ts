import type { EngineInterface } from 'claude-code'

import type { DiffFile, Piece } from '../types'
import { buildPrompt, hashSource, MODEL, SYSTEM_PROMPT } from './classifier-prompt'
import { parseReply } from './classifier-reply'
import { isFixedZeroLockfile, isWhitespaceOnly } from './fixed-rules'
import { readVerdict, sha256, writeVerdict } from './review-store'

export const PIECE_LINES = 400
export const CONTEXT_LINES = 20
export const WORKERS = 4
export const MAX_TOKENS = 8000
export const TIMEOUT_MS = 120000
export const TOKEN_BUDGET = 3000000

export type Queue = {
  pieces: Piece[]
  files: readonly DiffFile[]
  tokensUsed: number
  budget: number
  isBudgetStopped: boolean
  running: number
  controller: AbortController
  isCancelled: () => boolean
  redraw: () => Promise<void>
}

export async function buildPieces($: EngineInterface, files: readonly DiffFile[]): Promise<Piece[]> {
  const pieces: Piece[] = []

  for (const file of files) {
    const isZeroLockfile = isFixedZeroLockfile(file, files)

    for (const hunk of file.hunks) {
      const isZeroSpace = isWhitespaceOnly(file, hunk)

      for (let offset = 0; offset < hunk.lines.length; offset += PIECE_LINES) {
        const lines = hunk.lines.slice(offset, offset + PIECE_LINES)
        const context = hunk.lines.slice(Math.max(0, offset - CONTEXT_LINES), offset)
        const hash = await sha256(hashSource(file.path, context, lines))
        const base = { fileIndex: file.index, hunkIndex: hunk.index, offset, lines, context, hash }

        if (isZeroLockfile) {
          pieces.push({
            ...base,
            state: 'fixed-zero',
            zeroTitle: 'Dependencies and runtime',
            zeroSummary: 'Lockfile changed together with a manifest',
          })
        } else if (isZeroSpace) {
          pieces.push({ ...base, state: 'fixed-zero', zeroTitle: 'Boilerplate', zeroSummary: 'Whitespace only' })
        } else {
          const stored = await readVerdict($, hash)

          pieces.push(stored === null ? { ...base, state: 'pending' } : { ...base, state: 'scored', snippets: stored })
        }
      }
    }
  }

  return pieces
}

async function classifyPiece($: EngineInterface, queue: Queue, piece: Piece): Promise<void> {
  const file = queue.files[piece.fileIndex]
  const hunk = file?.hunks[piece.hunkIndex]

  if (file === undefined || hunk === undefined) {
    piece.state = 'failed'
    piece.failure = 'the hunk was not found'

    return
  }

  const prompt = buildPrompt(file.path, hunk.symbol, piece.context, piece.lines)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await $.model.complete(
        {
          model: MODEL,
          system: [{ text: SYSTEM_PROMPT, cache: true }],
          prompt,
          maxTokens: MAX_TOKENS,
          timeoutMs: TIMEOUT_MS,
        },
        { signal: queue.controller.signal },
      )

      queue.tokensUsed +=
        reply.usage.input_tokens + reply.usage.cache_read_input_tokens + reply.usage.cache_creation_input_tokens

      if (reply.isAnswered) {
        const parsed = parseReply(reply.text, piece.lines.length)

        if (parsed.isValid) {
          piece.state = 'scored'
          piece.snippets = parsed.snippets
          delete piece.failure
          await writeVerdict($, piece.hash, parsed.snippets)

          return
        }

        piece.failure = parsed.reason
      } else if (reply.reason === 'aborted') {
        piece.state = 'aborted'
        piece.failure = 'the call was stopped'

        return
      } else {
        piece.failure = reply.reason === 'api-error' ? `API error ${reply.status ?? ''}`.trim() : 'the model returned no text'
      }
    } catch (error) {
      piece.failure = error instanceof Error ? error.message : String(error)
    }
  }

  piece.state = 'failed'
}

export async function runQueue($: EngineInterface, queue: Queue): Promise<void> {
  const worker = async (): Promise<void> => {
    for (;;) {
      if (queue.isCancelled()) {
        return
      }

      if (queue.tokensUsed >= queue.budget) {
        queue.isBudgetStopped = queue.pieces.some(piece => piece.state === 'pending')

        return
      }

      const piece = queue.pieces.find(one => one.state === 'pending')

      if (piece === undefined) {
        return
      }

      piece.state = 'running'
      await classifyPiece($, queue, piece)

      if (!queue.isCancelled()) {
        await queue.redraw()
      }
    }
  }

  queue.running += 1
  await queue.redraw()
  await Promise.all(Array.from({ length: WORKERS }, worker))
  queue.running -= 1

  if (!queue.isCancelled()) {
    await queue.redraw()
  }
}

export async function resumeQueue($: EngineInterface, queue: Queue): Promise<void> {
  for (const piece of queue.pieces) {
    if (piece.state === 'aborted') {
      piece.state = 'pending'
      delete piece.failure
    }
  }

  queue.controller = new AbortController()
  queue.isBudgetStopped = false
  await runQueue($, queue)
}
