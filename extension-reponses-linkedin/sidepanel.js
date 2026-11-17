// Panneau latéral : emplacements, contexte, appel IA, rendu des réponses, copie.
'use strict';

const EMPLACEMENTS = ['post', 'commentaire', 'reponse'];
const CONTEXTES = ['Elliacare', 'OCD', 'IA', 'Autre'];
const LIBELLES_ANGLES = { reflexion: 'Réflexion', point_non_vu: 'Point non vu' };
const LIBELLES_CAS = {
  court: 'Cas détecté : commentaire court ou laudatif, réponse brève.',
  desaccord: 'Cas détecté : désaccord sincère, réponse sans ironie.',
  hostile: 'Cas détecté : commentaire hostile, réponse factuelle et courte.',
  spam: 'Cas détecté : commentaire promotionnel ou spam. Une réponse n\'en vaut peut-être pas la peine.'
};
const DUREE_COCHE_MS = 1200;
const DUREE_ALERTE_CAPTURE_MS = 6000;
const FRAICHEUR_DEMANDE_MS = 15000;

const $ = (selecteur) => document.querySelector(selecteur);

const champs = {
  post: $('#champ-post'),
  commentaire: $('#champ-commentaire'),
  reponse: $('#champ-reponse')
};
const ligneMode = $('#ligne-mode');
const alerteCapture = $('#alerte-capture');
const champPrecision = $('#champ-precision');
const interrupteurLien = $('#lien-elliacare');
const btnGenerer = $('#btn-generer');
const btnRegenerer = $('#btn-regenerer');
const zoneMessage = $('#message');
const zoneResultats = $('#resultats');
const listeVariantes = $('#liste-variantes');
const infoCas = $('#info-cas');
const modeleBloc = $('#modele-bloc');

const etat = {
  contexte: 'Elliacare',
  enCours: false,
  dernieresEntrees: null,
  fenetre: null,
  derniereEcriture: {},
  minuteriesSauvegarde: {},
  minuterieAlerte: null
};

// -----------------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------------

async function initialiser() {
  try {
    const fenetre = await chrome.windows.getCurrent();
    etat.fenetre = fenetre ? fenetre.id : null;
  } catch (e) {
    etat.fenetre = null;
  }

  const session = await chrome.storage.session.get([...EMPLACEMENTS, 'erreurCapture', 'demandeGeneration']);
  for (const cle of EMPLACEMENTS) {
    champs[cle].value = typeof session[cle] === 'string' ? session[cle] : '';
  }

  const local = await chrome.storage.local.get(['contexte', 'precisionContexte', 'lienElliacare']);
  choisirContexte(CONTEXTES.includes(local.contexte) ? local.contexte : 'Elliacare', false);
  champPrecision.value = typeof local.precisionContexte === 'string' ? local.precisionContexte : '';
  interrupteurLien.checked = local.lienElliacare === true;

  majMode();
  afficherRaccourcis();

  if (session.erreurCapture && Date.now() - session.erreurCapture.horodatage < 10000) {
    afficherAlerteCapture(session.erreurCapture.message);
  }
  traiterDemandeGeneration(session.demandeGeneration);

  brancherEvenements();
}

function brancherEvenements() {
  for (const cle of EMPLACEMENTS) {
    champs[cle].addEventListener('input', () => {
      majMode();
      sauvegarderEmplacement(cle);
    });
  }

  document.querySelectorAll('[data-vider]').forEach((bouton) => {
    bouton.addEventListener('click', () => viderEmplacements([bouton.dataset.vider]));
  });
  $('#btn-tout-vider').addEventListener('click', () => viderEmplacements(EMPLACEMENTS));

  document.querySelectorAll('.pastille').forEach((pastille) => {
    pastille.addEventListener('click', () => choisirContexte(pastille.dataset.contexte, true));
  });

  let minuteriePrecision = null;
  champPrecision.addEventListener('input', () => {
    clearTimeout(minuteriePrecision);
    minuteriePrecision = setTimeout(() => {
      chrome.storage.local.set({ precisionContexte: champPrecision.value });
    }, 300);
  });

  interrupteurLien.addEventListener('change', () => {
    chrome.storage.local.set({ lienElliacare: interrupteurLien.checked });
  });

  btnGenerer.addEventListener('click', () => generer());
  btnRegenerer.addEventListener('click', () => generer(etat.dernieresEntrees));
  $('#btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.addEventListener('keydown', gererClavier);
  chrome.storage.onChanged.addListener(gererChangementStockage);
}

// -----------------------------------------------------------------------------
// Emplacements
// -----------------------------------------------------------------------------

function sauvegarderEmplacement(cle) {
  clearTimeout(etat.minuteriesSauvegarde[cle]);
  etat.minuteriesSauvegarde[cle] = setTimeout(() => {
    const valeur = champs[cle].value;
    etat.derniereEcriture[cle] = valeur;
    chrome.storage.session.set({ [cle]: valeur });
  }, 250);
}

function viderEmplacements(cles) {
  const changements = {};
  for (const cle of cles) {
    clearTimeout(etat.minuteriesSauvegarde[cle]);
    champs[cle].value = '';
    etat.derniereEcriture[cle] = '';
    changements[cle] = '';
  }
  chrome.storage.session.set(changements);
  majMode();
  masquerMessage();
}

function majMode() {
  const resultat = IA.determinerMode(champs.post.value, champs.commentaire.value, champs.reponse.value);
  ligneMode.textContent = resultat.libelle;
  ligneMode.classList.toggle('invalide', !resultat.valide && resultat.mode === null && resultat.libelle.includes('invalide'));
  for (const cle of EMPLACEMENTS) {
    champs[cle].closest('.emplacement').classList.toggle('rempli', champs[cle].value.trim() !== '');
  }
  return resultat;
}

function gererChangementStockage(changements, zone) {
  if (zone === 'session') {
    for (const cle of EMPLACEMENTS) {
      if (!(cle in changements)) continue;
      const nouvelle = typeof changements[cle].newValue === 'string' ? changements[cle].newValue : '';
      // Ignore l'écho de nos propres sauvegardes pour ne pas écraser une saisie en cours.
      if (nouvelle === etat.derniereEcriture[cle]) continue;
      if (nouvelle !== champs[cle].value) {
        clearTimeout(etat.minuteriesSauvegarde[cle]);
        champs[cle].value = nouvelle;
        etat.derniereEcriture[cle] = nouvelle;
        if (nouvelle) clignoter(cle);
      }
    }
    majMode();

    if (changements.erreurCapture && changements.erreurCapture.newValue) {
      afficherAlerteCapture(changements.erreurCapture.newValue.message);
    } else if (changements.derniereCapture && changements.derniereCapture.newValue) {
      masquerAlerteCapture();
    }
    if (changements.demandeGeneration) {
      traiterDemandeGeneration(changements.demandeGeneration.newValue);
    }
  }
}

function clignoter(cle) {
  const bloc = champs[cle].closest('.emplacement');
  bloc.classList.remove('flash');
  void bloc.offsetWidth;
  bloc.classList.add('flash');
}

function afficherAlerteCapture(message) {
  alerteCapture.textContent = message;
  alerteCapture.hidden = false;
  clearTimeout(etat.minuterieAlerte);
  etat.minuterieAlerte = setTimeout(masquerAlerteCapture, DUREE_ALERTE_CAPTURE_MS);
}

function masquerAlerteCapture() {
  alerteCapture.hidden = true;
}

// Demande envoyée par le raccourci Alt+Shift+G (via le service worker).
function traiterDemandeGeneration(demande) {
  if (!demande || typeof demande.horodatage !== 'number') return;
  if (Date.now() - demande.horodatage > FRAICHEUR_DEMANDE_MS) return;
  if (demande.fenetre !== null && etat.fenetre !== null && demande.fenetre !== etat.fenetre) return;
  chrome.storage.session.remove('demandeGeneration');
  generer();
}

// -----------------------------------------------------------------------------
// Contexte
// -----------------------------------------------------------------------------

function choisirContexte(contexte, memoriser) {
  etat.contexte = contexte;
  document.querySelectorAll('.pastille').forEach((pastille) => {
    pastille.setAttribute('aria-pressed', String(pastille.dataset.contexte === contexte));
  });
  champPrecision.hidden = contexte !== 'Autre';
  if (memoriser) chrome.storage.local.set({ contexte });
}

// -----------------------------------------------------------------------------
// Raccourcis affichés (reflètent un éventuel remappage)
// -----------------------------------------------------------------------------

async function afficherRaccourcis() {
  try {
    const commandes = await chrome.commands.getAll();
    const parNom = {};
    for (const commande of commandes) parNom[commande.name] = commande.shortcut || '';
    document.querySelectorAll('[data-commande]').forEach((element) => {
      const raccourci = parNom[element.dataset.commande];
      if (raccourci === undefined) return;
      element.textContent = raccourci || 'non défini';
      element.title = raccourci ? 'Raccourci actuel' : 'Raccourci non défini : voir chrome://extensions/shortcuts';
    });
  } catch (e) {
    // Valeurs par défaut conservées.
  }
}

// -----------------------------------------------------------------------------
// Clavier : Entrée lance la génération
// -----------------------------------------------------------------------------

function gererClavier(evenement) {
  if (evenement.key !== 'Enter' || evenement.isComposing || evenement.shiftKey || evenement.altKey) return;
  const cible = evenement.target;
  const balise = cible && cible.tagName ? cible.tagName : '';
  if (balise === 'TEXTAREA') {
    // Dans une zone de texte, Entrée garde son rôle : Ctrl+Entrée (ou Cmd+Entrée) génère.
    if (evenement.ctrlKey || evenement.metaKey) {
      evenement.preventDefault();
      generer();
    }
    return;
  }
  if (balise === 'BUTTON' || balise === 'A') return;
  evenement.preventDefault();
  generer();
}

// -----------------------------------------------------------------------------
// Génération
// -----------------------------------------------------------------------------

function lireEntrees() {
  return {
    post: champs.post.value,
    commentaire: champs.commentaire.value,
    reponse: champs.reponse.value,
    contexte: etat.contexte,
    precision: etat.contexte === 'Autre' ? champPrecision.value : '',
    lienElliacare: interrupteurLien.checked
  };
}

function definirEnCours(enCours) {
  etat.enCours = enCours;
  btnGenerer.disabled = enCours;
  btnRegenerer.disabled = enCours;
  btnGenerer.classList.toggle('en-cours', enCours);
  btnGenerer.querySelector('.btn-libelle').textContent = enCours ? 'Génération…' : 'Générer';
  btnGenerer.setAttribute('aria-busy', String(enCours));
}

async function generer(entreesForcees) {
  if (etat.enCours) return;
  const entrees = Object.assign({}, entreesForcees || lireEntrees());
  const analyse = IA.determinerMode(entrees.post, entrees.commentaire, entrees.reponse);
  if (!analyse.valide) {
    afficherMessage(analyse.message);
    return;
  }
  entrees.mode = analyse.mode;

  const configuration = await IA.lireConfiguration();
  if (!configuration.proxyUrl && !configuration.cleApi) {
    afficherMessage('Aucune clé API enregistrée. Saisissez-la dans les options de l\'extension.', { lienOptions: true });
    return;
  }

  etat.dernieresEntrees = entrees;
  masquerMessage();
  definirEnCours(true);

  try {
    const systeme = await IA.construireSysteme(entrees.contexte, entrees.lienElliacare);
    const messageUtilisateur = IA.construireMessageUtilisateur(entrees);

    let reponse = await IA.appelerIA(
      IA.construireCorps({ systeme, messageUtilisateur, modele: configuration.modele }),
      configuration
    );
    let resultat = IA.normaliserResultat(IA.analyserJson(reponse.texte));

    if (!resultat) {
      // Une seule relance, avec la consigne de format.
      reponse = await IA.appelerIA(
        IA.construireCorps({
          systeme,
          messageUtilisateur: messageUtilisateur + '\n\nRéponds uniquement avec le JSON demandé, sans aucun texte autour.',
          modele: configuration.modele
        }),
        configuration
      );
      resultat = IA.normaliserResultat(IA.analyserJson(reponse.texte));
    }

    if (resultat) {
      afficherResultats(resultat);
    } else {
      afficherBrut(reponse.texte);
      afficherMessage(
        reponse.tronque
          ? 'Réponse tronquée et hors format : texte brut affiché tel quel. Régénérez si besoin.'
          : 'Réponse hors format : texte brut affiché tel quel.',
        { discret: true }
      );
    }
  } catch (erreur) {
    const message = erreur && erreur.name === 'ErreurIA' ? erreur.message : 'Erreur inattendue. Réessayez.';
    afficherMessage(message, { lienOptions: erreur && ['cle_absente', 'cle_refusee', 'modele', 'proxy'].includes(erreur.code) });
  } finally {
    definirEnCours(false);
  }
}

// -----------------------------------------------------------------------------
// Rendu
// -----------------------------------------------------------------------------

function creerBloc({ etiquette, texte, fautes, classe }) {
  const fragment = modeleBloc.content.cloneNode(true);
  const article = fragment.querySelector('.variante');
  if (classe) article.classList.add(classe);
  article.querySelector('.etiquette').textContent = etiquette;
  const elementTexte = article.querySelector('.variante-texte');
  elementTexte.textContent = texte;

  const bouton = article.querySelector('.btn-copier');
  bouton.addEventListener('click', () => copier(bouton, texte, elementTexte));

  if (Array.isArray(fautes)) {
    const ligne = article.querySelector('.fautes');
    ligne.textContent = 'Fautes volontaires : ' + (fautes.length ? fautes.join(', ') : 'aucune signalée');
    ligne.hidden = false;
  }

  const proscrites = IA.expressionsProscrites(texte);
  if (proscrites.length) {
    const avertissement = article.querySelector('.avertissement');
    avertissement.textContent = 'À relire : contient « ' + proscrites.join(' », « ') + ' ».';
    avertissement.hidden = false;
  }
  return article;
}

function afficherResultats(resultat) {
  listeVariantes.replaceChildren();
  for (const variante of resultat.variantes) {
    listeVariantes.appendChild(creerBloc({
      etiquette: LIBELLES_ANGLES[variante.angle] || variante.angle,
      texte: variante.texte,
      fautes: variante.fautes
    }));
  }
  if (resultat.suggestion) {
    listeVariantes.appendChild(creerBloc({
      etiquette: 'Placement Elliacare (optionnel)',
      texte: resultat.suggestion,
      classe: 'suggestion'
    }));
  }
  const libelleCas = LIBELLES_CAS[resultat.cas];
  infoCas.textContent = libelleCas || '';
  infoCas.hidden = !libelleCas;
  zoneResultats.hidden = false;
}

function afficherBrut(texte) {
  listeVariantes.replaceChildren(creerBloc({
    etiquette: 'Texte brut reçu',
    texte: IA.nettoyerTexte(texte || '(réponse vide)'),
    classe: 'brut'
  }));
  infoCas.hidden = true;
  zoneResultats.hidden = false;
}

function afficherMessage(texte, options) {
  const opts = options || {};
  zoneMessage.replaceChildren(document.createTextNode(texte));
  zoneMessage.classList.toggle('discret', !!opts.discret);
  if (opts.lienOptions) {
    const lien = document.createElement('button');
    lien.type = 'button';
    lien.className = 'btn-secondaire';
    lien.style.marginLeft = '8px';
    lien.textContent = 'Ouvrir les options';
    lien.addEventListener('click', () => chrome.runtime.openOptionsPage());
    zoneMessage.appendChild(lien);
  }
  zoneMessage.hidden = false;
}

function masquerMessage() {
  zoneMessage.hidden = true;
  zoneMessage.replaceChildren();
}

// -----------------------------------------------------------------------------
// Copie
// -----------------------------------------------------------------------------

async function copier(bouton, texte, elementTexte) {
  let reussi = false;
  try {
    await navigator.clipboard.writeText(texte);
    reussi = true;
  } catch (e) {
    reussi = copieDeSecours(texte);
  }

  if (!reussi) {
    selectionnerTexte(elementTexte);
    afficherMessage('Copie impossible. Le texte est sélectionné : copiez-le à la main avec Ctrl+C (Cmd+C sur Mac).');
    return;
  }

  bouton.classList.add('copie');
  bouton.setAttribute('aria-label', 'Copié');
  bouton.title = 'Copié';
  clearTimeout(bouton._minuterie);
  bouton._minuterie = setTimeout(() => {
    bouton.classList.remove('copie');
    bouton.setAttribute('aria-label', 'Copier');
    bouton.title = 'Copier';
  }, DUREE_COCHE_MS);
}

function copieDeSecours(texte) {
  const zone = document.createElement('textarea');
  zone.value = texte;
  zone.setAttribute('readonly', '');
  zone.style.position = 'fixed';
  zone.style.opacity = '0';
  document.body.appendChild(zone);
  zone.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  zone.remove();
  return ok;
}

function selectionnerTexte(element) {
  const plage = document.createRange();
  plage.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(plage);
}

initialiser();
