import type { EngineInterface } from 'claude-code'

export type Output = {
  code: number | null
  stdout: string
  stderr: string
}

export async function collect(
  $: EngineInterface,
  argv: readonly string[],
  init: { cwd?: string; input?: string } = {},
): Promise<Output> {
  let stdout = ''
  let stderr = ''

  try {
    const stream = $.process.spawn({ argv, ...init })

    for await (const chunk of stream) {
      if (chunk.stream === 'stdout') {
        stdout += chunk.text
      } else {
        stderr += chunk.text
      }
    }

    const { code } = await stream.result

    return { code, stdout, stderr }
  } catch (error) {
    return { code: null, stdout, stderr: error instanceof Error ? error.message : String(error) }
  }
}
