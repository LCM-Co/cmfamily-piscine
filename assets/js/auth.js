/* Chan Ming POOL — Auth module (Magic Link Supabase + PIN local AES-GCM)
 *
 * API :
 *   import { signIn, signOut, currentUser, onAuthChange,
 *            hasPin, setPin, unlockWithPin, removePin } from "./auth.js";
 *
 *   await signIn(email)              -> envoie magic link
 *   await signOut()                  -> détruit la session locale
 *   await currentUser()              -> { user } | null
 *   onAuthChange(cb)                 -> cb(event, session)
 *
 *   await hasPin()                   -> bool (refresh_token chiffré présent ?)
 *   await setPin(pin)                -> chiffre la session courante
 *   await unlockWithPin(pin)         -> restaure refresh_token + session
 *   await removePin()                -> efface
 *
 * Stack :
 *   - SDK Supabase chargé depuis CDN (zéro bundling)
 *   - Web Crypto AES-GCM + PBKDF2 100 000 itérations
 *
 * IMPORTANT : la clé anon publique est un placeholder.
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ─────────────────────────────────────────────────────────────────────
// Clés publiques Supabase — safe en clair (RLS protège les données)
// ─────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = "https://dfedxlqcbrhbxrxwspru.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmZWR4bHFjYnJoYnhyeHdzcHJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzcwODIsImV4cCI6MjA5MzA1MzA4Mn0.ksGH-nq3ZGNYtSvHgaxIitVdEy78jCnksT8qHqqo2qI";

let _client = null;

export function client() {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "cmpool.auth.session",
    },
  });
  return _client;
}

// ───────── Public auth API ─────────
export async function signIn(email) {
  const sb = client();
  const redirectTo = `${location.origin}/`;
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = client();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
  await removePin();
  return true;
}

export async function currentUser() {
  const sb = client();
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

export function onAuthChange(callback) {
  const sb = client();
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    try { callback(event, session); } catch (e) { /* swallow */ }
  });
  return () => data?.subscription?.unsubscribe?.();
}

// ─────────────────────────────────────────────────────────────────────
// PIN local : chiffre le refresh_token via PBKDF2 + AES-GCM
// Storage layout (localStorage) :
//   cmpool.pin.salt        : base64 16 bytes
//   cmpool.pin.iv          : base64 12 bytes
//   cmpool.pin.cipher      : base64 (refresh_token chiffré)
//   cmpool.pin.kdf_iter    : nb itérations PBKDF2
//   cmpool.pin.created_at  : ISO date
// ─────────────────────────────────────────────────────────────────────
const PIN_SALT_KEY = "cmpool.pin.salt";
const PIN_IV_KEY = "cmpool.pin.iv";
const PIN_CIPHER_KEY = "cmpool.pin.cipher";
const PIN_ITER_KEY = "cmpool.pin.kdf_iter";
const PIN_META_KEY = "cmpool.pin.created_at";

const PBKDF2_ITER = 100000;

function buf2b64(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}
function b642buf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function deriveKey(pin, salt, iter) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function hasPin() {
  return !!localStorage.getItem(PIN_CIPHER_KEY);
}

export async function setPin(pin) {
  if (typeof pin !== "string" || pin.length < 4) {
    throw new Error("PIN trop court (min 4 caractères).");
  }
  const sb = client();
  const { data: sess } = await sb.auth.getSession();
  const refreshToken = sess?.session?.refresh_token;
  if (!refreshToken) throw new Error("Aucune session active à protéger.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt, PBKDF2_ITER);
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(refreshToken)
  );

  localStorage.setItem(PIN_SALT_KEY, buf2b64(salt));
  localStorage.setItem(PIN_IV_KEY, buf2b64(iv));
  localStorage.setItem(PIN_CIPHER_KEY, buf2b64(cipher));
  localStorage.setItem(PIN_ITER_KEY, String(PBKDF2_ITER));
  localStorage.setItem(PIN_META_KEY, new Date().toISOString());
  return true;
}

export async function unlockWithPin(pin) {
  const saltB64 = localStorage.getItem(PIN_SALT_KEY);
  const ivB64 = localStorage.getItem(PIN_IV_KEY);
  const cipherB64 = localStorage.getItem(PIN_CIPHER_KEY);
  const iter = parseInt(localStorage.getItem(PIN_ITER_KEY) || "0", 10) || PBKDF2_ITER;
  if (!saltB64 || !ivB64 || !cipherB64) throw new Error("Aucun PIN enregistré.");

  const salt = new Uint8Array(b642buf(saltB64));
  const iv = new Uint8Array(b642buf(ivB64));
  const cipher = b642buf(cipherB64);
  const key = await deriveKey(pin, salt, iter);

  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch (e) {
    throw new Error("PIN incorrect.");
  }
  const refreshToken = new TextDecoder().decode(plain);
  const sb = client();
  const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  return data;
}

export async function removePin() {
  localStorage.removeItem(PIN_SALT_KEY);
  localStorage.removeItem(PIN_IV_KEY);
  localStorage.removeItem(PIN_CIPHER_KEY);
  localStorage.removeItem(PIN_ITER_KEY);
  localStorage.removeItem(PIN_META_KEY);
  return true;
}

// Tente une restauration auto via PIN si possible (utilisé par auth-widget)
export async function tryAutoUnlock(promptFn) {
  if (!(await hasPin())) return null;
  const sb = client();
  const { data: sess } = await sb.auth.getSession();
  if (sess?.session) return sess.session; // déjà connecté

  const pin = await promptFn();
  if (!pin) return null;
  try {
    const out = await unlockWithPin(pin);
    return out?.session || null;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}
