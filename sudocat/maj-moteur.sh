#!/usr/bin/env bash
# Recopie le moteur et les dessins depuis le générateur Sudocat (Apps/sudocat).
# À relancer après une modification du moteur ou des images (python3 build_illustrations.py là-bas).
set -e
cd "$(dirname "$0")"
SRC="$HOME/Library/CloudStorage/Dropbox-ANTARTIK/BOULOT/•••UTILITAIRES/Scripts_Antartik/Apps/sudocat"
cp "$SRC/generateur.js" moteur.js
cp "$SRC/illustrations.js" illustrations.js
echo "moteur.js et illustrations.js mis à jour depuis $SRC"
echo "Pense à augmenter ?v= dans index.html (cache des navigateurs)."
