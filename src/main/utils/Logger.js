import path from 'path'
import util from 'util'
import winston from 'winston'

// winston keeps the extra arguments of a log call under this symbol (triple-beam's SPLAT).
const SPLAT = Symbol.for('splat')

const LOG_FILE = 'launcher.log'
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 5
const MAX_CAUSE_DEPTH = 3

/**
 * Last line of defence against a credential reaching the console or, worse, a file that
 * outlives the session. The real rule is still "never log a token": these only catch what
 * slips through inside an error object — got attaches the whole request to its errors,
 * `Authorization` header and form body included.
 */
const REDACTIONS = [
    // accessToken: 'eyJ…', "refresh_token":"M.C5…", Authorization: 'XBL3.0 x=…', RpsTicket=d=…
    [/\b(\w*token|authorization|rpsticket|secrets|password)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, '$1$2[redacted]'],
    // The JVM command line carries the Minecraft token as a bare argument.
    [/(--accessToken\s+)\S+/g, '$1[redacted]'],
    // Any JWT, which is what Minecraft access tokens are.
    [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g, '[redacted]']
]

export function redact(text) {
    return REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

function timestamp() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * An error as stack, code and cause chain — never `util.inspect` with unlimited depth, which
 * is what used to dump got's request options, headers and all, into the output.
 */
function describeError(err, depth = 0) {
    let out = err.stack || `${err.name}: ${err.message}`
    if (typeof err.code === 'string' || typeof err.code === 'number') out += `\n    code: ${err.code}`

    if (err.cause != null && depth < MAX_CAUSE_DEPTH) {
        out += '\nCaused by: ' + (err.cause instanceof Error
            ? describeError(err.cause, depth + 1)
            : util.inspect(err.cause, { depth: 2, breakLength: Infinity }))
    }
    return out
}

function describeValue(value) {
    if (value instanceof Error) return describeError(value)
    if (typeof value === 'object' && value !== null) return util.inspect(value, { depth: 3, breakLength: Infinity })
    return String(value)
}

/**
 * `[time] [level] [label]: message`, the layout helios-core's LoggerUtil used, so logs read
 * the same as before. When the only extra argument is an Error, winston has already appended
 * its message to ours; it is trimmed off here because the stack repeats it.
 */
function renderLine(info) {
    let message = typeof info.message === 'string' ? info.message : util.inspect(info.message)
    const splat = info[SPLAT] || []
    let trailer = ''

    if (splat.length === 1 && splat[0] instanceof Error) {
        const suffix = ` ${splat[0].message}`
        if (splat[0].message && message.endsWith(suffix)) message = message.slice(0, -suffix.length)
        trailer = `\n${describeError(splat[0])}`
    } else if (splat.length > 0) {
        message += ' ' + splat.map(describeValue).join(' ')
    }

    return redact(`[${timestamp()}] [${info.level}] [${info.label}]: ${message}${trailer}`)
}

const line = winston.format.printf(renderLine)

/**
 * One winston logger for the whole main process; every `getLogger(name)` is a child of it,
 * so a transport added later — the file, once the launcher directory is known — reaches
 * every logger already handed out.
 *
 * This used to wrap helios-core's `LoggerUtil`, which builds a separate logger per label
 * with a console transport only, so a packaged build kept nothing on disk while its error
 * messages told the player to "check the logs". helios' own internal loggers still go to
 * the console only; the managers log every helios failure they catch, cause included.
 */
const root = winston.createLogger({
    level: 'debug',
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), line)
        })
    ]
})

// A transport that fails (disk full, folder removed) is re-emitted here, and an `error`
// event with no listener would take the main process down with it.
root.on('error', (err) => {
    console.error('Logger transport failed:', err)
})

class Logger {
    static loggers = {}
    static logsDirectory = null

    static getLogger(name) {
        if (!this.loggers[name]) {
            this.loggers[name] = root.child({ label: name })
        }
        return this.loggers[name]
    }

    /**
     * Starts writing every log line to `<directory>/launcher.log` as well, rotating at 5 MB
     * and keeping five files (`launcher.log` is always the newest). Called once at startup,
     * after the single-instance lock, so two launchers never rotate the same file.
     */
    static enableFileLogging(directory) {
        if (this.logsDirectory) return

        this.logsDirectory = directory
        root.add(new winston.transports.File({
            filename: path.join(directory, LOG_FILE),
            maxsize: MAX_FILE_BYTES,
            maxFiles: MAX_FILES,
            tailable: true,
            format: line
        }))
    }
}

export default Logger
