/**
 * Logger Utility
 * 
 * Centralized logger configuration for consistent logging
 */

const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const LOGS_DIR = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
    try {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    } catch (error) {
        console.error(`Failed to create logs directory: ${error.message}`);
    }
}

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Define log colors
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`,
    ),
);

// Define transports
const transports = [
    // Console output with colors
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(
                (info) => `${info.timestamp} ${info.level}: ${info.message}`,
            ),
        ),
    }),
    // Always log to combined.log
    new winston.transports.File({
        filename: path.join(LOGS_DIR, 'combined.log'),
    }),
    // Error logs to error.log
    new winston.transports.File({
        filename: path.join(LOGS_DIR, 'error.log'),
        level: 'error',
    }),
];

// Create the logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels,
    format,
    transports,
    // Don't exit on error
    exitOnError: false,
});

module.exports = {
    logger,
}; 