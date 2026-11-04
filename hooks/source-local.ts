import type { EngineInterface } from 'claude-code'

import type { DiffCounts } from '../types'
import { addCounts, parseNumstat } from './parse-diff'
import { collect } from './process'

export type LocalSource = {
  top: string
  branch: string
  baseName: string | null
  commit: string
  diffText: string
  expected: DiffCounts
}

export type LocalResult = { isRead: true; source: LocalSource } | { isRead: false; message: string }

const GIT = ['git', '-c', 'core.quotepath=off', '-c', 'color.ui=false'] as const

const DIFF_OPTIONS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '-M',
  '-U3',
  '--src-prefix=a/',
  '--dst-prefix=b/',
] as const

const fail = (message: string): LocalResult => ({ isRead: false, message })

async function resolveBase($: EngineInterface, top: string, name: string): Promise<{ name: string; commit: string } | string> {
  const exists = await collect($, [...GIT, 'rev-parse', '--verify', '--quiet', `${name}^{commit}`], { cwd: top })

  if (exists.code !== 0) {
    return `Branch ${name} was not found.`
  }

  const merge = await collect($, [...GIT, 'merge-base', 'HEAD', name], { cwd: top })

  return merge.code === 0 ? { name, commit: merge.stdout.trim() } : `This branch has no common commit with ${name}.`
}

export async function readLocal($: EngineInterface, requestedBase?: string): Promise<LocalResult> {
  const topResult = await collect($, [...GIT, 'rev-parse', '--show-toplevel'])

  if (topResult.code !== 0) {
    return fail('This folder is not a git repository.')
  }

  const top = topResult.stdout.trim()
  const head = await collect($, [...GIT, 'rev-parse', 'HEAD'], { cwd: top })

  if (head.code !== 0) {
    return fail('This repository has no commits yet.')
  }

  const found = requestedBase === undefined ? null : await resolveBase($, top, requestedBase)

  if (typeof found === 'string') {
    return fail(found)
  }

  const base = found?.commit ?? 'HEAD'
  const branchResult = await collect($, [...GIT, 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: top })
  const tracked = await collect($, [...GIT, 'diff', ...DIFF_OPTIONS, base], { cwd: top })

  if (tracked.code !== 0) {
    return fail(`git diff failed: ${tracked.stderr.trim()}`)
  }

  const numstat = await collect($, [...GIT, 'diff', '--numstat', '-z', '-M', '--no-relative', base], { cwd: top })

  if (numstat.code !== 0) {
    return fail(`git diff --numstat failed: ${numstat.stderr.trim()}`)
  }

  const others = await collect($, [...GIT, 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: top })

  if (others.code !== 0) {
    return fail(`git ls-files failed: ${others.stderr.trim()}`)
  }

  let diffText = tracked.stdout
  let expected = parseNumstat(numstat.stdout)

  for (const file of others.stdout.split('\0').filter(name => name !== '')) {
    const added = await collect($, [...GIT, 'diff', '--no-index', ...DIFF_OPTIONS, '--', '/dev/null', file], { cwd: top })

    if (added.code !== 0 && added.code !== 1) {
      return fail(`git diff failed on ${file}: ${added.stderr.trim()}`)
    }

    const stat = await collect($, [...GIT, 'diff', '--no-index', '--numstat', '-z', '--', '/dev/null', file], { cwd: top })

    diffText += `${diffText === '' || diffText.endsWith('\n') ? '' : '\n'}${added.stdout}`
    expected = addCounts(expected, parseNumstat(stat.stdout))
  }

  return {
    isRead: true,
    source: {
      top,
      branch: branchResult.stdout.trim(),
      baseName: found?.name ?? null,
      commit: head.stdout.trim(),
      diffText,
      expected,
    },
  }
}

export async function readLocalFile($: EngineInterface, top: string, path: string): Promise<string[] | null> {
  const output = await collect($, ['cat', '--', path], { cwd: top })

  return output.code === 0 ? output.stdout.split('\n') : null
}
