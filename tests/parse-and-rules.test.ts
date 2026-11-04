import { expect, test } from 'claude-code/testing'

import type { DiffFile, Piece } from '../types'
import { parseReply } from '../hooks/classifier-reply'
import {
  isFixedHighFile,
  isFixedHighLine,
  isFixedHighPath,
  isFixedZeroLockfile,
  isFixedZeroRename,
  isWhitespaceOnly,
} from '../hooks/fixed-rules'
import { checkCounts, parseDiff, parseNumstat } from '../hooks/parse-diff'
import { computeRisk, isHot } from '../hooks/risk'
import { sanitizeLine } from '../hooks/sanitize'
import { buildView, paginate } from '../hooks/sections'
import {
  AUTH_DIFF,
  AUTHOR_DIFF,
  BIDI_DIFF,
  BINARY_DIFF,
  CRLF_DIFF,
  ESC_DIFF,
  LOCK_ALONE_DIFF,
  LOCK_WITH_MANIFEST_DIFF,
  MODE_DIFF,
  NEW_FILE_DIFF,
  PYTHON_WHITESPACE_DIFF,
  QUOTED_DIFF,
  RENAME_DIFF,
  SERVICE_DIFF,
  SERVICE_NUMSTAT,
  SERVICE_REPLY,
  WHITESPACE_DIFF,
  WORKED_EXAMPLES,
} from './fixtures'

const fileOf = (diff: string, index = 0): DiffFile => {
  const file = parseDiff(diff).files[index]

  if (file === undefined) {
    throw new Error('the fixture has no such file')
  }

  return file
}

test('a normal change gives numbered lines and counts', () => {
  const parsed = parseDiff(SERVICE_DIFF)
  const hunk = parsed.files[0]?.hunks[0]

  expect(parsed.counts).toEqual({ files: 1, additions: 6, deletions: 1 })
  expect(parsed.files[0]?.path).toBe('src/service.ts')
  expect(hunk?.symbol).toBe('export function suspend(agreement) {')
  expect(hunk?.lines[0]).toEqual({ key: '0.0.0', kind: 'ctx', oldNo: 10, newNo: 10, text: 'const log = logger()' })
  expect(hunk?.lines[1]).toEqual({ key: '0.0.1', kind: 'del', oldNo: 11, text: "import { old } from './old'" })
  expect(hunk?.lines[2]).toEqual({ key: '0.0.2', kind: 'add', newNo: 11, text: "import { fresh } from './fresh'" })
})

test('special changes keep their status', () => {
  expect(fileOf(NEW_FILE_DIFF).status).toBe('new')
  expect(fileOf(RENAME_DIFF).status).toBe('renamed')
  expect(fileOf(RENAME_DIFF).oldPath).toBe('src/old.ts')
  expect(fileOf(RENAME_DIFF).path).toBe('src/new.ts')
  expect(fileOf(BINARY_DIFF).status).toBe('binary')
  expect(fileOf(MODE_DIFF).status).toBe('mode')
  expect(fileOf(QUOTED_DIFF).path).toBe('caffè.ts')
})

test('hostile characters become visible marks', () => {
  expect(fileOf(CRLF_DIFF).isCrlf).toBe(true)
  expect(fileOf(CRLF_DIFF).hunks[0]?.lines[1]?.text).toBe('new')
  expect(fileOf(ESC_DIFF).hunks[0]?.lines[1]?.text).toBe('a␛[31mb')
  expect(fileOf(BIDI_DIFF).hunks[0]?.lines[1]?.text).toBe('a[U+202E]b')
  expect(sanitizeLine('a\tb').text).toBe('a\tb')
})

test('numstat counts and a mismatch are reported', () => {
  expect(parseNumstat(SERVICE_NUMSTAT)).toEqual({ files: 1, additions: 6, deletions: 1 })
  expect(parseNumstat('-\t-\tlogo.png\0')).toEqual({ files: 1, additions: 0, deletions: 0 })
  expect(parseNumstat('1\t2\t\0old.ts\0new.ts\0')).toEqual({ files: 1, additions: 1, deletions: 2 })
  expect(checkCounts({ files: 1, additions: 6, deletions: 1 }, { files: 1, additions: 6, deletions: 1 })).toEqual([])
  expect(checkCounts({ files: 1, additions: 5, deletions: 1 }, { files: 2, additions: 6, deletions: 1 })).toEqual([
    'files: read 1, expected 2',
    'added lines: read 5, expected 6',
  ])
})

test('every worked example gives its risk and result', () => {
  for (const example of WORKED_EXAMPLES) {
    const risk = computeRisk(...example.scores)

    expect(risk, example.name).toBe(example.risk)
    expect(isHot(risk), example.name).toBe(example.isHot)
  }
})

test('the threshold sits between 5 and 6', () => {
  expect(isHot(5)).toBe(false)
  expect(isHot(6)).toBe(true)
  expect(computeRisk(0, 3, 3)).toBe(0)
  expect(computeRisk(3, 1, 0)).toBe(3)
  expect(computeRisk(3, 1, 1)).toBe(6)
})

test('fixed high risk matches whole path segments only', () => {
  expect(isFixedHighPath('src/auth/session.ts')).toBe(true)
  expect(isFixedHighPath('src/auth.ts')).toBe(true)
  expect(isFixedHighPath('src/permissions/x.ts')).toBe(true)
  expect(isFixedHighPath('src/secrets.yaml')).toBe(true)
  expect(isFixedHighPath('.github/workflows/ci.yml')).toBe(true)
  expect(isFixedHighPath('docs/CODEOWNERS')).toBe(true)
  expect(isFixedHighPath('.claude/settings.json')).toBe(true)
  expect(isFixedHighPath('pkg/CLAUDE.md')).toBe(true)
  expect(isFixedHighPath('AGENTS.md')).toBe(true)
  expect(isFixedHighPath('src/author/name.ts')).toBe(false)
  expect(isFixedHighPath('src/tokenizer.ts')).toBe(false)
  expect(isFixedHighFile(fileOf(AUTH_DIFF), parseDiff(AUTH_DIFF).files)).toBe(true)
  expect(isFixedHighFile(fileOf(AUTHOR_DIFF), parseDiff(AUTHOR_DIFF).files)).toBe(false)
})

test('a deleted line naming a check is fixed high risk', () => {
  expect(isFixedHighLine({ key: 'a', kind: 'del', oldNo: 1, text: 'authorize(user)' })).toBe(true)
  expect(isFixedHighLine({ key: 'b', kind: 'del', oldNo: 1, text: 'checkPermission(user)' })).toBe(true)
  expect(isFixedHighLine({ key: 'c', kind: 'add', newNo: 1, text: 'authorize(user)' })).toBe(false)
  expect(isFixedHighLine({ key: 'd', kind: 'del', oldNo: 1, text: 'const a = 1' })).toBe(false)
})

test('a lockfile is zero risk only with a manifest in the same diff', () => {
  const withManifest = parseDiff(LOCK_WITH_MANIFEST_DIFF).files
  const alone = parseDiff(LOCK_ALONE_DIFF).files
  const lockWith = withManifest[1] as DiffFile
  const lockAlone = alone[0] as DiffFile

  expect(isFixedZeroLockfile(lockWith, withManifest)).toBe(true)
  expect(isFixedHighFile(lockWith, withManifest)).toBe(false)
  expect(isFixedZeroLockfile(lockAlone, alone)).toBe(false)
  expect(isFixedHighFile(lockAlone, alone)).toBe(true)
})

test('whitespace is zero risk, except where indentation has meaning', () => {
  const format = fileOf(WHITESPACE_DIFF)
  const python = fileOf(PYTHON_WHITESPACE_DIFF)

  expect(isWhitespaceOnly(format, format.hunks[0] as DiffFile['hunks'][number])).toBe(true)
  expect(isWhitespaceOnly(python, python.hunks[0] as DiffFile['hunks'][number])).toBe(false)
  expect(isFixedZeroRename(fileOf(RENAME_DIFF))).toBe(true)
})

test('a valid reply is accepted', () => {
  const reply = parseReply(SERVICE_REPLY, 10)

  expect(reply.isValid).toBe(true)
  expect(parseReply(`\`\`\`json\n${SERVICE_REPLY}\n\`\`\``, 10).isValid).toBe(true)
})

const one = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    snippets: [{ from: 1, to: 2, title: 'Other', impact: 1, reversibility: 0, detection: 0, summary: 'A value', ...fields }],
  })

test('an invalid reply is refused whole', () => {
  expect(parseReply('{"snippets":[{"from":1', 2).isValid).toBe(false)
  expect(parseReply('no json', 2).isValid).toBe(false)
  expect(parseReply('{}', 2).isValid).toBe(false)
  expect(parseReply(one({ title: 'Invented' }), 2).isValid).toBe(false)
  expect(parseReply(one({ impact: 4 }), 2).isValid).toBe(false)
  expect(parseReply(one({ impact: 1.5 }), 2).isValid).toBe(false)
  expect(parseReply(one({ summary: '' }), 2).isValid).toBe(false)
  expect(parseReply(one({ to: 1 }), 2).isValid).toBe(false)
  expect(parseReply(one({ from: 2 }), 2).isValid).toBe(false)
  expect(parseReply(one({ to: 3 }), 2).isValid).toBe(false)
  expect(parseReply(one({ impact: 3, reversibility: 3, detection: 3 }), 2).isValid).toBe(false)
})

test('a reply with a gap or an overlap is refused', () => {
  const base = { title: 'Other', impact: 0, reversibility: 0, detection: 0, summary: 'A value' }

  expect(parseReply(JSON.stringify({ snippets: [{ ...base, from: 1, to: 1 }, { ...base, from: 3, to: 3 }] }), 3).isValid).toBe(false)
  expect(parseReply(JSON.stringify({ snippets: [{ ...base, from: 1, to: 2 }, { ...base, from: 2, to: 3 }] }), 3).isValid).toBe(false)
})

const viewOf = (diff: string, state: Piece['state'], reply?: string) => {
  const parsed = parseDiff(diff)
  const pieces: Piece[] = parsed.files.flatMap(file =>
    file.hunks.map(hunk => {
      const answer = reply === undefined ? undefined : parseReply(reply, hunk.lines.length)

      return {
        fileIndex: file.index,
        hunkIndex: hunk.index,
        offset: 0,
        lines: hunk.lines,
        context: [],
        hash: `h${file.index}${hunk.index}`,
        state,
        ...(answer?.isValid === true ? { snippets: answer.snippets } : {}),
      }
    }),
  )

  return buildView({
    files: parsed.files,
    pieces,
    read: new Set(),
    promoted: new Set(),
    expanded: new Set(),
    extra: new Map(),
    noteSize: () => 0,
    discussions: () => 0,
  })
}

test('only high-risk snippets become sections', () => {
  const view = viewOf(SERVICE_DIFF, 'scored', SERVICE_REPLY)

  expect(view.counts).toEqual({
    changed: 7,
    hot: 4,
    notClassified: 0,
    hiddenLines: 3,
    hiddenRuns: 2,
    sections: 1,
    sectionsRead: 0,
  })
  expect(view.isComplete).toBe(true)
  expect(view.blocks.filter(block => block.kind === 'heading').length).toBe(1)
})

test('a failed piece stays visible as not classified', () => {
  const view = viewOf(SERVICE_DIFF, 'failed')

  expect(view.counts.notClassified).toBe(7)
  expect(view.counts.hot).toBe(0)
  expect(view.isComplete).toBe(false)
})

test('a fixed high path is HOT even with a low score', () => {
  const view = viewOf(AUTH_DIFF, 'scored', JSON.stringify({
    snippets: [{ from: 1, to: 2, title: 'Other', impact: 0, reversibility: 0, detection: 0, summary: 'A value' }],
  }))

  expect(view.counts.hot).toBe(2)
})

test('a binary file and a mode change stay visible', () => {
  expect(viewOf(BINARY_DIFF, 'pending').blocks[0]?.kind).toBe('heading')
  expect(viewOf(MODE_DIFF, 'pending').blocks[0]?.kind).toBe('heading')
  expect(viewOf(RENAME_DIFF, 'pending').blocks[0]?.kind).toBe('hidden-title')
})

test('pages keep to the limit and keep every block', () => {
  const lines = Array.from({ length: 5 }, (_, index) => ({
    kind: 'lines' as const,
    size: 30000,
    id: `b${index}`,
    path: 'a.ts',
    lines: [],
  }))
  const pages = paginate(lines, 60000)

  expect(pages.length).toBe(3)
  expect(pages.flat().length).toBe(5)
  expect(paginate([]).length).toBe(1)
})
