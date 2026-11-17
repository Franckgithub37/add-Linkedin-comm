// Crée site/extension-reponses-linkedin.zip à partir du dossier de l'extension.
// Aucune dépendance : format ZIP écrit à la main avec zlib (compression "deflate").
// Usage : node scripts/empaqueter.js   (lancé aussi par Vercel au déploiement)

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOM = 'extension-reponses-linkedin';
const source = join(racine, NOM);
const destination = join(racine, 'site', NOM + '.zip');

const TABLE_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(tampon) {
  let c = 0xffffffff;
  for (const octet of tampon) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dateDos(date) {
  const heure = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const jour = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { heure, jour };
}

function listerFichiers(dossier) {
  const fichiers = [];
  for (const nom of readdirSync(dossier).sort()) {
    if (nom.startsWith('.')) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers.push(...listerFichiers(chemin));
    else fichiers.push(chemin);
  }
  return fichiers;
}

function construireZip() {
  const { heure, jour } = dateDos(new Date());
  const locaux = [];
  const central = [];
  let decalage = 0;

  for (const chemin of listerFichiers(source)) {
    const nomZip = Buffer.from(NOM + '/' + relative(source, chemin).split(sep).join('/'), 'utf8');
    const donnees = readFileSync(chemin);
    const compresse = deflateRawSync(donnees, { level: 9 });
    const crc = crc32(donnees);

    const entete = Buffer.alloc(30);
    entete.writeUInt32LE(0x04034b50, 0);
    entete.writeUInt16LE(20, 4);
    entete.writeUInt16LE(0x0800, 6); // noms en UTF-8
    entete.writeUInt16LE(8, 8); // deflate
    entete.writeUInt16LE(heure, 10);
    entete.writeUInt16LE(jour, 12);
    entete.writeUInt32LE(crc, 14);
    entete.writeUInt32LE(compresse.length, 18);
    entete.writeUInt32LE(donnees.length, 22);
    entete.writeUInt16LE(nomZip.length, 26);
    entete.writeUInt16LE(0, 28);
    locaux.push(entete, nomZip, compresse);

    const entree = Buffer.alloc(46);
    entree.writeUInt32LE(0x02014b50, 0);
    entree.writeUInt16LE(20, 4);
    entree.writeUInt16LE(20, 6);
    entree.writeUInt16LE(0x0800, 8);
    entree.writeUInt16LE(8, 10);
    entree.writeUInt16LE(heure, 12);
    entree.writeUInt16LE(jour, 14);
    entree.writeUInt32LE(crc, 16);
    entree.writeUInt32LE(compresse.length, 20);
    entree.writeUInt32LE(donnees.length, 24);
    entree.writeUInt16LE(nomZip.length, 28);
    entree.writeUInt32LE(0, 30); // extra + commentaire
    entree.writeUInt32LE(0, 34); // disque + attributs internes
    entree.writeUInt32LE(0, 38); // attributs externes
    entree.writeUInt32LE(decalage, 42);
    central.push(entree, nomZip);

    decalage += entete.length + nomZip.length + compresse.length;
  }

  const tailleCentral = central.reduce((total, b) => total + b.length, 0);
  const nombre = central.length / 2;
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(nombre, 8);
  fin.writeUInt16LE(nombre, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(decalage, 16);

  return { zip: Buffer.concat([...locaux, ...central, fin]), nombre };
}

mkdirSync(dirname(destination), { recursive: true });
const { zip, nombre } = construireZip();
writeFileSync(destination, zip);
console.log(`Archive créée : ${relative(racine, destination)} (${nombre} fichiers, ${zip.length} octets)`);
