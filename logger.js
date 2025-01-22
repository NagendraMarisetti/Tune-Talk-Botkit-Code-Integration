const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');


const addLineNumber = format((info) => {
    const stack = new Error().stack;
    const stackLines = stack.split('\n');

    // Find the first stack line that doesn't come from a library or this logger
    const callerLine = stackLines.find(line => {
        return !line.includes('node_modules') && !line.includes('Error') && !line.includes('logger.js'); // Exclude internal/library paths
    });

    if (callerLine) {
        const lineMatch = callerLine.match(/\((.*):(\d+):(\d+)\)/); // Match file path, line, and column
        if (lineMatch) {
            const [, file, line] = lineMatch;
            info.lineNumber = `${file}:${line}`; // Add file and line number
        } else {
            info.lineNumber = 'unknown';
        }
    } else {
        info.lineNumber = 'unknown';
    }

    return info;
});


const logger = createLogger({
    level: 'info',
    format: format.combine(
        // calling add line number function
        addLineNumber(), 
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, functionName, lineNumber }) => {
            // get the function name manually 
            const funcName = functionName || 'unknown'; 
            // returning the log statement in specific format
            return `${timestamp} [${level.toUpperCase()}]: [Function: ${funcName}] [Line: ${lineNumber}] ${message}`;
        })
    ),
    // creating a audit file with filename having date and maximum size of 20mb and retained for 14days
    transports: [
        new DailyRotateFile({
            filename: 'logs/LogFile-%DATE%.log', 
            datePattern: 'YYYY-MM-DD',          
            maxSize: '20m',                      
            maxFiles: '14d'                     
        }),
        new transports.Console()
    ]
});

// Log function that accepts the function name directly
logger.logWithFunction = function (level, message, functionName) {
    this.log(level, message, { functionName });
};

// Shortcut for info logs with function name
logger.infoWithFunction = function (message, functionName) {
    this.logWithFunction('info', message, functionName);
};

// Shortcut for error logs with function name
logger.errorWithFunction = function (message, functionName) {
    this.logWithFunction('error', message, functionName);
};

// Shortcut for warning logs with function name
logger.warnWithFunction = function (message, functionName) {
    this.logWithFunction('warn', message, functionName);
};

module.exports = logger;
