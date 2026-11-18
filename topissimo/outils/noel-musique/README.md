# Musiques et feu de cheminée de Noël (grille cube)

Playlist d'environ 2 h 25 (`topissimo/scrabble/musique/noel/`, liste dans `scrabble/noel-morceaux.js`),
jouée en alternance (chant connu, classique, chant, pièce originale) par `scrabble/noel.js`.

- `chants.mjs` : Vive le vent, Douce nuit, We Wish You a Merry Christmas, Deck the Halls, Joy to the
  World (mélodie, accords, arrangement de référence) ; `fabrique.mjs` en fait plusieurs versions
  (galop, valse, boîte à musique, chœur et orgue, marche…) et compose les pièces originales
  (`compose.mjs` : forme A A' B A', motifs, séquences, cadences).
- `lecture_abc.py` + `populaires.py` : chants de Noël populaires du corpus libre de music21 (notation
  ABC), harmonisés automatiquement ; `lecture.py` : partitions MusicXML (chorals de Noël de Bach,
  quatuors « La Chasse » de Haydn et Mozart) ; `partition.mjs` les orchestre ; `fabrique2.mjs` rend
  cette deuxième série.
- `moteur.mjs` : arrangement → MIDI → rendu avec la banque de sons libre GeneralUser GS
  (`npm install generaluser spessasynth_core midi-file`).
- `traite.mjs` : salle (`ir.py`), compression douce, normalisation linéaire à −18 LUFS, AAC 64 kbit/s.
- `assemble.mjs` : sélection, copie des fichiers et écriture de `noel-morceaux.js`.
- `feu.py` : feu de cheminée de synthèse (boucle sans couture, `musique/noel-feu.m4a`).

Le corpus music21 se récupère avec `pip download --no-deps music21` (fichiers `.mxl` / `.abc` dans
`music21/corpus/`). Les niveaux de lecture (GAIN_MUSIQUE, NIVEAUX) se règlent dans `noel.js` avec `__mesure`.
- `traineau.mjs` : passage du traîneau (grelots échantillonnés, trot, célesta, cloches) → `musique/noel-traineau.m4a`.
- `hohoho.py` : « Ho ! Ho ! Ho ! » par synthèse de voix à formants → `musique/noel-hohoho.m4a`.

## « No Hell ! » (Noël version metal)

- `metal.mjs` : arrangeur metal. Mélodie et accords d'un chant → guitares saturées doublées gauche/droite
  (accords de puissance étouffés, galop, croches ou doubles croches), basse au médiator, batterie
  « Power Drums » (double pédale, fills, crashs), guitare solo avec vibrato, guitares jumelles en
  tierces, solo en arpèges et passage « maléfique » en mineur harmonique. Styles : `heavy`, `thrash`,
  `ballade` (intro en guitare claire), `symphonique` (orgue, chœur, cordes, coups d'orchestre).
- `fabrique-metal.mjs` : chaque chant (chants.mjs + populaires.json) en deux styles (trois pour Vive le
  vent), traitement `traite-metal.mjs` (petite salle, compression de bus, −18 LUFS, AAC), copie dans
  `scrabble/musique/nohell/` et écriture de `scrabble/nohell-morceaux.js`.
- `fx-metal.mjs` : effets (top, ouverture du cadeau, scrabble) → `musique/nohell-*.m4a` ; le
  « HO HO HO » grogné vient de `noel-hohoho.m4a` (ffmpeg : deux voix plus graves, compression,
  saturation, écho).
