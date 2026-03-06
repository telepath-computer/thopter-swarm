/**
 * Custom xterm.js link provider that detects URLs spanning multiple terminal rows.
 *
 * Inside tmux, long URLs wrap across rows but xterm.js doesn't set `isWrapped`
 * (tmux redraws rows independently via cursor addressing). The built-in
 * WebLinksAddon only matches within a single row, so wrapped URLs are broken.
 *
 * Strategy:
 * 1. When asked for links on row N, collect a window of rows around N.
 * 2. Join them and run a URL regex on the joined text.
 * 3. For each match that spans a row boundary, verify the boundary falls
 *    mid-URL (no whitespace gap) so we don't false-join unrelated rows.
 * 4. Map match offsets back to buffer coordinates.
 *
 * OSC 8 hyperlinks are handled separately by xterm.js's built-in linkHandler,
 * so this provider only deals with plain-text URLs.
 *
 * Note: provideLinks receives 1-based line numbers. IBufferCellPosition.y is
 * also 1-based. But buffer.getLine() takes a 0-based index.
 */

import type { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm'

const URL_RE = /https?:\/\/[^\s"'`<>(){}\[\]]+/g

// Characters that look like they're mid-URL (the URL continues on the next row)
const CONTINUATION_CHARS = /[a-zA-Z0-9\/_\-=&%.+~#@:,;?!]/

// Trailing punctuation to strip (likely not part of the URL)
const TRAILING_PUNCT = /[.,;:!?)>\]}"']+$/

export function createWrappedLinkProvider(
  terminal: Terminal,
  activate: (event: MouseEvent, uri: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const buffer = terminal.buffer.active
      const cols = terminal.cols

      // bufferLineNumber is 1-based. Collect a window of ±5 rows.
      const windowSize = 5
      const startLine = Math.max(1, bufferLineNumber - windowSize)
      const endLine = Math.min(buffer.length, bufferLineNumber + windowSize)

      // Build joined text and track row boundaries.
      // Each segment maps a 1-based line number to its offset in the joined string.
      const segments: { line: number; offset: number; text: string }[] = []
      let joined = ''

      for (let line = startLine; line <= endLine; line++) {
        const bufLine = buffer.getLine(line - 1) // getLine is 0-based
        if (!bufLine) continue
        const text = bufLine.translateToString(false, 0, cols)
        segments.push({ line, offset: joined.length, text })
        joined += text
      }

      // Find all URL matches in the joined text
      const links: ILink[] = []
      URL_RE.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = URL_RE.exec(joined)) !== null) {
        let url = match[0]
        const matchStart = match.index
        const matchEnd = matchStart + url.length

        // For each row boundary inside the match, verify the text looks like
        // a continuous URL (no whitespace at the join point).
        let valid = true
        for (let i = 0; i < segments.length - 1; i++) {
          const boundary = segments[i].offset + segments[i].text.length
          if (boundary > matchStart && boundary < matchEnd) {
            const charBefore = joined[boundary - 1]
            const charAfter = joined[boundary]
            if (
              !charBefore || !charAfter ||
              /\s/.test(charBefore) || /\s/.test(charAfter)
            ) {
              valid = false
              break
            }
            if (!CONTINUATION_CHARS.test(charBefore)) {
              valid = false
              break
            }
          }
        }

        if (!valid) continue

        // Strip common trailing punctuation
        url = url.replace(TRAILING_PUNCT, '')
        const urlEnd = matchStart + url.length

        // Map match offsets to buffer coordinates (1-based)
        const range = offsetToRange(matchStart, urlEnd, segments)
        if (!range) continue

        // Only return links that overlap the requested line
        if (range.start.y > bufferLineNumber || range.end.y < bufferLineNumber) continue

        links.push({
          range,
          text: url,
          activate: (event) => activate(event, url),
        })
      }

      callback(links.length > 0 ? links : undefined)
    },
  }
}

/** Map character offsets in the joined string back to 1-based buffer coordinates. */
function offsetToRange(
  start: number,
  end: number,
  segments: { line: number; offset: number; text: string }[],
): IBufferRange | null {
  let startPos: { x: number; y: number } | null = null
  let endPos: { x: number; y: number } | null = null

  for (const seg of segments) {
    const segEnd = seg.offset + seg.text.length

    // Find which segment contains the start offset
    if (startPos === null && start >= seg.offset && start < segEnd) {
      startPos = {
        x: start - seg.offset + 1, // 1-based column
        y: seg.line,                // 1-based line (already is)
      }
    }

    // Find which segment contains the end offset
    if (end > seg.offset && end <= segEnd) {
      endPos = {
        x: end - seg.offset, // 1-based, inclusive
        y: seg.line,
      }
    }
  }

  if (!startPos || !endPos) return null
  return { start: startPos, end: endPos }
}
