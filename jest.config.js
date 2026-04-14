'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: {},
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/src'],
  resetModules: true,
  clearMocks: true,
};
