/**
 * AvatarLive — Processus principal Electron
 * Remplacement webcam en temps réel pour streamers via OBS
 */

require('dotenv').config();
const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const { fork } = require('child_process');

const OBSWebSocket             = require('obs-websocket-js').default;
const tmi                      = require('tmi.js');
const { openStreamDeck }       = require('@elgato-stream-deck/node');
const { GlobalKeyboardListener } = require('node-global-key-listener');

const obs = new OBSWebSocket();

const AVATARS = ['default', 'avatar_1', 'avatar_2', 'avatar_3'];

let mainWindow    = null;
let tray          = null;
let stripeProcess = null;
let twitchClient  = null;
let streamDeck    = null;
let keyListener   = null;
let currentAvatar = 'default';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960, height: 700, minWidth: 800, minHeight: 600,
    title: 'AvatarLive',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools();
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.ico'));
  tray.setToolTip('AvatarLive');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir AvatarLive', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

function startStripeServer() {
  stripeProcess = fork(path.join(__dirname, '..', 'stripe_server.js'), [], {
    env: { ...process.env }, silent: false,
  });
  stripeProcess.on('error', (err) => console.error('[Stripe] Erreur serveur :', err.message));
  stripeProcess.on('exit', (code) => { if (code !== 0) console.warn('[Stripe] Arrêt inattendu (code', code + ')'); });
}

async function connectOBS(host = 'localhost', port = 4455, password = '') {
  try {
    await obs.connect(`ws://${host}:${port}`, password || undefined);
    console.log('[OBS] Connecté');
    mainWindow?.webContents.send('obs:connected', { host, port });
  } catch (err) {
    console.error('[OBS] Connexion échouée :', err.message);
    mainWindow?.webContents.send('obs:error', err.message);
  }
}

async function switchAvatar(avatarName) {
  if (!AVATARS.includes(avatarName)) return;
  currentAvatar = avatarName;
  try {
    await obs.call('SetCurrentProgramScene', { sceneName: avatarName });
    console.log('[OBS] Avatar :', avatarName);
    mainWindow?.webContents.send('avatar:changed', avatarName);
  } catch (err) {
    console.error('[OBS] Switch échoué :', err.message);
  }
}

function connectTwitch(channel, username, token) {
  if (twitchClient) { twitchClient.disconnect().catch(() => {}); twitchClient = null; }
  twitchClient = new tmi.Client({
    identity: { username, password: `oauth:${token}` },
    channels: [channel],
    logger: { info: () => {}, warn: () => {}, error: console.error },
  });
  twitchClient.connect()
    .then(() => { console.log('[Twitch] Connecté à', channel); mainWindow?.webContents.send('twitch:connected', channel); })
    .catch((err) => { console.error('[Twitch] Connexion échouée :', err.message); mainWindow?.webContents.send('twitch:error', err.message); });
  twitchClient.on('message', (_channel, tags, message, self) => {
    if (self) return;
    const match = message.toLowerCase().trim().match(/^!avatar\s+(\w+)$/);
    if (match && AVATARS.includes(match[1])) switchAvatar(match[1]);
    mainWindow?.webContents.send('twitch:message', {
      user: tags['display-name'] || tags.username, message, color: tags.color || '#FFFFFF',
    });
  });
}

async function connectStreamDeck() {
  try {
    streamDeck = await openStreamDeck();
    console.log('[StreamDeck] Connecté —', streamDeck.NUM_KEYS, 'touches');
    mainWindow?.webContents.send('streamdeck:connected');
    streamDeck.on('down', (keyIndex) => {
      const avatar = AVATARS[keyIndex];
      if (avatar) switchAvatar(avatar);
      mainWindow?.webContents.send('streamdeck:keydown', keyIndex);
    });
    streamDeck.on('error', (err) => console.error('[StreamDeck] Erreur :', err.message));
  } catch (err) {
    console.warn('[StreamDeck] Non détecté :', err.message);
  }
}

function setupGlobalKeys() {
  const shortcuts = { F1: AVATARS[0], F2: AVATARS[1], F3: AVATARS[2], F4: AVATARS[3] };
  keyListener = new GlobalKeyboardListener();
  keyListener.addListener((e) => {
    if (e.state === 'DOWN' && shortcuts[e.name]) switchAvatar(shortcuts[e.name]);
  });
}

function setupIPC() {
  ipcMain.handle('obs:connect', (_, { host, port, password }) => connectOBS(host, port, password));
  ipcMain.handle('obs:disconnect', async () => {
    try { await obs.disconnect(); } catch {}
    mainWindow?.webContents.send('obs:disconnected');
  });
  ipcMain.handle('avatar:switch', (_, avatarName) => switchAvatar(avatarName));
  ipcMain.handle('twitch:connect', (_, { channel, username, token }) => connectTwitch(channel, username, token));
  ipcMain.handle('twitch:disconnect', async () => {
    if (twitchClient) { await twitchClient.disconnect().catch(() => {}); twitchClient = null; }
    mainWindow?.webContents.send('twitch:disconnected');
  });
  ipcMain.handle('streamdeck:connect', () => connectStreamDeck());
  ipcMain.handle('app:getState', () => ({
    currentAvatar, avatars: AVATARS,
    obsConnected: obs.socket?.readyState === 1,
    twitchConnected: !!twitchClient && twitchClient.readyState() === 'OPEN',
  }));
}

app.whenReady().then(() => {
  createWindow(); createTray(); setupIPC(); setupGlobalKeys(); startStripeServer();
  connectOBS(process.env.OBS_HOST || 'localhost', parseInt(process.env.OBS_PORT || '4455'), process.env.OBS_PASSWORD || '');
});

app.on('window-all-closed', () => { if (process.platform === 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show(); });
app.on('before-quit', () => {
  app.isQuitting = true;
  keyListener?.kill(); stripeProcess?.kill();
  obs.disconnect().catch(() => {});
  twitchClient?.disconnect().catch(() => {});
  streamDeck?.close().catch(() => {});
});

