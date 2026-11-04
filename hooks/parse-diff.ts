import type { DiffCounts, DiffFile, DiffLine, FileStatus, Hunk, ParsedDiff } from '../types'
import { sanitizeLine, sanitizeText } from './sanitize'

export const NO_PATCH_MARK = '# easy-review: no patch'

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

const ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

const unquotePath = (raw: string): string => {
  if (!raw.startsWith('"') || !raw.endsWith('"')) {
    return raw
  }

  const bytes: number[] = []
  const body = raw.slice(1, -1)
  const encoder = new TextEncoder()

  for (let at = 0; at < body.length; at += 1) {
    const char = body.charAt(at)

    if (char !== '\\') {
      bytes.push(...encoder.encode(char))
      continue
    }

    const next = body.charAt(at + 1)
    const octal = body.slice(at + 1, at + 4)

    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8))
      at += 3
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0))
      at += 1
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
}

const stripPrefix = (path: string): string =>
  path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path

const pathsFromGitLine = (line: string): { oldPath: string; newPath: string } => {
  const rest = line.slice('diff --git '.length)

  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1)
    const first = end === -1 ? rest : rest.slice(0, end + 1)
    const second = end === -1 ? rest : rest.slice(end + 2)

    return { oldPath: stripPrefix(unquotePath(first)), newPath: stripPrefix(unquotePath(second)) }
  }

  const middle = Math.floor(rest.length / 2)

  if (rest.charAt(middle) === ' ' && rest.slice(2, middle) === rest.slice(middle + 3)) {
    const path = rest.slice(2, middle)

    return { oldPath: path, newPath: path }
  }

  const split = rest.lastIndexOf(' b/')
  const first = split === -1 ? rest : rest.slice(0, split)
  const second = split === -1 ? rest : rest.slice(split + 1)

  return { oldPath: stripPrefix(unquotePath(first)), newPath: stripPrefix(unquotePath(second)) }
}

const headerPath = (raw: string): string | null => {
  const value = raw.split('\t')[0] ?? raw

  return value === '/dev/null' ? null : stripPrefix(unquotePath(value))
}

export const parseDiff = (text: string): ParsedDiff => {
  const rows = text.split('\n')
  const files: DiffFile[] = []
  const counts: DiffCounts = { files: 0, additions: 0, deletions: 0 }
  let at = 0

  while (at < rows.length) {
    const row = rows[at] ?? ''

    if (!row.startsWith('diff --git ')) {
      at += 1
      continue
    }

    const fileIndex = files.length
    const names = pathsFromGitLine(row)
    let path = names.newPath
    let oldPath: string | undefined
    let status: FileStatus = 'modified'
    let similarity: number | undefined
    let isCrlf = false
    let hasModeChange = false
    let isDeleted = false
    let isNew = false
    let isBinary = false
    let hasNoPatch = false
    const hunks: Hunk[] = []

    at += 1

    while (at < rows.length) {
      const header = rows[at] ?? ''

      if (header.startsWith('diff --git ') || header.startsWith('@@ ')) {
        break
      }

      if (header === NO_PATCH_MARK) {
        hasNoPatch = true
      } else if (header.startsWith('new file mode')) {
        isNew = true
      } else if (header.startsWith('deleted file mode')) {
        isDeleted = true
      } else if (header.startsWith('old mode') || header.startsWith('new mode')) {
        hasModeChange = true
      } else if (header.startsWith('similarity index ')) {
        similarity = Number.parseInt(header.slice('similarity index '.length), 10)
      } else if (header.startsWith('rename from ')) {
        oldPath = unquotePath(header.slice('rename from '.length))
      } else if (header.startsWith('rename to ')) {
        path = unquotePath(header.slice('rename to '.length))
      } else if (header.startsWith('--- ')) {
        const value = headerPath(header.slice(4))

        if (value === null) {
          isNew = true
        }
      } else if (header.startsWith('+++ ')) {
        const value = headerPath(header.slice(4))

        if (value === null) {
          isDeleted = true
        } else {
          path = value
        }
      } else if (header.startsWith('Binary files ') || header === 'GIT binary patch') {
        isBinary = true
      }

      at += 1
    }

    while (at < rows.length && (rows[at] ?? '').startsWith('@@ ')) {
      const match = HUNK_HEADER.exec(rows[at] ?? '')

      if (match === null) {
        break
      }

      let oldNo = Number(match[1])
      let newNo = Number(match[3])
      let oldLeft = match[2] === undefined ? 1 : Number(match[2])
      let newLeft = match[4] === undefined ? 1 : Number(match[4])
      const symbol = sanitizeText(match[5] ?? '').trim()
      const hunkIndex = hunks.length
      const lines: DiffLine[] = []

      at += 1

      while (at < rows.length && (oldLeft > 0 || newLeft > 0)) {
        const raw = rows[at] ?? ''
        const mark = raw.charAt(0)

        if (mark === '\\') {
          at += 1
          continue
        }

        if (mark !== '+' && mark !== '-' && mark !== ' ' && raw !== '') {
          break
        }

        const clean = sanitizeLine(raw.slice(1))
        const key = `${fileIndex}.${hunkIndex}.${lines.length}`

        isCrlf = isCrlf || clean.hadCarriageReturn

        if (mark === '+') {
          lines.push({ key, kind: 'add', newNo, text: clean.text })
          newNo += 1
          newLeft -= 1
          counts.additions += 1
        } else if (mark === '-') {
          lines.push({ key, kind: 'del', oldNo, text: clean.text })
          oldNo += 1
          oldLeft -= 1
          counts.deletions += 1
        } else {
          lines.push({ key, kind: 'ctx', oldNo, newNo, text: clean.text })
          oldNo += 1
          newNo += 1
          oldLeft -= 1
          newLeft -= 1
        }

        at += 1
      }

      while ((rows[at] ?? '').startsWith('\\')) {
        at += 1
      }

      hunks.push({ index: hunkIndex, ...(symbol === '' ? {} : { symbol }), lines })
    }

    if (hasNoPatch) {
      status = 'no-diff'
    } else if (isBinary) {
      status = 'binary'
    } else if (oldPath !== undefined) {
      status = 'renamed'
    } else if (isNew) {
      status = 'new'
    } else if (isDeleted) {
      status = 'deleted'
    } else if (hasModeChange && hunks.length === 0) {
      status = 'mode'
    }

    files.push({
      index: fileIndex,
      path: sanitizeText(path),
      ...(oldPath === undefined ? {} : { oldPath: sanitizeText(oldPath) }),
      status,
      ...(similarity === undefined ? {} : { similarity }),
      isCrlf,
      hunks,
    })
    counts.files += 1
  }

  return { files, counts }
}

export const parseNumstat = (text: string): DiffCounts => {
  const fields = text.split('\0')
  const counts: DiffCounts = { files: 0, additions: 0, deletions: 0 }
  let at = 0

  while (at < fields.length) {
    const field = fields[at] ?? ''
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(field)

    if (match === null) {
      at += 1
      continue
    }

    counts.files += 1
    counts.additions += match[1] === '-' ? 0 : Number(match[1])
    counts.deletions += match[2] === '-' ? 0 : Number(match[2])
    at += match[3] === '' ? 3 : 1
  }

  return counts
}

export const addCounts = (left: DiffCounts, right: DiffCounts): DiffCounts => ({
  files: left.files + right.files,
  additions: left.additions + right.additions,
  deletions: left.deletions + right.deletions,
})

export const checkCounts = (parsed: DiffCounts, expected: DiffCounts): string[] => {
  const problems: string[] = []

  if (parsed.files !== expected.files) {
    problems.push(`files: read ${parsed.files}, expected ${expected.files}`)
  }

  if (parsed.additions !== expected.additions) {
    problems.push(`added lines: read ${parsed.additions}, expected ${expected.additions}`)
  }

  if (parsed.deletions !== expected.deletions) {
    problems.push(`deleted lines: read ${parsed.deletions}, expected ${expected.deletions}`)
  }

  return problems
}
