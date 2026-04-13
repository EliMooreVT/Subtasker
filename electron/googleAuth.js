const { BrowserWindow, dialog } = require('electron');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const { getClientSecret, setClientSecret, getTokens, setTokens, clearTokens } = require('./store');

const SCOPES = ['https://www.googleapis.com/auth/tasks'];

let authClient;

function parseClientSecret(raw) {
  if (!raw) {
    throw new Error('Client secret is empty');
  }
  const secret = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!secret.installed) {
    throw new Error('Expected installed client credentials');
  }
  return secret.installed;
}

async function handleLoadClientSecret(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  const filePath = result.filePaths[0];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const secret = parseClientSecret(raw);
  setClientSecret({ ...secret, path: filePath });
  clearTokens();
  authClient = null;
  return { clientId: secret.client_id, redirectUris: secret.redirect_uris, filePath };
}

function createOAuthClient() {
  const installed = getClientSecret();
  if (!installed) {
    throw new Error('Load client_secret.json to continue');
  }

  const { client_id, client_secret, redirect_uris } = installed;
  const redirectUri = (redirect_uris && redirect_uris.find((uri) => uri.startsWith('http'))) || 'http://localhost';
  const client = new OAuth2Client({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUri
  });
  client.redirectUri = redirectUri;

  const tokens = getTokens();
  if (tokens) {
    client.setCredentials(tokens);
  }

  return client;
}

async function ensureAuthClient(mainWindow) {
  if (authClient) {
    return authClient;
  }

  authClient = createOAuthClient();
  const tokens = getTokens();
  if (tokens && tokens.access_token) {
    return authClient;
  }

  await requestOAuthConsent(mainWindow, authClient);
  return authClient;
}

function closeOnNavigation(win, handler) {
  const fn = async (event, url) => {
    await handler(event, url);
  };
  win.webContents.on('will-redirect', fn);
  win.webContents.on('will-navigate', fn);
}

async function requestOAuthConsent(mainWindow, client) {
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  const authWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const codePromise = new Promise((resolve, reject) => {
    let completed = false;
    const handleUrl = async (event, url) => {
      if (!url.startsWith(client.redirectUri)) {
        return;
      }
      event.preventDefault();
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        if (!code) {
          throw new Error('Missing authorization code');
        }
        completed = true;
        resolve(code);
      } catch (error) {
        reject(error);
      } finally {
        authWindow.close();
      }
    };

    closeOnNavigation(authWindow, handleUrl);
    authWindow.on('closed', () => {
      if (!completed) {
        reject(new Error('Authentication window closed before authorization.'));
      }
    });
  });

  authWindow.removeMenu?.();
  authWindow.loadURL(authUrl);

  let code;
  try {
    code = await codePromise;
  } catch (error) {
    throw error;
  }

  const tokenResponse = await client.getToken(code);
  client.setCredentials(tokenResponse.tokens);
  setTokens(tokenResponse.tokens);
  return client;
}

async function revokeAuth() {
  if (!authClient) {
    return;
  }
  const tokens = getTokens();
  if (tokens && tokens.access_token) {
    try {
      await authClient.revokeToken(tokens.access_token);
    } catch (error) {
      console.warn('Failed to revoke token', error);
    }
  }
  clearTokens();
  authClient = null;
}

module.exports = {
  parseClientSecret,
  handleLoadClientSecret,
  ensureAuthClient,
  revokeAuth
};
