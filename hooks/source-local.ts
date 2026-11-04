import type { EngineInterface } from 'claude-code'

import type { DiffCounts } from '../types'
import { addCounts, parseNumstat } from './parse-diff'
import { collect } from './process'

export type LocalSource = {
  top: string
  branch: string
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

async function findMain($: EngineInterface, top: string): Promise<string | null> {
  const remote = await collect($, [...GIT, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: top })

  if (remote.code === 0 && remote.stdout.trim() !== '') {
    return remote.stdout.trim()
  }

  for (const name of ['main', 'master']) {
    const found = await collect($, [...GIT, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: top })

    if (found.code === 0) {
      return name
    }
  }

  return null
}

export async function readLocal($: EngineInterface): Promise<LocalResult> {
  const topResult = await collect($, [...GIT, 'rev-parse', '--show-toplevel'])

  if (topResult.code !== 0) {
    return fail('This folder is not a git repository.')
  }

  const top = topResult.stdout.trim()
  const head = await collect($, [...GIT, 'rev-parse', 'HEAD'], { cwd: top })

  if (head.code !== 0) {
    return fail('This repository has no commits yet.')
  }

  const main = await findMain($, top)

  if (main === null) {
    return fail('No main branch found: tried origin/HEAD, main and master.')
  }

  const baseResult = await collect($, [...GIT, 'merge-base', 'HEAD', main], { cwd: top })

  if (baseResult.code !== 0) {
    return fail(`This branch has no common commit with ${main}.`)
  }

  const base = baseResult.stdout.trim()
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
