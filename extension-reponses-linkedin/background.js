// Service worker de l'extension "Réponses LinkedIn".
// Rôle : raccourcis clavier, capture de la sélection, badge, ouverture du panneau latéral.
// La seule action sur la page : lire la sélection de texte au moment du raccourci.

const COMMANDES_CAPTURE = {
  'capture-post': 'post',
  'capture-commentaire': 'commentaire',
  'capture-reponse': 'reponse'
};
const EMPLACEMENTS = ['post', 'commentaire', 'reponse'];
const LETTRES = { post: 'P', commentaire: 'C', reponse: 'R' };
const NOMS = { post: 'Post', commentaire: 'Commentaire', reponse: 'Réponse' };

const COULEUR_BADGE = '#0a66c2';
const COULEUR_ALERTE = '#c62828';
const DUREE_ALERTE_MS = 2000;

let minuterieAlerte = null;

// Un clic sur l'icône de l'extension ouvre aussi le panneau.
function configurerPanneau() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configurerPanneau();
  majBadge();
});

chrome.runtime.onStartup.addListener(() => {
  configurerPanneau();
  majBadge();
});

chrome.commands.onCommand.addListener((commande, onglet) => {
  gererCommande(commande, onglet);
});

// Le badge suit les emplacements, y compris quand le panneau les modifie ou les vide.
chrome.storage.onChanged.addListener((changements, zone) => {
  if (zone !== 'session') return;
  if (EMPLACEMENTS.some((cle) => cle in changements) && !minuterieAlerte) {
    majBadge();
  }
});

/**
 * Ouvre le panneau latéral. Doit être appelé tout de suite dans le gestionnaire
 * de commande, avant le moindre await, sinon Chrome considère que le geste
 * utilisateur (le raccourci) est perdu.
 */
function ouvrirPanneau(onglet) {
  try {
    if (onglet && typeof onglet.windowId === 'number') {
      return chrome.sidePanel.open({ windowId: onglet.windowId }).catch(() => {});
    }
  } catch (e) {
    // Panneau indisponible : la capture continue malgré tout.
  }
  return Promise.resolve();
}

async function ongletActif(onglet) {
  if (onglet && typeof onglet.id === 'number') return onglet;
  const [actif] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return actif || null;
}

async function gererCommande(commande, ongletRecu) {
  const ouverture = ouvrirPanneau(ongletRecu);
  const onglet = await ongletActif(ongletRecu);
  if (!ongletRecu && onglet) {
    // Cas rare où Chrome ne fournit pas l'onglet : tentative d'ouverture tardive.
    ouvrirPanneau(onglet);
  }

  if (commande === 'generer') {
    await ouverture;
    await chrome.storage.session.set({
      demandeGeneration: {
        horodatage: Date.now(),
        fenetre: onglet ? onglet.windowId : null
      }
    });
    return;
  }

  const emplacement = COMMANDES_CAPTURE[commande];
  if (!emplacement) return;

  const resultat = await lireSelection(onglet);
  if (!resultat.texte) {
    const message = resultat.inaccessible
      ? 'Capture impossible sur cette page (page système ou protégée). Rien n\'a été modifié.'
      : 'Sélection vide : sélectionnez d\'abord un texte, puis relancez le raccourci. « ' + NOMS[emplacement] + ' » n\'a pas été modifié.';
    await chrome.storage.session.set({
      erreurCapture: { message, emplacement, horodatage: Date.now() }
    });
    signalerAlerte();
    return;
  }

  await chrome.storage.session.set({
    [emplacement]: resultat.texte,
    erreurCapture: null,
    derniereCapture: { emplacement, horodatage: Date.now() }
  });
  await majBadge();
}

/**
 * Lit la sélection de l'onglet actif, dans tous les cadres accessibles.
 * S'appuie sur la permission activeTab accordée par le raccourci clavier.
 * Renvoie { texte, inaccessible }.
 */
async function lireSelection(onglet) {
  if (!onglet || typeof onglet.id !== 'number') {
    return { texte: '', inaccessible: true };
  }
  const executer = (tousLesCadres) => chrome.scripting.executeScript({
    target: { tabId: onglet.id, allFrames: tousLesCadres },
    func: extraireSelection
  });

  let resultats;
  try {
    resultats = await executer(true);
  } catch (e) {
    try {
      resultats = await executer(false);
    } catch (e2) {
      return { texte: '', inaccessible: true };
    }
  }

  for (const resultat of resultats || []) {
    const valeur = resultat && typeof resultat.result === 'string' ? resultat.result.trim() : '';
    if (valeur) return { texte: valeur, inaccessible: false };
  }
  return { texte: '', inaccessible: false };
}

// Exécutée dans la page : renvoie uniquement le texte sélectionné, sans rien modifier.
function extraireSelection() {
  const element = document.activeElement;
  if (element && (element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && /^(text|search)$/i.test(element.type || '')))) {
    const debut = element.selectionStart;
    const fin = element.selectionEnd;
    if (typeof debut === 'number' && typeof fin === 'number' && fin > debut) {
      return element.value.substring(debut, fin);
    }
  }
  const selection = window.getSelection ? window.getSelection() : null;
  return selection ? selection.toString() : '';
}

async function majBadge() {
  const valeurs = await chrome.storage.session.get(EMPLACEMENTS);
  const texte = EMPLACEMENTS
    .filter((cle) => typeof valeurs[cle] === 'string' && valeurs[cle].trim() !== '')
    .map((cle) => LETTRES[cle])
    .join('');
  await chrome.action.setBadgeBackgroundColor({ color: COULEUR_BADGE });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
  await chrome.action.setBadgeText({ text: texte });
}

// Badge "!" pendant 2 secondes, puis retour à l'état des emplacements.
function signalerAlerte() {
  if (minuterieAlerte) clearTimeout(minuterieAlerte);
  chrome.action.setBadgeBackgroundColor({ color: COULEUR_ALERTE });
  chrome.action.setBadgeText({ text: '!' });
  minuterieAlerte = setTimeout(() => {
    minuterieAlerte = null;
    majBadge();
  }, DUREE_ALERTE_MS);
}

// Exposé pour les tests automatisés (aucun effet en usage normal).
self.gererCommande = gererCommande;
