const Store = require('electron-store');

const store = new Store({
  name: 'subtasker',
  encryptionKey: undefined,
  defaults: {
    google: {
      clientSecret: null,
      tokens: null
    },
    openai: {
      apiKey: '',
      context: ''
    },
    window: {
      width: 1200,
      height: 760
    }
  }
});

function getClientSecret() {
  return store.get('google.clientSecret');
}

function setClientSecret(secret) {
  store.set('google.clientSecret', secret);
}

function getTokens() {
  return store.get('google.tokens');
}

function setTokens(tokens) {
  store.set('google.tokens', tokens);
}

function clearTokens() {
  store.set('google.tokens', null);
}

function getOpenAiKey() {
  return store.get('openai.apiKey');
}

function setOpenAiKey(key) {
  store.set('openai.apiKey', key);
}

function getOpenAiContext() {
  return store.get('openai.context');
}

function setOpenAiContext(context) {
  store.set('openai.context', context);
}

function getWindowBounds() {
  return store.get('window');
}

function setWindowBounds(bounds) {
  store.set('window', bounds);
}

module.exports = {
  store,
  getClientSecret,
  setClientSecret,
  getTokens,
  setTokens,
  clearTokens,
  getOpenAiKey,
  setOpenAiKey,
  getOpenAiContext,
  setOpenAiContext,
  getWindowBounds,
  setWindowBounds
};
