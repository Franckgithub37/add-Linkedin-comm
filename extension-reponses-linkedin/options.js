// Page d'options : clé API, modèle, proxy, rappel des raccourcis.
// La clé API et le jeton ne sont jamais réaffichés ni journalisés.
'use strict';

const $ = (selecteur) => document.querySelector(selecteur);

const MODELES_PROPOSES = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
const NOMS_COMMANDES = {
  'capture-post': 'Capturer dans « Post »',
  'capture-commentaire': 'Capturer dans « Commentaire »',
  'capture-reponse': 'Capturer dans « Réponse »',
  generer: 'Générer'
};

function afficherEtat(element, texte, type) {
  element.textContent = texte;
  element.classList.remove('ok', 'erreur');
  if (type) element.classList.add(type);
}

// -----------------------------------------------------------------------------
// Clé API
// -----------------------------------------------------------------------------

async function majEtatCle() {
  const { cleApi } = await chrome.storage.local.get('cleApi');
  $('#etat-cle-enregistree').textContent = cleApi
    ? 'Une clé est enregistrée (masquée). Saisissez-en une nouvelle pour la remplacer.'
    : 'Aucune clé enregistrée.';
  $('#btn-supprimer-cle').disabled = !cleApi;
}

async function enregistrerCle() {
  const champ = $('#cle-api');
  const etat = $('#etat-cle');
  const valeur = champ.value.trim();
  if (!valeur) {
    afficherEtat(etat, 'Saisissez une clé avant d\'enregistrer.', 'erreur');
    return;
  }
  await chrome.storage.local.set({ cleApi: valeur });
  champ.value = '';
  await majEtatCle();
  const avertissement = valeur.startsWith('sk-ant-') ? '' : ' Attention : une clé Anthropic commence normalement par "sk-ant-".';
  afficherEtat(etat, 'Clé enregistrée.' + avertissement, avertissement ? 'erreur' : 'ok');
}

async function supprimerCle() {
  await chrome.storage.local.remove('cleApi');
  $('#cle-api').value = '';
  await majEtatCle();
  afficherEtat($('#etat-cle'), 'Clé supprimée.', 'ok');
}

async function modeleCourant() {
  const configuration = await IA.lireConfiguration();
  return configuration.modele;
}

function corpsDeTest(modele) {
  const corps = IA.construireCorps({
    systeme: 'Tu réponds uniquement par le mot OK.',
    messageUtilisateur: 'Test de connexion.',
    modele
  });
  corps.max_tokens = 16;
  return corps;
}

async function testerCle() {
  const etat = $('#etat-cle');
  const bouton = $('#btn-tester-cle');
  const saisie = $('#cle-api').value.trim();
  const { cleApi } = await chrome.storage.local.get('cleApi');
  const cle = saisie || cleApi || '';
  if (!cle) {
    afficherEtat(etat, 'Aucune clé à tester : saisissez-en une ou enregistrez-la d\'abord.', 'erreur');
    return;
  }
  const modele = await modeleCourant();
  bouton.disabled = true;
  afficherEtat(etat, 'Test en cours…');
  try {
    await IA.appelerIA(corpsDeTest(modele), { cleApi: cle, modele, proxyUrl: '', proxyJeton: '' });
    afficherEtat(etat, 'OK : la clé fonctionne avec le modèle ' + modele + '.', 'ok');
  } catch (erreur) {
    afficherEtat(etat, erreur && erreur.name === 'ErreurIA' ? erreur.message : 'Échec du test.', 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Modèle
// -----------------------------------------------------------------------------

async function chargerModele() {
  const { modele } = await chrome.storage.local.get('modele');
  const valeur = (typeof modele === 'string' && modele.trim()) ? modele.trim() : IA.MODELE_PAR_DEFAUT;
  if (MODELES_PROPOSES.includes(valeur)) {
    $('#choix-modele').value = valeur;
    $('#modele-libre').value = '';
  } else {
    $('#choix-modele').value = 'autre';
    $('#modele-libre').value = valeur;
  }
  majBlocModeleLibre();
}

function majBlocModeleLibre() {
  $('#bloc-modele-libre').hidden = $('#choix-modele').value !== 'autre';
}

async function enregistrerModele() {
  const etat = $('#etat-modele');
  let modele = $('#choix-modele').value;
  if (modele === 'autre') {
    modele = $('#modele-libre').value.trim();
    if (!/^[A-Za-z0-9._:@/-]+$/.test(modele)) {
      afficherEtat(etat, 'Nom de modèle invalide (lettres, chiffres, tirets courts, points).', 'erreur');
      return;
    }
  }
  await chrome.storage.local.set({ modele });
  afficherEtat(etat, 'Modèle enregistré : ' + modele + '.', 'ok');
}

// -----------------------------------------------------------------------------
// Proxy
// -----------------------------------------------------------------------------

/** Motif d'autorisation Chrome pour l'origine du proxy, ou exception si l'URL ne convient pas. */
function motifOrigine(url) {
  const u = new URL(url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    throw new Error('protocole');
  }
  return u.protocol + '//' + u.hostname + '/*';
}

async function majEtatJeton() {
  const { proxyJeton } = await chrome.storage.local.get('proxyJeton');
  $('#etat-jeton-enregistre').textContent = proxyJeton
    ? 'Un jeton est enregistré (masqué). Laissez le champ vide pour le conserver.'
    : 'Aucun jeton enregistré.';
}

async function chargerProxy() {
  const { proxyUrl } = await chrome.storage.local.get('proxyUrl');
  $('#proxy-url').value = typeof proxyUrl === 'string' ? proxyUrl : '';
  await majEtatJeton();
}

// Le clic doit déclencher la demande d'autorisation immédiatement (geste utilisateur).
function surEnregistrerProxy() {
  const etat = $('#etat-proxy');
  const url = $('#proxy-url').value.trim();
  const jeton = $('#proxy-jeton').value;

  if (!url) {
    finaliserProxy('', jeton, Promise.resolve(true));
    return;
  }
  let motif;
  try {
    motif = motifOrigine(url);
  } catch (e) {
    afficherEtat(etat, 'URL invalide : utilisez une adresse https:// (ou http://localhost pour un test local).', 'erreur');
    return;
  }
  const demande = chrome.permissions.request({ origins: [motif] }).catch(() => false);
  finaliserProxy(url, jeton, demande);
}

async function finaliserProxy(url, jeton, demandeAutorisation) {
  const etat = $('#etat-proxy');
  const accorde = await demandeAutorisation;
  const changements = { proxyUrl: url };
  if (jeton) changements.proxyJeton = jeton;
  await chrome.storage.local.set(changements);
  $('#proxy-jeton').value = '';
  await majEtatJeton();
  if (!url) {
    afficherEtat(etat, 'Proxy désactivé : appel direct à l\'API Anthropic.', 'ok');
  } else if (accorde) {
    afficherEtat(etat, 'Proxy enregistré. Les prochaines générations passeront par ' + url + '.', 'ok');
  } else {
    afficherEtat(etat, 'Proxy enregistré, mais l\'autorisation d\'accès a été refusée. L\'appel ne fonctionnera que si le proxy accepte les requêtes de l\'extension (CORS).', 'erreur');
  }
}

async function effacerProxy() {
  await chrome.storage.local.remove(['proxyUrl', 'proxyJeton']);
  $('#proxy-url').value = '';
  $('#proxy-jeton').value = '';
  await majEtatJeton();
  afficherEtat($('#etat-proxy'), 'Proxy désactivé et jeton supprimé : appel direct à l\'API Anthropic.', 'ok');
}

async function testerProxy() {
  const etat = $('#etat-proxy');
  const bouton = $('#btn-tester-proxy');
  const url = $('#proxy-url').value.trim();
  const { proxyUrl, proxyJeton } = await chrome.storage.local.get(['proxyUrl', 'proxyJeton']);
  const cible = url || proxyUrl || '';
  const jeton = $('#proxy-jeton').value || proxyJeton || '';
  if (!cible) {
    afficherEtat(etat, 'Aucune URL de proxy à tester.', 'erreur');
    return;
  }
  const modele = await modeleCourant();
  bouton.disabled = true;
  afficherEtat(etat, 'Test en cours…');
  try {
    await IA.appelerIA(corpsDeTest(modele), { cleApi: '', modele, proxyUrl: cible, proxyJeton: jeton });
    afficherEtat(etat, 'OK : le proxy répond.', 'ok');
  } catch (erreur) {
    afficherEtat(etat, erreur && erreur.name === 'ErreurIA' ? erreur.message : 'Échec du test.', 'erreur');
  } finally {
    bouton.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Raccourcis
// -----------------------------------------------------------------------------

async function chargerRaccourcis() {
  try {
    const commandes = await chrome.commands.getAll();
    const corps = $('#liste-raccourcis');
    corps.replaceChildren();
    for (const nom of Object.keys(NOMS_COMMANDES)) {
      const commande = commandes.find((c) => c.name === nom);
      const ligne = document.createElement('tr');
      const action = document.createElement('td');
      action.textContent = NOMS_COMMANDES[nom];
      const cellule = document.createElement('td');
      const touche = document.createElement('kbd');
      touche.textContent = commande && commande.shortcut ? commande.shortcut : 'non défini';
      cellule.appendChild(touche);
      ligne.append(action, cellule);
      corps.appendChild(ligne);
    }
  } catch (e) {
    // Tableau par défaut conservé.
  }
}

// -----------------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------------

$('#btn-enregistrer-cle').addEventListener('click', enregistrerCle);
$('#btn-tester-cle').addEventListener('click', testerCle);
$('#btn-supprimer-cle').addEventListener('click', supprimerCle);
$('#cle-api').addEventListener('keydown', (e) => { if (e.key === 'Enter') enregistrerCle(); });
$('#choix-modele').addEventListener('change', majBlocModeleLibre);
$('#btn-enregistrer-modele').addEventListener('click', enregistrerModele);
$('#btn-enregistrer-proxy').addEventListener('click', surEnregistrerProxy);
$('#btn-tester-proxy').addEventListener('click', testerProxy);
$('#btn-effacer-proxy').addEventListener('click', effacerProxy);
$('#btn-raccourcis').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

majEtatCle();
chargerModele();
chargerProxy();
chargerRaccourcis();
