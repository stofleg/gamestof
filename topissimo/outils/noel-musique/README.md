# Musiques et feu de cheminée de Noël (grille cube)

Fabrication des fichiers `topissimo/scrabble/musique/noel-*.m4a` :

- `arrange.mjs` : arrangements orchestraux de chants du domaine public (mélodie, accords,
  orchestration par couplet) écrits en MIDI, puis rendus avec la banque de sons libre
  GeneralUser GS (`npm install generaluser spessasynth_core midi-file`). Produit `<cle>.wav`.
- `ir.py` : réponse impulsionnelle de salle (réverbération, appliquée avec ffmpeg `afir`).
- `feu.py` : feu de cheminée de synthèse (40 s, boucle sans couture).

Chaîne ffmpeg par morceau : réverbération (18 %), compression douce (ratio 2), normalisation
linéaire en deux passes à −18 LUFS (crête vraie −1,5 dBTP), AAC 128 kbit/s. Le feu : AAC 96 kbit/s.
Les niveaux de lecture (GAIN_MUSIQUE, NIVEAUX) sont réglés dans `scrabble/noel.js` avec `__mesure`.
