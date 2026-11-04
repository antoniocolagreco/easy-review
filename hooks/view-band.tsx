import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement } from 'claude-code'

import type { Elements } from './view-row'
import { currentSession, drawnView, editDraft, editPostedComment, replyInThread, saveBody, saveDraft } from './review'

const selected = atom({ plugin: 'easy-review', key: 'selected' } as const, null)
const composer = atom({ plugin: 'easy-review', key: 'composer' } as const, null)
const expanded = atom({ plugin: 'easy-review', key: 'expanded' } as const, [])
const delivery = atom({ plugin: 'easy-review', key: 'delivery' } as const, null)
const revision = atom({ plugin: 'easy-review', key: 'revision' } as const, 0)

const LONG_TOAST_MS = 10000

type DeliveryText = { sending: string; done: string; keptText?: string }

export function notifyLong($: EngineInterface, message: string | null): void {
  if (message !== null) {
    $.ui.toast(message, { timeoutMs: LONG_TOAST_MS })
  }
}

const stoppedText = (error: unknown): string => `The request stopped: ${error instanceof Error ? error.message : String(error)}`

export async function deliver($: EngineInterface, words: DeliveryText, send: () => Promise<string | null>): Promise<boolean> {
  await update($, delivery, () => ({ kind: 'sending' as const, label: words.sending }))

  let problem: string | null

  try {
    problem = await send()
  } catch (error) {
    problem = stoppedText(error)
  }

  if (problem === null) {
    await update($, delivery, () => null)
    $.ui.toast(words.done)

    return true
  }

  const keptText = words.keptText

  await update($, delivery, () => (keptText === undefined ? null : { kind: 'kept' as const, text: keptText }))
  notifyLong($, problem)

  return false
}

export async function deliverOutcome($: EngineInterface, sending: string, send: () => Promise<string>): Promise<void> {
  await update($, delivery, () => ({ kind: 'sending' as const, label: sending }))

  let message: string

  try {
    message = await send()
  } catch (error) {
    message = stoppedText(error)
  }

  await update($, delivery, () => null)
  notifyLong($, message)
}

export async function renderBand($: EngineInterface, elements: Elements): Promise<RenderElement | null> {
  const current = currentSession()

  await read($, revision)

  if (current === null || current.status !== 'ready') {
    return null
  }

  const open = await read($, expanded)
  const picked = await read($, selected)
  const mode = await read($, composer)
  const state = await read($, delivery)
  const keptText = state?.kind === 'kept' ? state.text : undefined

  const { Box, Button, Input, Text } = elements

  if (state?.kind === 'sending') {
    return (
      <Box borderStyle="round" paddingX={1}>
        <Text color="yellow">{state.label}</Text>
      </Box>
    )
  }

  const close = async () => {
    await update($, delivery, () => null)
    await update($, selected, () => null)
    await update($, composer, () => null)
  }

  if (picked === null && mode === null) {
    return null
  }

  if (mode?.kind === 'delete') {
    const thread = current.threads[mode.thread]
    const place = `${thread?.path ?? ''}:${thread?.line ?? ''}`

    const confirmDelete = async () => {
      const isDone = await deliver(
        $,
        { sending: `Deleting your comment on ${place}...`, done: `Comment deleted on ${place}.` },
        () => editPostedComment($, mode.thread, mode.comment, ''),
      )

      if (isDone) {
        await close()
      }
    }

    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text weight="semibold">Delete your comment on {place}? GitHub cannot bring it back.</Text>
        <Text dimColor>{thread?.comments[mode.comment]?.body ?? ''}</Text>
        <Box>
          <Button key="delete-confirm" onPress={confirmDelete}>
            Delete
          </Button>
          <Button key="delete-cancel" onPress={close}>
            Cancel
          </Button>
        </Box>
      </Box>
    )
  }

  const { locations } = drawnView(current, open)
  const location = picked === null ? undefined : locations.get(picked)

  const save = async (text: string) => {
    const isEmpty = text.trim() === ''

    if (mode?.kind === 'reply') {
      const thread = current.threads[mode.thread]
      const place = `${thread?.path ?? ''}:${thread?.line ?? ''}`
      const isDone =
        isEmpty ||
        (await deliver(
          $,
          { sending: `Posting your reply on ${place}...`, done: `Reply posted on ${place}.`, keptText: text },
          () => replyInThread($, mode.thread, text),
        ))

      if (isDone) {
        await close()
      }

      return
    }

    if (mode?.kind === 'edit') {
      if (isEmpty) {
        await update($, delivery, () => null)
        await update($, composer, () => ({ kind: 'delete' as const, thread: mode.thread, comment: mode.comment }))

        return
      }

      const thread = current.threads[mode.thread]
      const place = `${thread?.path ?? ''}:${thread?.line ?? ''}`
      const isDone = await deliver(
        $,
        { sending: `Updating your comment on ${place}...`, done: `Comment updated on ${place}.`, keptText: text },
        () => editPostedComment($, mode.thread, mode.comment, text),
      )

      if (isDone) {
        await close()
      }

      return
    }

    if (mode === null && location !== undefined && current.target.kind === 'pr' && !isEmpty) {
      const place = `${location.path}:${location.line.newNo ?? location.line.oldNo ?? ''}`

      await close()
      await deliver($, { sending: `Posting your comment on ${place}...`, done: `Comment posted on ${place}.` }, () =>
        saveDraft($, location, text),
      )

      return
    }

    if (mode?.kind === 'draft') {
      await editDraft($, mode.index, text)
    } else if (mode?.kind === 'body') {
      await saveBody($, text)
    } else if (location !== undefined) {
      await saveDraft($, location, text)
    }

    await close()
  }

  let title = ''
  let value: string | undefined
  let fieldKey = 'comment-field'
  const verb = current.target.kind === 'pr' && mode?.kind !== 'draft' && mode?.kind !== 'body' ? 'post' : 'save'
  const hint = `Click the field, type, press Enter to ${verb}.`

  if (mode?.kind === 'draft') {
    const draft = current.stored.drafts[mode.index]

    title = `Edit comment on ${draft?.path ?? ''}:${draft?.line ?? ''}`
    value = draft?.text
    fieldKey = `draft-edit-${mode.index}`
  } else if (mode?.kind === 'reply') {
    const thread = current.threads[mode.thread]

    title = `Reply on ${thread?.path ?? ''}:${thread?.line ?? ''}`
    fieldKey = `reply-${mode.thread}`
  } else if (mode?.kind === 'edit') {
    const thread = current.threads[mode.thread]

    title = `Edit comment on ${thread?.path ?? ''}:${thread?.line ?? ''}`
    value = thread?.comments[mode.comment]?.body
    fieldKey = `comment-edit-${mode.thread}-${mode.comment}`
  } else if (mode?.kind === 'body') {
    title = 'Summary of this review'
    value = current.stored.body
    fieldKey = 'review-body'
  } else if (location !== undefined) {
    title = `Comment on ${location.path}:${location.line.newNo ?? location.line.oldNo ?? ''}`
  } else {
    return null
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text weight="semibold">{title}</Text>
      <Text dimColor>{hint}</Text>
      <Input
        key={fieldKey}
        placeholder={mode?.kind === 'reply' ? 'Write a reply' : 'Write a comment'}
        {...(keptText !== undefined ? { value: keptText } : value === undefined ? {} : { value })}
        submitLabel={verb}
        autoFocus
        onSubmit={save}
      />
      <Button key="comment-cancel" onPress={close}>
        Cancel
      </Button>
    </Box>
  )
}
