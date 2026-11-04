import type { EngineInterface } from 'claude-code'

import type { Snippet, StoredReview } from '../types'

const VERDICT_PREFIX = 'verdict:'
const REVIEW_PREFIX = 'review:'

export const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const memory = new Map<string, unknown>()
let onFull: (() => void) | null = null
let tail: Promise<void> = Promise.resolve()

export const setStoreFullListener = (listener: (() => void) | null): void => {
  onFull = listener
}

const inSequence = (work: () => Promise<void>): Promise<void> => {
  tail = tail.then(work, work)

  return tail
}

function writeValue($: EngineInterface, key: string, value: unknown): Promise<void> {
  return inSequence(async () => {
    try {
      await $.store.set(key, value)
      memory.delete(key)

      return
    } catch {
      const keys = await $.store.keys().catch(() => [] as string[])

      for (const old of keys.filter(name => name.startsWith(VERDICT_PREFIX)).slice(0, 200)) {
        await $.store.delete(old).catch(() => undefined)
      }
    }

    try {
      await $.store.set(key, value)
      memory.delete(key)
    } catch {
      memory.set(key, value)
      onFull?.()
    }
  })
}

async function readValue($: EngineInterface, key: string): Promise<unknown> {
  if (memory.has(key)) {
    return memory.get(key)
  }

  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

const isSnippetList = (value: unknown): value is Snippet[] => Array.isArray(value)

export async function readVerdict($: EngineInterface, hash: string): Promise<Snippet[] | null> {
  const value = await readValue($, `${VERDICT_PREFIX}${hash}`)

  return isSnippetList(value) ? value : null
}

export function writeVerdict($: EngineInterface, hash: string, snippets: readonly Snippet[]): Promise<void> {
  return writeValue($, `${VERDICT_PREFIX}${hash}`, snippets)
}

export const emptyReview = (): StoredReview => ({ drafts: [], read: [], promoted: [], body: '' })

export async function readReview($: EngineInterface, id: string): Promise<StoredReview> {
  const value = await readValue($, `${REVIEW_PREFIX}${id}`)

  if (typeof value !== 'object' || value === null) {
    return emptyReview()
  }

  return { ...emptyReview(), ...(value as Partial<StoredReview>) }
}

export function writeReview($: EngineInterface, id: string, review: StoredReview): Promise<void> {
  return writeValue($, `${REVIEW_PREFIX}${id}`, review)
}
