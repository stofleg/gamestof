# Sudocat en ligne — gamestof.fr/sudocat

Jeu en ligne tiré du générateur Sudocat (`BOULOT/•••UTILITAIRES/Scripts_Antartik/Apps/sudocat`) :
placer un chat (ou un chien) par ligne, colonne et zone, sans que deux se touchent.

## Comment on joue

- **Un clic** sur une case : pose ou retire une croix. **Glisser** sur plusieurs cases :
  croix sur toutes (ou les retire, si la première case en avait une).
- **Double-clic** (double tape sur téléphone) : pose un chat. Un chat mal placé compte une
  **erreur** (croix rouge) ; à la **3ᵉ**, la grille est perdue et la solution s'affiche.
- La partie en cours est enregistrée en continu : on la retrouve en revenant, même sur un
  autre appareil (avec Supabase). Le chrono ne tourne que quand la page est affichée.

## Niveaux

Le joueur commence au niveau 1. La taille de la grille est tirée selon le niveau (5–6 en
niveau 1 … 10–12 en niveau 6, cf. `SIZE_RANGES` du moteur).

Une grille réussie **sans erreur et en moins du temps cible** est « facile » pour le joueur :
il passe au niveau suivant. Sinon (erreurs, temps dépassé, grille perdue ou abandonnée), il
reste au même niveau — **il ne redescend jamais**.

Temps cible = taille de la grille × secondes par ligne (`SECONDES_PAR_LIGNE` en tête de `jeu.js`) :

| Niveau | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Secondes par ligne | 15 | 20 | 25 | 30 | 35 | 40 |
| Exemple | 6×6 : 1:30 | 7×7 : 2:20 | 8×8 : 3:20 | 9×9 : 4:30 | 10×10 : 5:50 | 12×12 : 8:00 |

Valeurs de départ, à ajuster après quelques parties.

## Mise en service des comptes (projet Supabase dédié)

Tant que `config.js` est vide, l'appli tourne en **mode local de test** : comptes et
progression dans le navigateur seulement (un bandeau l'indique).

1. Sur supabase.com : **New project** (ex. « sudocat »), région Europe.
2. **Authentication → Providers → Email** : activé. **Confirm email** : au choix
   (désactivé = inscription immédiate ; activé = lien de confirmation, géré par l'appli).
3. **Authentication → URL Configuration** :
   - Site URL : `https://gamestof.fr/sudocat/`
   - Redirect URLs : `https://gamestof.fr/sudocat/` (lien « mot de passe oublié »)
4. **SQL Editor → New query** : coller `schema.sql` → **Run** (tables `sudocat_profils`,
   `sudocat_parties`, droits : chacun ne voit que ses données).
5. **Project Settings → API** : copier *Project URL* et la clé *anon public* dans `config.js`.

La clé *anon* est publique par nature (elle est aussi dans `topissimo/config.js`) ; la
protection vient des règles RLS du SQL.

> Limite connue : la montée de niveau est décidée dans le navigateur. Un joueur bricoleur
> pourrait modifier son niveau lui-même ; sans enjeu tant qu'il n'y a pas de classement.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css`, `jeu.js` | page, plateau, gestes, chrono, progression |
| `stockage.js` | comptes et sauvegarde : Supabase, ou mode local si `config.js` est vide |
| `worker.js` | génère les grilles en tâche de fond (jusqu'à quelques secondes en niveau 6) |
| `moteur.js`, `illustrations.js` | **copies** du générateur (`generateur.js`, `illustrations.js`) |
| `maj-moteur.sh` | recopie ces deux fichiers depuis le générateur |
| `schema.sql`, `config.js` | base Supabase et ses identifiants |

Après une modification du moteur ou des dessins dans le générateur : `./maj-moteur.sh`, puis
augmenter `?v=` dans `index.html` (et dans `worker.js` pour `moteur.js`).
