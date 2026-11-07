import type { Readable } from 'stream'

/** A line longer than this with no end in sight is flushed as it is, not buffered forever. */
const MAX_PENDING_CHARS = 64 * 1024

/**
 * Splits a child process stream into whole lines.
 *
 * A `data` event carries whatever the pipe happened to deliver, so a chunk can end halfway
 * through a line and the next one finish it. Matching startup milestones on raw chunks misses
 * exactly those lines, and trimming each chunk — what the launcher used to forward — glued
 * the two halves to their neighbours in the log viewer.
 *
 * @param onLines Called once per chunk with its complete, non-blank lines, so a burst of
 * output is still one message across IPC rather than hundreds.
 * @returns Flushes the trailing partial line; call it when the stream ends.
 */
export function readLines(stream: Readable, onLines: (lines: string[]) => void): () => void {
    let pending = ''

    // Decodes across chunk boundaries, so a multi-byte character split by the pipe stays whole.
    stream.setEncoding('utf8')

    stream.on('data', (chunk: string) => {
        const parts = (pending + chunk).split(/\r?\n|\r/)
        // split always returns at least one element.
        pending = parts.pop() ?? ''

        if (pending.length > MAX_PENDING_CHARS) {
            parts.push(pending)
            pending = ''
        }

        const lines = parts.filter(line => line.trim().length > 0)
        if (lines.length > 0) onLines(lines)
    })

    return () => {
        if (pending.trim().length > 0) onLines([pending])
        pending = ''
    }
}
