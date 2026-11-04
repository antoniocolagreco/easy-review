const CONTROL = new RegExp('[\\x00-\\x08\\x0a-\\x1f\\x7f]', 'g')
const C1 = new RegExp('[\\x80-\\x9f]', 'g')
const INVISIBLE = new RegExp('[\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]', 'g')

const hex = (char: string): string => char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0') ?? '0000'

const controlMark = (char: string): string => {
  const code = char.codePointAt(0) ?? 0

  return String.fromCodePoint(code === 0x7f ? 0x2421 : 0x2400 + code)
}

const replaceMarks = (text: string): string =>
  text
    .replace(CONTROL, controlMark)
    .replace(C1, char => `[U+${hex(char)}]`)
    .replace(INVISIBLE, char => `[U+${hex(char)}]`)

export const sanitizeLine = (raw: string): { text: string; hadCarriageReturn: boolean } => {
  const hadCarriageReturn = raw.endsWith('\r')
  const body = hadCarriageReturn ? raw.slice(0, -1) : raw

  return { text: replaceMarks(body), hadCarriageReturn }
}

export const sanitizeText = (raw: string): string => replaceMarks(raw.replaceAll('\t', ' '))
