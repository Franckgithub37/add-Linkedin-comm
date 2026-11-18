// Fonctions partagées par le panneau latéral et la page d'options :
// appel IA (direct ou via proxy), messages d'erreur, lecture du JSON, nettoyage du texte.
// Aucune donnée n'est journalisée, et la clé API n'apparaît jamais dans un message.

(function (racine) {
  'use strict';

  const POINT_ACCES_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
  const VERSION_API = '2023-06-01';
  const MODELE_PAR_DEFAUT = 'claude-sonnet-5-5';
  // Quatre commentaires + une ligne d'humour + les listes de fautes tiennent largement.
  const MAX_TOKENS = 1600;
  const DELAI_MAX_MS = 30000;
  const BETA_REPLI = 'server-side-fallback-2026-07-01';

  const MODES = {
    commentaire_sur_post: 'commentaire sur un post',
    reponse_a_commentaire: 'réponse à un commentaire',
    reponse_a_reponse: 'réponse à une réponse',
    reponse_sans_contexte: 'réponse à un commentaire, sans le post'
  };

  // Formats proposés. maxMotsPhrase : longueur maximale d'une phrase (pas de grandes phrases).
  const LONGUEURS = {
    flash: { libelle: 'Flash', lignes: 1, maxCaracteres: 90, maxMotsPhrase: 10 },
    court: { libelle: 'Court', lignes: 2, maxCaracteres: 170, maxMotsPhrase: 12 },
    standard: { libelle: 'Standard', lignes: 3, maxCaracteres: 250, maxMotsPhrase: 12 }
  };
  const LONGUEUR_PAR_DEFAUT = 'standard';
  const IRONIE_PAR_DEFAUT = 1;
  const HUMOUR_MAX_CARACTERES = 100;
  // Fautes volontaires : deux par défaut, trois en option, quelle que soit la longueur.
  const FAUTES_PAR_DEFAUT = 2;
  // Tolérance avant de demander une réécriture (le modèle compte mal les mots).
  const TOLERANCE_MOTS = 3;

  // Façons d'ouvrir un commentaire (décrites dans le prompt système).
  // Un tirage au sort à chaque génération évite que les réponses se ressemblent toutes.
  const ATTAQUES = [
    'prise de position',
    'antithese seche',
    'aveu',
    'question',
    'retournement',
    'image de terrain',
    'chute',
    'desaccord poli'
  ];
  const EMPLACEMENTS_VARIANTES = ['reflexion 1', 'reflexion 2', 'point_non_vu 1', 'point_non_vu 2'];

  function normaliserLongueur(longueur) {
    return Object.prototype.hasOwnProperty.call(LONGUEURS, longueur) ? longueur : LONGUEUR_PAR_DEFAUT;
  }

  function normaliserFautes(fautes) {
    return Number(fautes) === 3 ? 3 : FAUTES_PAR_DEFAUT;
  }

  function normaliserIronie(ironie) {
    const n = Number(ironie);
    return n === 0 || n === 1 || n === 2 ? n : IRONIE_PAR_DEFAUT;
  }

  /** Tire quatre attaques différentes au hasard, une par commentaire. */
  function tirerAttaques(aleatoire) {
    const hasard = typeof aleatoire === 'function' ? aleatoire : Math.random;
    const melange = ATTAQUES.slice();
    for (let i = melange.length - 1; i > 0; i--) {
      const j = Math.floor(hasard() * (i + 1));
      [melange[i], melange[j]] = [melange[j], melange[i]];
    }
    return melange.slice(0, EMPLACEMENTS_VARIANTES.length);
  }

  /** Erreur affichable telle quelle dans l'interface (message court en français). */
  class ErreurIA extends Error {
    constructor(message, code, details) {
      super(message);
      this.name = 'ErreurIA';
      this.code = code || 'inconnue';
      this.details = details || null;
    }
  }

  // ---------------------------------------------------------------------------
  // Mode déduit des emplacements remplis
  // ---------------------------------------------------------------------------

  function rempli(valeur) {
    return typeof valeur === 'string' && valeur.trim() !== '';
  }

  /**
   * Renvoie { mode, libelle, valide, message }.
   * mode vaut null si aucun emplacement n'est rempli ou si la combinaison est invalide.
   */
  function determinerMode(post, commentaire, reponse) {
    const p = rempli(post);
    const c = rempli(commentaire);
    const r = rempli(reponse);

    if (!p && !c && !r) {
      return {
        mode: null,
        valide: false,
        libelle: 'Mode : aucun texte capturé',
        message: 'Aucun emplacement rempli. Sélectionnez un texte sur LinkedIn puis Alt+Shift+1 (Post) ou Alt+Shift+2 (Commentaire).'
      };
    }
    let mode = null;
    if (p && !c && !r) mode = 'commentaire_sur_post';
    else if (p && c && !r) mode = 'reponse_a_commentaire';
    else if (p && c && r) mode = 'reponse_a_reponse';
    else if (!p && c && !r) mode = 'reponse_sans_contexte';

    if (mode) {
      return { mode, valide: true, libelle: 'Mode : ' + MODES[mode], message: '' };
    }

    let message = 'Combinaison invalide. ';
    if (r && !c) {
      message += 'Une Réponse a besoin du Commentaire auquel elle répond : capturez le Commentaire (Alt+Shift+2) ou videz la Réponse.';
    } else {
      message += 'Pour répondre à une Réponse, capturez aussi le Post (Alt+Shift+1), ou videz la Réponse.';
    }
    return { mode: null, valide: false, libelle: 'Mode : combinaison invalide', message };
  }

  // ---------------------------------------------------------------------------
  // Construction de la requête
  // ---------------------------------------------------------------------------

  function libelleContexte(contexte, precision) {
    if (contexte === 'Autre') {
      const p = (precision || '').trim();
      return p ? 'Autre: ' + p : 'Autre';
    }
    return contexte;
  }

  /** Message utilisateur selon le gabarit, en omettant les champs vides. */
  function construireMessageUtilisateur(entrees) {
    const lignes = [
      'CONTEXTE: ' + libelleContexte(entrees.contexte, entrees.precision),
      'LIEN_ELLIACARE: ' + (entrees.lienElliacare ? 'oui' : 'non'),
      'MODE: ' + entrees.mode,
      'LONGUEUR: ' + normaliserLongueur(entrees.longueur),
      'IRONIE: ' + normaliserIronie(entrees.ironie),
      'HUMOUR: ' + (entrees.humour ? 'oui' : 'non'),
      'FAUTES: ' + normaliserFautes(entrees.nbFautes)
    ];
    if (Array.isArray(entrees.attaques) && entrees.attaques.length) {
      lignes.push('ATTAQUES: ' + EMPLACEMENTS_VARIANTES
        .map((emplacement, i) => emplacement + ' = ' + (entrees.attaques[i] || entrees.attaques[0]))
        .join(' | '));
    }
    let texte = lignes.join('\n');
    const blocs = [
      ['POST', entrees.post],
      ['COMMENTAIRE', entrees.commentaire],
      ['REPONSE', entrees.reponse]
    ];
    for (const [titre, valeur] of blocs) {
      if (rempli(valeur)) {
        texte += '\n\n' + titre + ':\n' + valeur.trim();
      }
    }
    return texte;
  }

  /** Retire les commentaires HTML et les espaces : un fichier "vide" renvoie ''. */
  function nettoyerComplement(contenu) {
    return (contenu || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  }

  async function lireFichierExtension(chemin) {
    const reponse = await fetch(chrome.runtime.getURL(chemin));
    if (!reponse.ok) throw new ErreurIA('Fichier ' + chemin + ' introuvable dans l\'extension.', 'fichier');
    return reponse.text();
  }

  async function construireSysteme(contexte, lienElliacare) {
    const systeme = (await lireFichierExtension('prompts/system.md')).trim();
    if (contexte === 'Elliacare' || lienElliacare) {
      let complement = '';
      try {
        complement = nettoyerComplement(await lireFichierExtension('prompts/contexte-elliacare.md'));
      } catch (e) {
        complement = '';
      }
      if (complement) return systeme + '\n\n' + complement;
    }
    return systeme;
  }

  /**
   * Réglages propres à chaque modèle, pour que les jetons servent à la réponse.
   * La réflexion interne compte dans max_tokens : on la coupe quand le modèle le permet.
   */
  function reglagesModele(modele) {
    const m = (modele || '').toLowerCase();
    if (m.startsWith('claude-sonnet-5-5')) {
      return { thinking: { type: 'between_tools' }, fallbacks: 'default' };
    }
    if (m.startsWith('claude-haiku-5-5')) {
      return { thinking: { type: 'disabled' } };
    }
    if (m.startsWith('claude-opus-5-5') || m.startsWith('claude-fable-') || m.startsWith('claude-mythos-')) {
      return { output_config: { effort: 'low' }, fallbacks: 'default' };
    }
    return {};
  }

  /**
   * Corps de la requête. Accepte soit un seul message utilisateur, soit un fil
   * de messages complet (utilisé pour la demande de réécriture).
   */
  function construireCorps({ systeme, messageUtilisateur, messages, modele }) {
    return Object.assign({
      model: modele || MODELE_PAR_DEFAUT,
      max_tokens: MAX_TOKENS,
      system: systeme,
      messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messageUtilisateur }]
    }, reglagesModele(modele || MODELE_PAR_DEFAUT));
  }

  // ---------------------------------------------------------------------------
  // Configuration (chrome.storage.local)
  // ---------------------------------------------------------------------------

  async function lireConfiguration() {
    const v = await chrome.storage.local.get(['cleApi', 'modele', 'proxyUrl', 'proxyJeton']);
    return {
      cleApi: typeof v.cleApi === 'string' ? v.cleApi : '',
      modele: (typeof v.modele === 'string' && v.modele.trim()) ? v.modele.trim() : MODELE_PAR_DEFAUT,
      proxyUrl: typeof v.proxyUrl === 'string' ? v.proxyUrl.trim() : '',
      proxyJeton: typeof v.proxyJeton === 'string' ? v.proxyJeton : ''
    };
  }

  // ---------------------------------------------------------------------------
  // Appel réseau
  // ---------------------------------------------------------------------------

  /**
   * Envoie la requête au point d'accès configuré : proxy si une URL est renseignée,
   * sinon l'API Anthropic en direct. Renvoie le texte produit par le modèle.
   */
  async function appelerIA(corps, configuration, options) {
    const config = configuration || await lireConfiguration();
    const delai = (options && options.delaiMs) || DELAI_MAX_MS;
    const viaProxy = !!config.proxyUrl;

    let url;
    const entetes = { 'content-type': 'application/json' };
    let charge = corps;

    if (viaProxy) {
      url = config.proxyUrl;
      if (config.proxyJeton) entetes['authorization'] = 'Bearer ' + config.proxyJeton;
    } else {
      if (!config.cleApi) {
        throw new ErreurIA('Aucune clé API enregistrée. Ouvrez les options de l\'extension pour la saisir.', 'cle_absente');
      }
      url = POINT_ACCES_ANTHROPIC;
      entetes['x-api-key'] = config.cleApi;
      entetes['anthropic-version'] = VERSION_API;
      entetes['anthropic-dangerous-direct-browser-access'] = 'true';
      if (corps.fallbacks) entetes['anthropic-beta'] = BETA_REPLI;
    }

    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), delai);
    let reponse;
    try {
      reponse = await fetch(url, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify(charge),
        signal: controleur.signal,
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (e) {
      clearTimeout(minuterie);
      if (e && e.name === 'AbortError') {
        throw new ErreurIA('Délai dépassé (' + Math.round(delai / 1000) + ' s sans réponse). Réessayez dans un instant.', 'delai');
      }
      throw new ErreurIA(
        viaProxy
          ? 'Connexion au proxy impossible. Vérifiez l\'URL dans les options et votre connexion.'
          : 'Connexion au service IA impossible. Vérifiez votre connexion internet.',
        'reseau'
      );
    }

    let brut;
    try {
      brut = await reponse.text();
    } catch (e) {
      clearTimeout(minuterie);
      if (e && e.name === 'AbortError') {
        throw new ErreurIA('Délai dépassé (' + Math.round(delai / 1000) + ' s sans réponse). Réessayez dans un instant.', 'delai');
      }
      throw new ErreurIA('Réponse illisible du service IA.', 'reseau');
    }
    clearTimeout(minuterie);

    let donnees = null;
    try {
      donnees = brut ? JSON.parse(brut) : null;
    } catch (e) {
      donnees = null;
    }

    if (!reponse.ok) {
      throw erreurHttp(reponse.status, donnees, reponse.headers, viaProxy, config.modele || corps.model);
    }

    return extraireTexteReponse(donnees, brut);
  }

  function messageApi(donnees) {
    if (donnees && donnees.error) {
      if (typeof donnees.error === 'string') return donnees.error;
      if (typeof donnees.error.message === 'string') return donnees.error.message;
    }
    if (donnees && typeof donnees.message === 'string') return donnees.message;
    return '';
  }

  function erreurHttp(statut, donnees, entetes, viaProxy, modele) {
    const detail = messageApi(donnees);
    if (statut === 401) {
      return new ErreurIA(viaProxy
        ? 'Jeton d\'accès refusé par le proxy. Vérifiez-le dans les options.'
        : 'Clé API refusée. Vérifiez-la dans les options de l\'extension.', 'cle_refusee');
    }
    if (statut === 403) {
      return new ErreurIA(viaProxy
        ? 'Accès refusé par le proxy (403).'
        : 'Accès refusé : cette clé API n\'a pas les droits nécessaires.', 'acces_refuse');
    }
    if (statut === 429) {
      const attente = entetes && entetes.get ? parseInt(entetes.get('retry-after'), 10) : NaN;
      const delai = Number.isFinite(attente) && attente > 0 ? attente + ' s' : 'quelques secondes';
      return new ErreurIA('Limite de débit atteinte. Réessayez dans ' + delai + '.', 'debit');
    }
    if (statut === 404 && /model/i.test(detail)) {
      return new ErreurIA('Modèle introuvable : « ' + modele + ' ». Corrigez son nom dans les options.', 'modele');
    }
    if (statut === 404 && viaProxy) {
      return new ErreurIA('Adresse du proxy introuvable (404). Vérifiez l\'URL dans les options.', 'proxy');
    }
    if (statut === 529 || statut === 503) {
      return new ErreurIA('Service IA momentanément surchargé. Réessayez dans quelques secondes.', 'surcharge');
    }
    if (statut === 400) {
      return new ErreurIA('Requête refusée par le service IA' + (detail ? ' : ' + detail : '.'), 'requete');
    }
    if (statut >= 500) {
      return new ErreurIA('Erreur du service IA (' + statut + '). Réessayez dans quelques secondes.', 'serveur');
    }
    return new ErreurIA('Erreur ' + statut + (detail ? ' : ' + detail : '.'), 'http');
  }

  /**
   * Accepte la forme de l'API Anthropic (content[]), ou les formes simples
   * qu'un proxy peut renvoyer (objet déjà au bon format, champ texte, texte brut).
   */
  function extraireTexteReponse(donnees, brut) {
    if (donnees && Array.isArray(donnees.content)) {
      if (donnees.stop_reason === 'refusal') {
        const categorie = donnees.stop_details && donnees.stop_details.category;
        throw new ErreurIA('Le modèle a décliné cette demande' + (categorie ? ' (catégorie : ' + categorie + ')' : '') + '. Reformulez ou changez de modèle dans les options.', 'refus');
      }
      const texte = donnees.content
        .filter((bloc) => bloc && bloc.type === 'text' && typeof bloc.text === 'string')
        .map((bloc) => bloc.text)
        .join('');
      return { texte, tronque: donnees.stop_reason === 'max_tokens' };
    }
    if (donnees && Array.isArray(donnees.variantes)) {
      return { texte: JSON.stringify(donnees), tronque: false };
    }
    if (donnees && typeof donnees === 'object') {
      for (const cle of ['text', 'texte', 'output', 'reponse', 'response', 'result']) {
        if (typeof donnees[cle] === 'string') return { texte: donnees[cle], tronque: false };
      }
    }
    if (typeof donnees === 'string') return { texte: donnees, tronque: false };
    return { texte: brut || '', tronque: false };
  }

  // ---------------------------------------------------------------------------
  // Lecture du JSON produit par le modèle
  // ---------------------------------------------------------------------------

  function analyserJson(texte) {
    if (typeof texte !== 'string') return null;
    let t = texte.trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const essais = [t];
    const debut = t.indexOf('{');
    const fin = t.lastIndexOf('}');
    if (debut >= 0 && fin > debut) essais.push(t.slice(debut, fin + 1));
    for (const candidat of essais) {
      try {
        const objet = JSON.parse(candidat);
        if (objet && typeof objet === 'object') return objet;
      } catch (e) {
        // essai suivant
      }
    }
    return null;
  }

  function normaliserAngle(angle) {
    const a = typeof angle === 'string' ? angle.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[\s-]+/g, '_') : '';
    if (a.startsWith('reflexion')) return 'reflexion';
    if (a.startsWith('point_non_vu') || a.startsWith('pointnonvu')) return 'point_non_vu';
    return '';
  }

  /**
   * Vérifie la structure attendue et renvoie
   * { cas, variantes: [reflexion 1, reflexion 2, point_non_vu 1, point_non_vu 2], humour, suggestion }
   * ou null si le JSON ne convient pas.
   */
  function normaliserResultat(objet) {
    if (!objet || !Array.isArray(objet.variantes)) return null;
    const valides = objet.variantes.filter((v) => v && typeof v.texte === 'string' && v.texte.trim() !== '');
    if (valides.length === 0) return null;

    const reflexions = valides.filter((v) => normaliserAngle(v.angle) === 'reflexion').slice(0, 2);
    const points = valides.filter((v) => normaliserAngle(v.angle) === 'point_non_vu').slice(0, 2);
    // Variantes sans angle reconnu : complètent les cases vides, dans l'ordre reçu.
    for (const v of valides) {
      if (reflexions.includes(v) || points.includes(v)) continue;
      if (reflexions.length < 2) reflexions.push(v);
      else if (points.length < 2) points.push(v);
    }

    const variantes = [];
    reflexions.forEach((v, i) => variantes.push({ angle: 'reflexion', numero: i + 1, texte: nettoyerTexte(v.texte), fautes: listeFautes(v.fautes) }));
    points.forEach((v, i) => variantes.push({ angle: 'point_non_vu', numero: i + 1, texte: nettoyerTexte(v.texte), fautes: listeFautes(v.fautes) }));

    let humour = null;
    if (objet.humour && typeof objet.humour === 'object' && typeof objet.humour.texte === 'string' && objet.humour.texte.trim()) {
      humour = { texte: nettoyerTexte(objet.humour.texte), fautes: listeFautes(objet.humour.fautes) };
    } else if (typeof objet.humour === 'string' && objet.humour.trim() && objet.humour.trim().toLowerCase() !== 'null') {
      humour = { texte: nettoyerTexte(objet.humour), fautes: [] };
    }

    let suggestion = null;
    if (typeof objet.suggestion_elliacare === 'string') {
      const s = nettoyerTexte(objet.suggestion_elliacare);
      if (s && s.toLowerCase() !== 'null') suggestion = s;
    }

    return {
      mode: typeof objet.mode === 'string' ? objet.mode : '',
      cas: typeof objet.cas === 'string' ? objet.cas : 'standard',
      variantes,
      humour,
      suggestion
    };
  }

  function libelleVariante(variante) {
    return (variante.angle === 'reflexion' ? 'Réflexion' : 'Point non vu') + (variante.numero ? ' ' + variante.numero : '');
  }

  function listeFautes(fautes) {
    if (Array.isArray(fautes)) {
      return fautes.filter((f) => typeof f === 'string' && f.trim() !== '').map((f) => nettoyerTexte(f));
    }
    if (typeof fautes === 'string' && fautes.trim() !== '') return [nettoyerTexte(fautes)];
    return [];
  }

  // ---------------------------------------------------------------------------
  // Contrôle de sécurité avant affichage
  // ---------------------------------------------------------------------------

  /**
   * Remplace le tiret long (U+2014) par une virgule, le tiret moyen utilisé comme
   * tiret long (U+2013 entouré d'espaces) par une virgule, et le point-virgule par
   * un point, sauf dans le smiley ;-)
   */
  function nettoyerTexte(texte) {
    if (typeof texte !== 'string') return '';
    let s = texte.replace(/\r\n?/g, '\n');
    // Retours à la ligne doublement échappés par le modèle
    s = s.replace(/\\n/g, '\n');
    // Tiret long, et tiret moyen employé comme tiret long
    s = s.replace(/[ \t]*\u2014[ \t]*/g, ', ');
    s = s.replace(/[ \t]+\u2013[ \t]+/g, ', ');
    // Point-virgule hors smiley ;-)
    s = s.replace(/[ \t]*;(?!-\))([ \t]*)(\p{Ll})?/gu, (m, espace, lettre) => {
      return '.' + ((espace || lettre) ? ' ' : '') + (lettre ? lettre.toUpperCase() : '');
    });
    // Ponctuation doublée après remplacement
    s = s.replace(/,[ \t]*([,.!?:])/g, '$1');
    s = s.replace(/\.[ \t]*,/g, '.');
    s = s.replace(/^[ \t]*,[ \t]*/gm, '');
    s = s.replace(/[ \t]*,[ \t]*$/gm, '');
    // Un seul saut de ligne entre deux paragraphes
    s = s.replace(/\n{2,}/g, '\n');
    return s.trim();
  }

  // ---------------------------------------------------------------------------
  // Formules toutes faites et contrôle de longueur
  // ---------------------------------------------------------------------------

  // Comparées sans accents, sans majuscules, apostrophes normalisées.
  const FORMULES_TOUTES_FAITES = [
    'ce qui me frappe', 'ce qui frappe', 'le plus frappant',
    "ce que l'on oublie", "ce qu'on oublie", "qu'on oublie souvent", 'souvent oublie',
    "ce qu'on ne dit pas", "ce que l'on ne dit pas", "on n'en parle pas assez",
    'le vrai sujet', 'la vraie question', 'tout est dit', 'je rejoins', 'excellente analyse',
    "c'est tout l'enjeu", "n'oublions pas", 'il ne faut pas oublier', 'angle mort',
    "ce qu'on ne voit pas", 'personne ne souleve', 'en realite', 'au final',
    'belle reflexion', 'ton post souleve', 'votre post souleve',
    'bravo', 'merci pour le partage', 'merci pour ton retour', 'merci pour votre retour'
  ];

  function normaliserPourRecherche(texte) {
    return (texte || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/\s+/g, ' ');
  }

  function formulesToutesFaites(texte) {
    const t = normaliserPourRecherche(texte);
    return FORMULES_TOUTES_FAITES.filter((f) => t.includes(f));
  }

  function compterLignes(texte) {
    return (texte || '').split('\n').filter((l) => l.trim() !== '').length;
  }

  /** Nombre de mots de la phrase la plus longue (phrases coupées sur . ! ? ... et retours à la ligne). */
  function motsPlusLonguePhrase(texte) {
    const phrases = (texte || '').split(/[.!?…]+|\n/);
    let max = 0;
    for (const phrase of phrases) {
      const mots = phrase.split(/\s+/).filter((m) => /\p{L}/u.test(m));
      if (mots.length > max) max = mots.length;
    }
    return max;
  }

  /**
   * Contrôle d'un commentaire par rapport aux réglages : formules interdites,
   * longueur (tolérance de 15 %), longueur des phrases, nombre de fautes attendu.
   */
  function controlerTexte(texte, fautes, longueur, estHumour, nbFautes) {
    const reglage = LONGUEURS[normaliserLongueur(longueur)];
    const maxCaracteres = estHumour ? HUMOUR_MAX_CARACTERES : reglage.maxCaracteres;
    const maxLignes = estHumour ? 1 : reglage.lignes;
    const maxMotsPhrase = estHumour ? LONGUEURS.flash.maxMotsPhrase : reglage.maxMotsPhrase;
    const caracteres = (texte || '').length;
    const lignes = compterLignes(texte);
    const motsPhrase = motsPlusLonguePhrase(texte);
    const fautesAttendues = normaliserFautes(nbFautes);
    return {
      formules: formulesToutesFaites(texte),
      tropLong: caracteres > Math.round(maxCaracteres * 1.15) || lignes > maxLignes,
      phraseTropLongue: motsPhrase > maxMotsPhrase + TOLERANCE_MOTS,
      caracteres,
      lignes,
      motsPhrase,
      maxCaracteres,
      maxLignes,
      maxMotsPhrase,
      fautesAttendues,
      fautesOk: Array.isArray(fautes) && fautes.length === fautesAttendues
    };
  }

  /** Liste des corrections à demander au modèle (formules, longueur, phrases, éléments manquants). */
  function problemesARecrire(resultat, reglages) {
    const problemes = [];
    const longueur = normaliserLongueur(reglages.longueur);
    const signaler = (libelle, c) => {
      if (c.formules.length) problemes.push(libelle + ' : contient « ' + c.formules.join(' », « ') + ' », formule toute faite interdite.');
      if (c.tropLong) problemes.push(libelle + ' : ' + c.caracteres + ' caractères sur ' + c.lignes + ' ligne(s), le format impose ' + c.maxCaracteres + ' caractères et ' + c.maxLignes + ' ligne(s) au maximum.');
      if (c.phraseTropLongue) problemes.push(libelle + ' : une phrase de ' + c.motsPhrase + ' mots, ' + c.maxMotsPhrase + ' mots maximum par phrase. Coupe ou raccourcis.');
    };
    for (const v of resultat.variantes) {
      signaler(libelleVariante(v), controlerTexte(v.texte, v.fautes, longueur, false, reglages.nbFautes));
    }
    const nbReflexions = resultat.variantes.filter((v) => v.angle === 'reflexion').length;
    const nbPoints = resultat.variantes.filter((v) => v.angle === 'point_non_vu').length;
    if (nbReflexions < 2 || nbPoints < 2) problemes.push('Il faut exactement deux commentaires "reflexion" et deux commentaires "point_non_vu".');
    if (reglages.humour) {
      if (!resultat.humour) {
        problemes.push('La ligne "humour" est demandée et manque.');
      } else {
        signaler('Humour', controlerTexte(resultat.humour.texte, resultat.humour.fautes, longueur, true, reglages.nbFautes));
      }
    }
    return problemes;
  }

  function messageCorrection(problemes) {
    return 'Réécris le JSON complet en corrigeant ces points, sans toucher à ce qui est correct :\n- '
      + problemes.join('\n- ')
      + '\nGarde la voix personnelle de Franck, les attaques demandées, des phrases courtes, la longueur demandée et le nombre de fautes demandé. Réponds uniquement avec le JSON demandé, sans aucun texte autour.';
  }

  function expressionsProscrites(texte) {
    return formulesToutesFaites(texte);
  }

  racine.IA = {
    MODELE_PAR_DEFAUT,
    MAX_TOKENS,
    DELAI_MAX_MS,
    MODES,
    LONGUEURS,
    LONGUEUR_PAR_DEFAUT,
    IRONIE_PAR_DEFAUT,
    FAUTES_PAR_DEFAUT,
    normaliserFautes,
    motsPlusLonguePhrase,
    HUMOUR_MAX_CARACTERES,
    ATTAQUES,
    tirerAttaques,
    normaliserLongueur,
    normaliserIronie,
    libelleVariante,
    formulesToutesFaites,
    controlerTexte,
    problemesARecrire,
    messageCorrection,
    ErreurIA,
    determinerMode,
    construireMessageUtilisateur,
    construireSysteme,
    construireCorps,
    reglagesModele,
    nettoyerComplement,
    lireConfiguration,
    appelerIA,
    analyserJson,
    normaliserResultat,
    nettoyerTexte,
    expressionsProscrites
  };
})(typeof self !== 'undefined' ? self : this);
