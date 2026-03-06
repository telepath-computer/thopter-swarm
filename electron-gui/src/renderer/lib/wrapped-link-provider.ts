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
 * 3. For each match, check whether it looks like a URL that was split mid-token
 *    (no whitespace between end-of-row and start-of-next-row).
 * 4. Map match offsets back to buffer coordinates.
 *
 * OSC 8 hyperlinks are handled separately by xterm.js's built-in linkHandler,
 * so this provider only deals with plain-text URLs.
 */

import type { Terminal, ILinkProvider, ILink, IBufferRange } from '@xterm/xterm'

// URL regex — matches http(s) and common protocols, allowing wrapped continuation.
// Intentionally permissive on the path/query portion to catch long GitHub URLs etc.
const URL_RE = /https?:\/\/[^\s"'`<>(){}\[\]]+/g

// Characters that are unlikely to end a URL (more likely the URL continues on the next line)
const CONTINUATION_CHARS = /[a-zA-Z0-9\/_\-=&%.+~#@:]/

// Characters that typically terminate a URL when found at the very end
const TRAILING_PUNCT = /[.,;:!?)>\]}"']+$/

export function createWrappedLinkProvider(
  terminal: Terminal,
  activate: (event: MouseEvent, uri: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const buffer = terminal.buffer.active
      const cols = terminal.cols

      // Collect a window of rows: up to 5 above and 5 below the target line.
      // This handles URLs that wrap across up to ~10 rows (~800+ chars at 80 cols).
      const windowAbove = 5
      const windowBelow = 5
      const startRow = Math.max(1, bufferLineNumber - windowAbove)
      const endRow = Math.min(buffer.length, bufferLineNumber + windowBelow)

      // Build joined text and track row boundaries.
      // rowOffsets[i] = { row: bufferRow, startOffset: charOffset, text: rowText }
      const segments: { row: number; offset: number; text: string }[] = []
      let joined = ''

      for (let row = startRow; row <= endRow; row++) {
        const line = buffer.getLine(row)
        if (!line) continue
        const text = line.translateToString(false, 0, cols)
        segments.push({ row, offset: joined.length, text })
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

        // Check that the URL isn't just stitched across a gap with whitespace.
        // For each row boundary that falls inside the match, verify the row
        // ended without whitespace and the next row starts without whitespace.
        let valid = true
        for (let i = 0; i < segments.length - 1; i++) {
          const boundary = segments[i].offset + segments[i].text.length
          if (boundary > matchStart && boundary < matchEnd) {
            // Check last char of this row's contribution to the match
            const charBeforeBoundary = joined[boundary - 1]
            const charAfterBoundary = joined[boundary]
            if (
              !charBeforeBoundary || !charAfterBoundary ||
              /\s/.test(charBeforeBoundary) || /\s/.test(charAfterBoundary)
            ) {
              valid = false
              break
            }
            // Also check that the char before boundary looks like mid-URL
            if (!CONTINUATION_CHARS.test(charBeforeBoundary)) {
              valid = false
              break
            }
          }
        }

        if (!valid) continue

        // Strip common trailing punctuation that's likely not part of the URL
        url = url.replace(TRAILING_PUNCT, '')

        // Map match back to buffer coordinates
        const range = offsetToRange(matchStart, matchStart + url.length, segments)
        if (!range) continue

        // Only include links that overlap with the requested row
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

function offsetToRange(
  start: number,
  end: number,
  segments: { row: number; offset: number; text: string }[],
): IBufferRange | null {
  let startPos: { x: number; y: number } | null = null
  let endPos: { x: number; y: number } | null = null

  for (const seg of segments) {
    const segEnd = seg.offset + seg.text.length
    if (startPos === null && start >= seg.offset && start < segEnd) {
      startPos = { x: start - seg.offset + 1, y: seg.row } // 1-based x
    }
    if (end > seg.offset && end <= segEnd) {
      endPos = { x: end - seg.offset, y: seg.row } // 1-based, inclusive
    }
  }

  if (!startPos || !endPos) return null
  return { start: startPos, end: endPos }
}
