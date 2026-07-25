// Synchronisation Google Drive — 100% côté navigateur, aucun serveur intermédiaire.
// L'app se connecte directement à VOTRE compte Google avec VOTRE Client ID OAuth.
// Scope "drive.file" : l'app ne voit QUE les fichiers qu'elle a elle-même créés
// (pas le reste de votre Drive).

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "REMPLACE_MOI.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Budget Perso";
const FILE_NAME = "budget-data.json";

const LS_CONNECTED = "budget-perso:drive-connected";
const LS_FOLDER_ID = "budget-perso:drive-folder-id";
const LS_FILE_ID = "budget-perso:drive-file-id";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

function ensureTokenClient() {
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services non chargé (vérifie ta connexion internet ou recharge la page).");
  }
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // remplacé dynamiquement à chaque appel, voir getAccessToken
    });
  }
  return tokenClient;
}

export function isConnected() {
  return localStorage.getItem(LS_CONNECTED) === "1";
}

export function getAccessToken({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExpiry) {
      resolve(accessToken);
      return;
    }
    const client = ensureTokenClient();
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

export async function connect() {
  const token = await getAccessToken({ interactive: true });
  localStorage.setItem(LS_CONNECTED, "1");
  return token;
}

export function disconnect() {
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_FOLDER_ID);
  localStorage.removeItem(LS_FILE_ID);
  accessToken = null;
  tokenExpiry = 0;
}

async function driveFetch(url, token, options = {}) {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Google Drive a répondu ${res.status}`);
  return res;
}

async function findFolder(token) {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function createFolder(token) {
  const res = await driveFetch("https://www.googleapis.com/drive/v3/files", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const data = await res.json();
  return data.id;
}

async function getOrCreateFolder(token) {
  let id = localStorage.getItem(LS_FOLDER_ID);
  if (id) return id;
  id = (await findFolder(token)) || (await createFolder(token));
  localStorage.setItem(LS_FOLDER_ID, id);
  return id;
}

async function findFile(token, folderId) {
  const q = encodeURIComponent(`name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, token);
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

// Pousse l'état local vers Google Drive (créé le fichier au premier appel, le met à jour ensuite)
export async function syncUp(jsonString) {
  const token = await getAccessToken({ interactive: false });
  const folderId = await getOrCreateFolder(token);
  let fileId = localStorage.getItem(LS_FILE_ID) || (await findFile(token, folderId));

  const metadata = fileId ? {} : { name: FILE_NAME, parents: [folderId] };
  const boundary = "budgetperso" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonString}\r\n--${boundary}--`;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await driveFetch(url, token, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (data.id) localStorage.setItem(LS_FILE_ID, data.id);
  return data;
}

// Récupère la dernière sauvegarde présente sur Google Drive (action manuelle, jamais automatique
// au chargement — pour ne jamais écraser silencieusement des données locales plus récentes)
export async function syncDown() {
  const token = await getAccessToken({ interactive: false });
  const folderId = await getOrCreateFolder(token);
  const fileId = localStorage.getItem(LS_FILE_ID) || (await findFile(token, folderId));
  if (!fileId) return null;
  localStorage.setItem(LS_FILE_ID, fileId);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, token);
  return await res.text();
}
