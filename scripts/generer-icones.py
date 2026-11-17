"""Génère les icônes de l'extension (16, 32, 48, 128 px) et le favicon du site.

Usage : python3 scripts/generer-icones.py
Dessin : carré arrondi bleu, bulle de dialogue blanche avec deux lignes de texte.
Le dessin est fait en grand puis réduit, pour un rendu net et lissé.
"""

from pathlib import Path

from PIL import Image, ImageDraw

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_ICONES = RACINE / "extension-reponses-linkedin" / "icons"
BLEU = (10, 102, 194, 255)
BLANC = (255, 255, 255, 255)
GRAND = 1024


def dessiner() -> Image.Image:
    image = Image.new("RGBA", (GRAND, GRAND), (0, 0, 0, 0))
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((0, 0, GRAND - 1, GRAND - 1), radius=230, fill=BLEU)

    # Bulle de dialogue
    gauche, haut, droite, bas = 200, 230, 824, 690
    d.rounded_rectangle((gauche, haut, droite, bas), radius=150, fill=BLANC)
    d.polygon([(330, 640), (300, 840), (500, 680)], fill=BLANC)

    # Deux lignes de texte dans la bulle
    d.rounded_rectangle((330, 375, 694, 435), radius=30, fill=BLEU)
    d.rounded_rectangle((330, 495, 590, 555), radius=30, fill=BLEU)
    return image


def main() -> None:
    DOSSIER_ICONES.mkdir(parents=True, exist_ok=True)
    source = dessiner()
    for taille in (16, 32, 48, 128):
        source.resize((taille, taille), Image.LANCZOS).save(DOSSIER_ICONES / f"icon{taille}.png", optimize=True)
    site = RACINE / "site"
    site.mkdir(exist_ok=True)
    source.resize((256, 256), Image.LANCZOS).save(site / "icone.png", optimize=True)
    print("Icônes générées dans", DOSSIER_ICONES)


if __name__ == "__main__":
    main()
