import type { DiffFile, DiffLine, Hunk } from '../types'

const HIGH_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'authn',
  'authz',
  'authentication',
  'authorization',
  'permissions',
  'security',
  'secrets',
])

const HIGH_NAMES: ReadonlySet<string> = new Set(['CODEOWNERS', 'CLAUDE.md', 'AGENTS.md'])

const LOCKFILES: Readonly<Record<string, readonly string[]>> = {
  'pnpm-lock.yaml': ['package.json', 'pnpm-workspace.yaml'],
  'package-lock.json': ['package.json'],
  'npm-shrinkwrap.json': ['package.json'],
  'yarn.lock': ['package.json'],
  'bun.lock': ['package.json'],
  'Cargo.lock': ['Cargo.toml'],
  'go.sum': ['go.mod'],
  'poetry.lock': ['pyproject.toml'],
  'uv.lock': ['pyproject.toml'],
  'composer.lock': ['composer.json'],
  'Gemfile.lock': ['Gemfile'],
}

const INDENTED_EXTENSIONS: ReadonlySet<string> = new Set([
  'py',
  'pyi',
  'yaml',
  'yml',
  'haml',
  'pug',
  'sass',
  'coffee',
  'nim',
  'mk',
])

const DELETED_CHECK = /authori[sz]e|permission/i

const segmentsOf = (path: string): string[] => path.split('/')

const nameOf = (path: string): string => segmentsOf(path).at(-1) ?? path

const stemOf = (segment: string): string => segment.split('.')[0] ?? segment

export const isFixedHighPath = (path: string): boolean => {
  const segments = segmentsOf(path)

  return (
    HIGH_NAMES.has(nameOf(path)) ||
    segments.includes('.claude') ||
    path.startsWith('.github/workflows/') ||
    path.includes('/.github/workflows/') ||
    segments.some(segment => HIGH_SEGMENTS.has(stemOf(segment).toLowerCase()))
  )
}

export const isFixedHighLine = (line: DiffLine): boolean => line.kind === 'del' && DELETED_CHECK.test(line.text)

const manifestChanged = (file: DiffFile, files: readonly DiffFile[]): boolean => {
  const manifests = LOCKFILES[nameOf(file.path)] ?? []

  return files.some(other => other.index !== file.index && manifests.includes(nameOf(other.path)))
}

export const isLockfile = (file: DiffFile): boolean => nameOf(file.path) in LOCKFILES

export const isFixedHighFile = (file: DiffFile, files: readonly DiffFile[]): boolean =>
  isFixedHighPath(file.path) || (isLockfile(file) && !manifestChanged(file, files))

export const isFixedZeroLockfile = (file: DiffFile, files: readonly DiffFile[]): boolean =>
  isLockfile(file) && manifestChanged(file, files)

export const isFixedZeroRename = (file: DiffFile): boolean =>
  file.status === 'renamed' && file.similarity === 100 && file.hunks.length === 0

const hasMeaningfulIndent = (path: string): boolean => {
  const name = nameOf(path)
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '') : ''

  return name === 'Makefile' || INDENTED_EXTENSIONS.has(extension.toLowerCase())
}

const stripSpace = (text: string): string => text.replace(/\s+/g, '')

export const isWhitespaceOnly = (file: DiffFile, hunk: Hunk): boolean => {
  if (hasMeaningfulIndent(file.path)) {
    return false
  }

  const added = hunk.lines.filter(line => line.kind === 'add').map(line => stripSpace(line.text))
  const deleted = hunk.lines.filter(line => line.kind === 'del').map(line => stripSpace(line.text))

  return (
    added.length + deleted.length > 0 &&
    added.join('') === deleted.join('')
  )
}
