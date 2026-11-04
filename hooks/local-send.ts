import type { Draft } from '../types'

export const buildLocalMessage = (drafts: readonly { draft: Draft; lineText: string }[]): string =>
  [
    'Correct the code according to these review comments from /easy-review.',
    '',
    ...drafts.flatMap(({ draft, lineText }) => [
      `${draft.path}:${draft.line}${draft.side === 'LEFT' ? ' (deleted line)' : ''}`,
      `> ${lineText}`,
      draft.text,
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
