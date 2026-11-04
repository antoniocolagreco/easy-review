export type LineKind = 'add' | 'del' | 'ctx'

export type Side = 'LEFT' | 'RIGHT'

export type DiffLine = {
  key: string
  kind: LineKind
  oldNo?: number
  newNo?: number
  text: string
}

export type Hunk = {
  index: number
  symbol?: string
  lines: DiffLine[]
}

export type FileStatus = 'modified' | 'new' | 'deleted' | 'renamed' | 'binary' | 'mode' | 'no-diff'

export type DiffFile = {
  index: number
  path: string
  oldPath?: string
  status: FileStatus
  similarity?: number
  isCrlf: boolean
  hunks: Hunk[]
}

export type DiffCounts = {
  files: number
  additions: number
  deletions: number
}

export type ParsedDiff = {
  files: DiffFile[]
  counts: DiffCounts
}

export type Snippet = {
  from: number
  to: number
  title: string
  impact: number
  reversibility: number
  detection: number
  summary: string
  description?: string
}

export type PieceState = 'pending' | 'running' | 'scored' | 'failed' | 'aborted' | 'fixed-zero'

export type Piece = {
  fileIndex: number
  hunkIndex: number
  offset: number
  lines: DiffLine[]
  context: DiffLine[]
  hash: string
  state: PieceState
  snippets?: Snippet[]
  failure?: string
  zeroTitle?: string
  zeroSummary?: string
}

export type Draft = {
  path: string
  side: Side
  line: number
  lineHash: string
  text: string
  isSent: boolean
  hasMoved: boolean
}

export type ThreadComment = {
  id: string
  author: string
  body: string
  canUpdate: boolean
  canDelete: boolean
}

export type Thread = {
  id: string
  path: string
  side: Side
  line: number | null
  isResolved: boolean
  isOutdated: boolean
  canReply: boolean
  canResolve: boolean
  canUnresolve: boolean
  comments: ThreadComment[]
}

export type PrRef = {
  owner: string
  repo: string
  number: number
}

export type PrInfo = PrRef & {
  title: string
  author: string
  headRef: string
  baseRef: string
  state: string
}

export type StoredReview = {
  drafts: Draft[]
  read: string[]
  promoted: string[]
  body: string
}

export type LineLocation = {
  path: string
  line: DiffLine
  side: Side
  isExtra: boolean
}

export type Counts = {
  changed: number
  hot: number
  notClassified: number
  waiting: number
  hiddenLines: number
  hiddenRuns: number
  sections: number
  sectionsRead: number
}

export type HeadingBlock = {
  kind: 'heading'
  size: number
  sectionId: string
  path: string
  symbol?: string
  summary: string
  title?: string
  description?: string
  status?: string
  isRead: boolean
  isPromoted: boolean
  isCrlf: boolean
  isHot: boolean
}

export type LinesBlock = {
  kind: 'lines'
  size: number
  id: string
  path: string
  lines: DiffLine[]
}

export type SectionEndBlock = {
  kind: 'section-end'
  size: number
  sectionId: string
  path: string
  isHot: boolean
  anchor?: { first: number; last: number }
}

export type HiddenRunBlock = {
  kind: 'hidden-run'
  size: number
  runKey: string
  path: string
  title: string
  summary: string
  lineCount: number
  discussions: number
  isOpen: boolean
}

export type RelatedBlock = {
  kind: 'related'
  size: number
  runKey: string
  name: string
  path: string
  lineCount: number
  isOpen: boolean
}

export type HiddenTitleBlock = {
  kind: 'hidden-title'
  size: number
}

export type HiddenFileBlock = {
  kind: 'hidden-file'
  size: number
  fileKey: string
  path: string
  lineCount: number
  summary: string
  discussions: number
  isOpen: boolean
}

export type Block =
  | HeadingBlock
  | LinesBlock
  | SectionEndBlock
  | HiddenRunBlock
  | RelatedBlock
  | HiddenTitleBlock
  | HiddenFileBlock

export type Composer =
  | { kind: 'draft'; index: number }
  | { kind: 'reply'; thread: number }
  | { kind: 'edit'; thread: number; comment: number }
  | { kind: 'body' }

export type ReviewAction = 'Comment' | 'Approve' | 'Request changes' | 'Reject' | 'Send to Claude'

export type DiffClientProps = {
  lines: DiffLine[]
  path: string
  selectedKey: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'easy-review': {
      rowId: string | null
      revision: number
      page: number
      selected: string | null
      composer: Composer | null
      expanded: string[]
      pending: ReviewAction | null
      outcome: string | null
    }
  }
}
