'use strict';

jest.mock('../electron/store', () => ({
  getClientSecret: jest.fn(),
  setClientSecret: jest.fn(),
  getTokens: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
}));

jest.mock('../electron/logger', () => ({
  logError: jest.fn(),
}));

const mockGenerateAuthUrl = jest.fn(() => 'https://accounts.google.com/o/oauth2/auth');
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();
const mockRevokeToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    setCredentials: mockSetCredentials,
    revokeToken: mockRevokeToken,
    redirectUri: 'http://localhost',
  })),
}));

jest.mock('googleapis', () => ({ google: {} }));

const { getTokens, clearTokens } = require('../electron/store');

describe('googleAuth', () => {
  let googleAuth;

  beforeEach(() => {
    googleAuth = require('../electron/googleAuth');
  });

  describe('parseClientSecret', () => {
    it('should return the installed object when given a valid JSON string', () => {
      const secret = { installed: { client_id: 'id', client_secret: 'secret', redirect_uris: ['http://localhost'] } };
      const result = googleAuth.parseClientSecret(JSON.stringify(secret));
      expect(result).toEqual(secret.installed);
    });

    it('should return the installed object when given a plain object', () => {
      const secret = { installed: { client_id: 'id2', client_secret: 'sec2', redirect_uris: [] } };
      const result = googleAuth.parseClientSecret(secret);
      expect(result).toEqual(secret.installed);
    });

    it('should throw when the raw value is empty/null', () => {
      expect(() => googleAuth.parseClientSecret(null)).toThrow('Client secret is empty');
      expect(() => googleAuth.parseClientSecret('')).toThrow('Client secret is empty');
      expect(() => googleAuth.parseClientSecret(undefined)).toThrow('Client secret is empty');
    });

    it('should throw when the parsed object has no installed key', () => {
      const secret = { web: { client_id: 'id' } };
      expect(() => googleAuth.parseClientSecret(JSON.stringify(secret))).toThrow(
        'Expected installed client credentials'
      );
    });
  });

  describe('revokeAuth', () => {
    it('should do nothing when there is no active auth client', async () => {
      getTokens.mockReturnValue(null);

      await expect(googleAuth.revokeAuth()).resolves.toBeUndefined();
      expect(clearTokens).not.toHaveBeenCalled();
    });
  });
});
