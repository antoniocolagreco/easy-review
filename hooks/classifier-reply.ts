import type { Snippet } from '../types'
import { computeRisk, isHot } from './risk'
import { sanitizeText } from './sanitize'
import { TITLE_NAMES } from './titles'

const SUMMARY_LIMIT = 300
const DESCRIPTION_LIMIT = 600

export type ReplyResult = { isValid: true; snippets: Snippet[] } | { isValid: false; reason: string }

const invalid = (reason: string): ReplyResult => ({ isValid: false, reason })

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3

const stripFence = (text: string): string => {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(trimmed)

  return match?.[1] ?? trimmed
}

const clean = (value: string, limit: number): string => sanitizeText(value).trim().slice(0, limit)

export const parseReply = (text: string, lineCount: number): ReplyResult => {
  let parsed: unknown

  try {
    parsed = JSON.parse(stripFence(text))
  } catch {
    return invalid('the reply is not valid JSON')
  }

  if (typeof parsed !== 'object' || parsed === null || !('snippets' in parsed) || !Array.isArray(parsed.snippets)) {
    return invalid('the reply has no snippets')
  }

  const snippets: Snippet[] = []
  let expected = 1

  for (const item of parsed.snippets as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      return invalid('a snippet is not an object')
    }

    const entry = item as Record<string, unknown>
    const { from, to, title, impact, reversibility, detection, summary, description } = entry

    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)) {
      return invalid('a snippet has no valid line range')
    }

    if (from !== expected || to < from || to > lineCount) {
      return invalid(`snippets do not cover line ${expected} once, in order`)
    }

    if (typeof title !== 'string' || !TITLE_NAMES.has(title)) {
      return invalid('a snippet has a title outside the list')
    }

    if (!isScore(impact) || !isScore(reversibility) || !isScore(detection)) {
      return invalid('a snippet has a score outside 0 to 3')
    }

    if (typeof summary !== 'string' || clean(summary, SUMMARY_LIMIT) === '') {
      return invalid('a snippet has no summary')
    }

    const hasDescription = typeof description === 'string' && clean(description, DESCRIPTION_LIMIT) !== ''

    if (isHot(computeRisk(impact, reversibility, detection)) && !hasDescription) {
      return invalid('a high-risk snippet has no description')
    }

    snippets.push({
      from,
      to,
      title,
      impact,
      reversibility,
      detection,
      summary: clean(summary, SUMMARY_LIMIT),
      ...(hasDescription ? { description: clean(description, DESCRIPTION_LIMIT) } : {}),
    })
    expected = to + 1
  }

  if (expected !== lineCount + 1) {
    return invalid(`snippets stop before line ${lineCount}`)
  }

  return { isValid: true, snippets }
}
