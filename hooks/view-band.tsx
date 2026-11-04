import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement } from 'claude-code'

import type { Elements } from './view-row'
import { currentSession, drawnView, editDraft, editPostedComment, replyInThread, saveBody, saveDraft } from './review'

const selected = atom({ plugin: 'easy-review', key: 'selected' } as const, null)
const composer = atom({ plugin: 'easy-review', key: 'composer' } as const, null)
const expanded = atom({ plugin: 'easy-review', key: 'expanded' } as const, [])
const outcome = atom({ plugin: 'easy-review', key: 'outcome' } as const, null)

export async function renderBand($: EngineInterface, elements: Elements): Promise<RenderElement | null> {
  const current = currentSession()

  if (current === null || current.status !== 'ready') {
    return null
  }

  const open = await read($, expanded)
  const picked = await read($, selected)
  const mode = await read($, composer)

  if (picked === null && mode === null) {
    return null
  }

  const { Box, Button, Input, Text } = elements
  const { locations } = drawnView(current, open)
  const location = picked === null ? undefined : locations.get(picked)

  const close = async () => {
    await update($, selected, () => null)
    await update($, composer, () => null)
  }

  const report = async (message: string | null) => {
    if (message !== null) {
      await update($, outcome, () => message)
    }
  }

  const save = async (text: string) => {
    if (mode?.kind === 'draft') {
      await editDraft($, mode.index, text)
    } else if (mode?.kind === 'reply') {
      await report(await replyInThread($, mode.thread, text))
    } else if (mode?.kind === 'edit') {
      await report(await editPostedComment($, mode.thread, mode.comment, text))
    } else if (mode?.kind === 'body') {
      await saveBody($, text)
    } else if (location !== undefined) {
      await report(await saveDraft($, location, text))
    }

    await close()
  }

  let title = ''
  let value: string | undefined
  let fieldKey = 'comment-field'
  let hint = 'Click the field, type, press Enter to save.'

  if (mode?.kind === 'draft') {
    const draft = current.stored.drafts[mode.index]

    title = `Edit comment on ${draft?.path ?? ''}:${draft?.line ?? ''}`
    value = draft?.text
    fieldKey = `draft-edit-${mode.index}`
    hint = `${hint} Empty text deletes the comment.`
  } else if (mode?.kind === 'reply') {
    const thread = current.threads[mode.thread]

    title = `Reply on ${thread?.path ?? ''}:${thread?.line ?? ''}`
    fieldKey = `reply-${mode.thread}`
  } else if (mode?.kind === 'edit') {
    const thread = current.threads[mode.thread]

    title = `Edit comment on ${thread?.path ?? ''}:${thread?.line ?? ''}`
    value = thread?.comments[mode.comment]?.body
    fieldKey = `comment-edit-${mode.thread}-${mode.comment}`
    hint = `${hint} Empty text deletes the comment.`
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
        {...(value === undefined ? {} : { value })}
        submitLabel="save"
        autoFocus
        onSubmit={save}
      />
      <Button key="comment-cancel" onPress={close}>
        Cancel
      </Button>
    </Box>
  )
}
