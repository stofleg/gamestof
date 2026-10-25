#!/usr/bin/env bash
# Recopie le moteur depuis le générateur Sudocat (Apps/sudocat).
# Les dessins du jeu en ligne sont les deux mascottes de mascottes.js (pas les images du livre).
set -e
cd "$(dirname "$0")"
SRC="$HOME/Library/CloudStorage/Dropbox-ANTARTIK/BOULOT/•••UTILITAIRES/Scripts_Antartik/Apps/sudocat"
cp "$SRC/generateur.js" moteur.js
echo "moteur.js mis à jour depuis $SRC"
echo "Pense à augmenter ?v= dans index.html et worker.js (cache des navigateurs)."
