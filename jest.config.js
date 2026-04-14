'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs' } }]
  },
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  resetModules: true,
  clearMocks: true,
};
