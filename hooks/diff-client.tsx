import type { ClientModule } from 'claude-code'

import type { DiffClientProps, DiffLine } from '../types'

type ClientState = { row: number | null; offset: number }

type Chunk = { kind: 'code'; lines: DiffLine[] } | { kind: 'highlight'; line: DiffLine }

const SCROLL_STEP = 8

const markOf = (line: DiffLine): string => (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ')

const numberOf = (line: DiffLine): number => line.newNo ?? line.oldNo ?? 0

const shown = (line: DiffLine, offset: number): string => {
  const text = line.text.replaceAll('\t', '  ')

  return offset === 0 ? text : text.slice(offset)
}

const hunkSource = (lines: DiffLine[], offset: number): string => {
  const first = lines[0]
  const oldStart = lines.find(line => line.oldNo !== undefined)?.oldNo ?? first?.newNo ?? 1
  const newStart = lines.find(line => line.newNo !== undefined)?.newNo ?? first?.oldNo ?? 1
  const oldCount = lines.filter(line => line.kind !== 'add').length
  const newCount = lines.filter(line => line.kind !== 'del').length
  const body = lines.map(line => `${markOf(line)}${shown(line, offset)}`)

  return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body].join('\n')
}

const DiffClient: ClientModule<DiffClientProps, ClientState> = (props, surface) => {
  const { Box, Code, Text } = surface.elements
  const hoverRow = surface.state?.row ?? null
  const offset = surface.state?.offset ?? 0
  const longest = Math.max(...props.lines.map(line => line.text.replaceAll('\t', '  ').length), 0)

  const setHover = (row: number | null) => {
    if (row !== hoverRow) {
      surface.setState({ row, offset })
    }
  }

  surface.onPointer(event => {
    if (event.type === 'leave') {
      setHover(null)

      return
    }

    const line = props.lines[event.y]

    if (event.type === 'move' || event.type === 'enter') {
      setHover(line === undefined ? null : event.y)

      return
    }

    if (event.type === 'down' && event.button === 'left' && line !== undefined) {
      surface.post({ lineKey: line.key })
    }
  })

  surface.onKey(event => {
    if (event.key === 'right') {
      surface.setState({ row: hoverRow, offset: Math.min(offset + SCROLL_STEP, Math.max(longest - 1, 0)) })
    } else if (event.key === 'left') {
      surface.setState({ row: hoverRow, offset: Math.max(offset - SCROLL_STEP, 0) })
    } else if (event.key === 'home') {
      surface.setState({ row: hoverRow, offset: 0 })
    }
  })

  const chunks: Chunk[] = []

  props.lines.forEach((line, row) => {
    const last = chunks[chunks.length - 1]

    if (row === hoverRow || line.key === props.selectedKey) {
      chunks.push({ kind: 'highlight', line })
    } else if (last?.kind === 'code') {
      last.lines.push(line)
    } else {
      chunks.push({ kind: 'code', lines: [line] })
    }
  })

  const numberWidth = String(Math.max(...props.lines.map(numberOf), 0)).length
  const textWidth = Math.max(surface.columns - 1, 0)

  return (
    <Box>
      <Box flexDirection="column" width={1}>
        {props.lines.map(line => (
          <Text color="yellow">{line.key === props.selectedKey ? '>' : offset > 0 ? '<' : ' '}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {chunks.map(chunk =>
          chunk.kind === 'code' ? (
            <Code format="diff" source={hunkSource(chunk.lines, offset)} path={props.path} wrap="truncate-end" />
          ) : (
            <Text backgroundColor="blue" wrap="truncate-end">
              {` ${String(numberOf(chunk.line)).padStart(numberWidth)} ${markOf(chunk.line)} ${shown(chunk.line, offset)}`.padEnd(textWidth)}
            </Text>
          ),
        )}
      </Box>
    </Box>
  )
}

export default DiffClient
