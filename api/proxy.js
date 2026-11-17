// Proxy optionnel (version 2 de l'appel IA) : la clé API reste côté serveur.
// Point d'accès : POST /api/proxy
// Corps attendu : { system, messages, model, max_tokens } (+ thinking, output_config, fallbacks facultatifs)
// En-tête attendu : Authorization: Bearer <PROXY_TOKEN>
//
// Variables d'environnement Vercel (inactif tant qu'elles ne sont pas définies) :
//   ANTHROPIC_API_KEY  clé API Anthropic
//   PROXY_TOKEN        jeton partagé avec l'extension (au moins 24 caractères)

import { createHash, timingSafeEqual } from 'node:crypto';

const POINT_ACCES = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';
const BETA_REPLI = 'server-side-fallback-2026-07-01';
const MODELE_PAR_DEFAUT = 'claude-sonnet-5-5';
const MAX_TOKENS_PLAFOND = 2000;
const TAILLE_MAX_OCTETS = 100_000;
const DELAI_MS = 28_000;

function entetesCors(origine) {
  const entetes = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'origin'
  };
  // Seules les extensions Chrome sont acceptées en appel navigateur.
  if (origine && origine.startsWith('chrome-extension://')) {
    entetes['access-control-allow-origin'] = origine;
  }
  return entetes;
}

function json(statut, objet, cors) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function erreur(statut, message, cors) {
  return json(statut, { type: 'error', error: { type: 'proxy_error', message } }, cors);
}

function jetonValide(entete, attendu) {
  const recu = (entete || '').replace(/^Bearer\s+/i, '');
  const a = createHash('sha256').update(recu).digest();
  const b = createHash('sha256').update(attendu).digest();
  return recu.length > 0 && timingSafeEqual(a, b);
}

function messagesValides(messages) {
  return Array.isArray(messages)
    && messages.length > 0
    && messages.length <= 6
    && messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)));
}

export async function traiter(requete, env = process.env) {
  const cors = entetesCors(requete.headers.get('origin'));

  if (requete.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (requete.method !== 'POST') {
    return erreur(405, 'Méthode non autorisée : utilisez POST.', cors);
  }

  const cle = env.ANTHROPIC_API_KEY;
  const jeton = env.PROXY_TOKEN;
  if (!cle || !jeton || jeton.length < 24) {
    return erreur(503, 'Proxy non configuré : définissez ANTHROPIC_API_KEY et PROXY_TOKEN (24 caractères minimum) dans Vercel.', cors);
  }
  if (!jetonValide(requete.headers.get('authorization'), jeton)) {
    return erreur(401, 'Jeton d\'accès invalide.', cors);
  }

  const brut = await requete.text();
  if (Buffer.byteLength(brut, 'utf8') > TAILLE_MAX_OCTETS) {
    return erreur(413, 'Requête trop volumineuse.', cors);
  }
  let corps;
  try {
    corps = JSON.parse(brut);
  } catch {
    return erreur(400, 'Corps JSON invalide.', cors);
  }
  if (!corps || !messagesValides(corps.messages)) {
    return erreur(400, 'Champ "messages" absent ou invalide.', cors);
  }

  const modele = typeof corps.model === 'string' && /^claude-[a-z0-9.-]+$/.test(corps.model) ? corps.model : MODELE_PAR_DEFAUT;
  const maxTokens = Math.min(Math.max(parseInt(corps.max_tokens, 10) || 900, 1), MAX_TOKENS_PLAFOND);

  const charge = { model: modele, max_tokens: maxTokens, messages: corps.messages };
  if (typeof corps.system === 'string' || Array.isArray(corps.system)) charge.system = corps.system;
  if (corps.thinking && typeof corps.thinking === 'object') charge.thinking = corps.thinking;
  if (corps.output_config && typeof corps.output_config === 'object') charge.output_config = corps.output_config;
  if (corps.fallbacks === 'default') charge.fallbacks = 'default';

  const entetes = {
    'x-api-key': cle,
    'anthropic-version': VERSION_API,
    'content-type': 'application/json'
  };
  if (charge.fallbacks) entetes['anthropic-beta'] = BETA_REPLI;

  let reponse;
  try {
    reponse = await fetch(POINT_ACCES, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify(charge),
      signal: AbortSignal.timeout(DELAI_MS)
    });
  } catch (e) {
    const delai = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return erreur(delai ? 504 : 502, delai ? 'Délai dépassé côté proxy.' : 'Service IA injoignable depuis le proxy.', cors);
  }

  const texte = await reponse.text();
  const sortie = { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const attente = reponse.headers.get('retry-after');
  if (attente) sortie['retry-after'] = attente;
  return new Response(texte, { status: reponse.status, headers: sortie });
}

export default {
  fetch(requete) {
    return traiter(requete);
  }
};
