import type {
  Block,
  Counts,
  DiffFile,
  DiffLine,
  HiddenRunBlock,
  LineLocation,
  Piece,
} from '../types'
import { isFixedHighFile, isFixedHighLine, isFixedZeroRename } from './fixed-rules'
import { computeRisk, isHot } from './risk'

export const PAGE_LIMIT = 60000
const CHUNK_LIMIT = 20000
const CONTEXT = 3
const MAX_RELATED = 5

const DEFINITION =
  /\b(?:function|class|def|fn|func|interface|type)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g

const WORD = /[A-Za-z_$][\w$]*/g

export type ExtraLines = { path: string; before: DiffLine[]; after: DiffLine[] }

export type ViewInput = {
  files: readonly DiffFile[]
  pieces: readonly Piece[]
  read: ReadonlySet<string>
  promoted: ReadonlySet<string>
  expanded: ReadonlySet<string>
  extra: ReadonlyMap<string, ExtraLines>
  noteSize: (lineKey: string) => number
  discussions: (lineKey: string) => number
  isClassifying?: boolean
}

export type View = {
  blocks: Block[]
  counts: Counts
  isComplete: boolean
}

type RunKind = 'hot' | 'cold' | 'open'

type Run = {
  id: string
  kind: RunKind
  hunkIndex: number
  lines: DiffLine[]
  title?: string
  summary: string
  description?: string
  status?: string
  isPromoted: boolean
  symbol?: string
  isWaiting?: boolean
}

const changedCount = (lines: readonly DiffLine[]): number => lines.filter(line => line.kind !== 'ctx').length

const statusOf = (piece: Piece): string => {
  if (piece.state === 'failed') {
    return `Not classified: ${piece.failure ?? 'classification failed'}`
  }

  if (piece.state === 'aborted') {
    return 'Not classified: classification was stopped'
  }

  return 'Not classified yet'
}

const runsOfPiece = (piece: Piece, file: DiffFile, isFileHigh: boolean, promoted: ReadonlySet<string>): Run[] => {
  const symbol = file.hunks[piece.hunkIndex]?.symbol
  const shared = { hunkIndex: piece.hunkIndex, ...(symbol === undefined ? {} : { symbol }) }

  if (piece.state === 'fixed-zero') {
    const id = `${piece.hash}:all`
    const isPromoted = promoted.has(id)

    return [
      {
        ...shared,
        id,
        kind: isPromoted ? 'hot' : 'cold',
        lines: piece.lines,
        title: piece.zeroTitle ?? 'Boilerplate',
        summary: piece.zeroSummary ?? '',
        isPromoted,
      },
    ]
  }

  if (piece.state !== 'scored' || piece.snippets === undefined) {
    return [
      {
        ...shared,
        id: `${piece.hash}:all`,
        kind: 'open',
        lines: piece.lines,
        summary: '',
        status: statusOf(piece),
        isPromoted: false,
        isWaiting: piece.state === 'pending' || piece.state === 'running',
      },
    ]
  }

  return piece.snippets.map(snippet => {
    const lines = piece.lines.slice(snippet.from - 1, snippet.to)
    const id = `${piece.hash}:${snippet.from}-${snippet.to}`
    const isPromoted = promoted.has(id)
    const hasChange = changedCount(lines) > 0
    const isHigh =
      isFileHigh ||
      lines.some(isFixedHighLine) ||
      isHot(computeRisk(snippet.impact, snippet.reversibility, snippet.detection))

    return {
      ...shared,
      id,
      kind: hasChange && (isHigh || isPromoted) ? ('hot' as const) : ('cold' as const),
      lines,
      title: snippet.title,
      summary: snippet.summary,
      ...(snippet.description === undefined ? {} : { description: snippet.description }),
      isPromoted,
    }
  })
}

const moveContext = (runs: Run[]): void => {
  runs.forEach((run, index) => {
    if (run.kind === 'cold') {
      return
    }

    const before = runs[index - 1]
    const after = runs[index + 1]

    if (before?.kind === 'cold' && before.hunkIndex === run.hunkIndex) {
      const tail: DiffLine[] = []

      while (tail.length < CONTEXT && before.lines.at(-1)?.kind === 'ctx') {
        tail.unshift(before.lines.at(-1) as DiffLine)
        before.lines = before.lines.slice(0, -1)
      }

      run.lines = [...tail, ...run.lines]
    }

    if (after?.kind === 'cold' && after.hunkIndex === run.hunkIndex) {
      const head: DiffLine[] = []

      while (head.length < CONTEXT && after.lines[0]?.kind === 'ctx') {
        head.push(after.lines[0])
        after.lines = after.lines.slice(1)
      }

      run.lines = [...run.lines, ...head]
    }
  })
}

const hunklessSummary = (file: DiffFile): string => {
  switch (file.status) {
    case 'binary':
      return 'Binary file changed. The diff has no lines to show.'
    case 'mode':
      return 'File mode changed. The diff has no lines to show.'
    case 'no-diff':
      return 'GitHub returned no diff for this file.'
    case 'renamed':
      return `Renamed from ${file.oldPath ?? 'another path'}.`
    case 'new':
      return 'Empty file added.'
    case 'deleted':
      return 'Empty file deleted.'
    default:
      return 'Changed, with no lines in the diff.'
  }
}

const lineSize = (line: DiffLine, noteSize: (key: string) => number): number =>
  line.text.length + 60 + noteSize(line.key)

const lineBlocks = (
  id: string,
  path: string,
  lines: readonly DiffLine[],
  noteSize: (key: string) => number,
): Block[] => {
  const blocks: Block[] = []
  let current: DiffLine[] = []
  let size = 0

  const flush = () => {
    if (current.length > 0) {
      blocks.push({ kind: 'lines', size: size + 200, id: `${id}#${blocks.length}`, path, lines: current })
      current = []
      size = 0
    }
  }

  for (const line of lines) {
    const next = lineSize(line, noteSize)

    if (size + next > CHUNK_LIMIT) {
      flush()
    }

    current.push(line)
    size += next
  }

  flush()

  return blocks
}

export const buildView = (input: ViewInput): View => {
  const { files, pieces, read, promoted, expanded, extra, noteSize, discussions } = input
  const isHeld = (run: Run): boolean => input.isClassifying === true && run.isWaiting === true
  const counts: Counts = {
    changed: 0,
    hot: 0,
    notClassified: 0,
    waiting: 0,
    hiddenLines: 0,
    hiddenRuns: 0,
    sections: 0,
    sectionsRead: 0,
  }
  const perFile = files.map(file => {
    const isFileHigh = isFixedHighFile(file, files)
    const runs = pieces
      .filter(piece => piece.fileIndex === file.index)
      .flatMap(piece => runsOfPiece(piece, file, isFileHigh, promoted))

    moveContext(runs)

    return { file, runs: runs.filter(run => run.kind !== 'cold' || changedCount(run.lines) > 0) }
  })

  const definitions = new Map<string, { run: Run; path: string }>()

  for (const { file, runs } of perFile) {
    for (const run of runs.filter(one => one.kind === 'cold')) {
      for (const line of run.lines.filter(one => one.kind === 'add')) {
        for (const match of line.text.matchAll(DEFINITION)) {
          const name = match[1] ?? match[2] ?? ''

          if (name.length >= 3 && !definitions.has(name)) {
            definitions.set(name, { run, path: file.path })
          }
        }
      }
    }
  }

  const blocks: Block[] = []
  const hiddenFiles: Block[] = []

  const discussionsIn = (lines: readonly DiffLine[]): number =>
    lines.reduce((total, line) => total + discussions(line.key), 0)

  const hiddenRun = (run: Run, path: string, forceOpen: boolean): Block[] => {
    const isOpen = forceOpen || expanded.has(run.id)
    const block: HiddenRunBlock = {
      kind: 'hidden-run',
      size: 300 + run.summary.length,
      runKey: run.id,
      path,
      title: run.title ?? 'Boilerplate',
      summary: run.summary,
      lineCount: changedCount(run.lines),
      discussions: discussionsIn(run.lines),
      isOpen,
    }

    return [block, ...(isOpen ? lineBlocks(`hidden-${run.id}`, path, run.lines, noteSize) : [])]
  }

  const relatedBlocks = (run: Run): Block[] => {
    const words = new Set(run.lines.flatMap(line => line.text.match(WORD) ?? []))
    const found: Block[] = []
    const seen = new Set<string>()

    for (const name of words) {
      const definition = definitions.get(name)

      if (definition === undefined || seen.has(definition.run.id) || seen.size >= MAX_RELATED) {
        continue
      }

      seen.add(definition.run.id)

      const key = `related:${run.id}:${definition.run.id}`
      const isOpen = expanded.has(key)

      found.push({
        kind: 'related',
        size: 300,
        runKey: key,
        name,
        path: definition.path,
        lineCount: changedCount(definition.run.lines),
        isOpen,
      })

      if (isOpen) {
        found.push(...lineBlocks(key, definition.path, definition.run.lines, noteSize))
      }
    }

    return found
  }

  for (const { file, runs: allRuns } of perFile) {
    const fileChanged = allRuns.reduce((total, run) => total + changedCount(run.lines), 0)
    const runs = allRuns.filter(run => !isHeld(run))

    counts.changed += fileChanged
    counts.waiting += allRuns.filter(isHeld).reduce((total, run) => total + changedCount(run.lines), 0)

    if (allRuns.length > 0 && runs.length === 0) {
      continue
    }

    if (file.hunks.length === 0 && !isFixedZeroRename(file)) {
      const sectionId = `file:${file.path}:${file.status}`
      const isRead = read.has(sectionId)

      counts.sections += 1
      counts.sectionsRead += isRead ? 1 : 0
      blocks.push(
        {
          kind: 'heading',
          size: 300,
          sectionId,
          path: file.path,
          summary: hunklessSummary(file),
          status: 'Not classified: no lines to score',
          isRead,
          isPromoted: false,
          isCrlf: false,
          isHot: false,
        },
        { kind: 'section-end', size: 100, sectionId, path: file.path, isHot: false },
      )
      continue
    }

    if (file.hunks.length === 0) {
      hiddenFiles.push({
        kind: 'hidden-file',
        size: 300,
        fileKey: `file:${file.path}`,
        path: file.path,
        lineCount: 0,
        summary: `Renamed from ${file.oldPath ?? 'another path'}, with no change`,
        discussions: 0,
        isOpen: false,
      })
      continue
    }

    const isVisible = runs.some(run => run.kind !== 'cold')

    for (const run of runs) {
      const changed = changedCount(run.lines)

      if (run.kind === 'cold') {
        counts.hiddenLines += changed
        counts.hiddenRuns += 1
      } else if (run.kind === 'hot') {
        counts.hot += changed
      } else {
        counts.notClassified += changed
      }
    }

    if (!isVisible) {
      const fileKey = `file:${file.path}`
      const isOpen = expanded.has(fileKey)
      const allLines = runs.flatMap(run => run.lines)

      hiddenFiles.push({
        kind: 'hidden-file',
        size: 300,
        fileKey,
        path: file.path,
        lineCount: fileChanged,
        summary: runs[0]?.title ?? 'Boilerplate',
        discussions: discussionsIn(allLines),
        isOpen,
      })

      if (isOpen) {
        hiddenFiles.push(...runs.flatMap(run => hiddenRun(run, file.path, true)))
      }

      continue
    }

    for (const run of runs) {
      if (run.kind === 'cold') {
        blocks.push(...hiddenRun(run, file.path, false))
        continue
      }

      const isRead = read.has(run.id)

      counts.sections += 1
      counts.sectionsRead += isRead ? 1 : 0
      blocks.push({
        kind: 'heading',
        size: 400 + run.summary.length + (run.description?.length ?? 0),
        sectionId: run.id,
        path: file.path,
        ...(run.symbol === undefined ? {} : { symbol: run.symbol }),
        summary: run.summary,
        ...(run.title === undefined ? {} : { title: run.title }),
        ...(run.description === undefined ? {} : { description: run.description }),
        ...(run.status === undefined ? {} : { status: run.status }),
        isRead,
        isPromoted: run.isPromoted,
        isCrlf: file.isCrlf,
        isHot: run.kind === 'hot',
      })

      if (isRead) {
        continue
      }

      const more = extra.get(run.id)
      const numbers = run.lines.flatMap(line => (line.newNo === undefined ? [] : [line.newNo]))
      const first = numbers[0]
      const last = numbers.at(-1)

      blocks.push(
        ...lineBlocks(`before-${run.id}`, file.path, more?.before ?? [], noteSize),
        ...lineBlocks(`section-${run.id}`, file.path, run.lines, noteSize),
        ...lineBlocks(`after-${run.id}`, file.path, more?.after ?? [], noteSize),
        ...relatedBlocks(run),
        {
          kind: 'section-end',
          size: 100,
          sectionId: run.id,
          path: file.path,
          isHot: run.kind === 'hot',
          ...(first === undefined || last === undefined ? {} : { anchor: { first, last } }),
        },
      )
    }
  }

  if (hiddenFiles.length > 0) {
    blocks.push({ kind: 'hidden-title', size: 100 }, ...hiddenFiles)
  }

  const isComplete = pieces.every(piece => piece.state === 'scored' || piece.state === 'fixed-zero')

  return { blocks, counts, isComplete }
}

export const paginate = (blocks: readonly Block[], limit = PAGE_LIMIT): Block[][] => {
  const pages: Block[][] = []
  let page: Block[] = []
  let size = 0

  blocks.forEach((block, index) => {
    if (size + block.size > limit && page.length > 0) {
      const last = page.at(-1)
      const carried = last?.kind === 'heading' && page.length > 1 ? [page.pop() as Block] : []

      pages.push(page)
      page = carried
      size = carried.reduce((total, one) => total + one.size, 0)
    }

    page.push(block)
    size += block.size

    if (index === blocks.length - 1) {
      pages.push(page)
    }
  })

  return pages.length === 0 ? [[]] : pages
}

export const locateLines = (
  files: readonly DiffFile[],
  extra: ReadonlyMap<string, ExtraLines>,
): Map<string, LineLocation> => {
  const index = new Map<string, LineLocation>()

  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        index.set(line.key, { path: file.path, line, side: line.kind === 'del' ? 'LEFT' : 'RIGHT', isExtra: false })
      }
    }
  }

  for (const lines of extra.values()) {
    for (const line of [...lines.before, ...lines.after]) {
      index.set(line.key, { path: lines.path, line, side: 'RIGHT', isExtra: true })
    }
  }

  return index
}
