import { LoggerUtil } from 'helios-core'

class Logger {
    static loggers = {}

    static getLogger(name) {
        if (!this.loggers[name]) {
            this.loggers[name] = LoggerUtil.getLogger(name)
        }
        return this.loggers[name]
    }
}

export default Logger
