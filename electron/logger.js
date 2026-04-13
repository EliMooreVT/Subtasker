const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(app.getPath('userData'), 'subtasker-error.log');

function ensureLogFile() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, '', { encoding: 'utf-8' });
    }
  } catch (error) {
    console.error('Failed to prepare log file', error);
  }
}

function formatErrorMessage(message, error) {
  const timestamp = new Date().toISOString();
  const headline = `[${timestamp}] ${message}`;
  const detail = error?.stack || error?.message || String(error);
  return `${headline}\n${detail}\n\n`;
}

function append(entry) {
  try {
    ensureLogFile();
    fs.appendFileSync(LOG_FILE, entry, { encoding: 'utf-8' });
  } catch (error) {
    console.error('Failed to write to error log', error);
  }
}

function logError(message, error) {
  const entry = formatErrorMessage(message, error);
  append(entry);
}

function getLogPath() {
  return LOG_FILE;
}

module.exports = {
  logError,
  getLogPath
};
