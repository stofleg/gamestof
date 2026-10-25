# Sudocat en ligne — gamestof.fr/sudocat

Jeu en ligne tiré du générateur Sudocat (`BOULOT/•••UTILITAIRES/Scripts_Antartik/Apps/sudocat`) :
placer un chat (ou un chien) par ligne, colonne et zone, sans que deux se touchent.

## Comment on joue

- **Toucher** une case : pose ou retire une croix. **Glisser** sur plusieurs cases : croix sur
  toutes (ou les retire, si la première case en avait une).
- **Toucher deux fois** : pose un chat. Un chat mal placé compte une **erreur** (croix rouge) ;
  à la **3ᵉ**, la grille est perdue et la solution s'affiche.
- Pas de chrono affiché (la durée est seulement enregistrée). La partie en cours est
  sauvegardée en continu : on la retrouve en revenant, sur n'importe quel appareil.
- Deux mascottes dessinées pour le site (`mascottes.js`) : le chat calico et le chien. Le bouton
  🐱/🐶 change de thème (mémorisé par joueur).
- Installable sur l'écran d'accueil (iPhone : Partager → Sur l'écran d'accueil) : plein écran,
  icône Sudocat (`manifest.json`, `icon-*.png`).

## Les 100 paliers

Chaque joueur avance sur **100 paliers** (`progression.js`) : chacun associe un type de
raisonnement du moteur (niveau 1 à 6) et une taille de grille (5×5 au début, 12×12 à la fin),
sur 36 étapes.

| Résultat de la grille | Effet |
|---|---|
| Réussie **sans faute** | palier suivant |
| Réussie avec 1 ou 2 erreurs | même palier |
| **Perdue** (3 erreurs) ou abandonnée | palier précédent (jamais sous le 1) |

## Joueurs d'un même compte

Un compte peut porter des **joueurs secondaires** (ex. les enfants) : des boutons à leur nom
apparaissent en haut de l'écran, chacun garde son palier, son thème et sa partie en cours, sans
se déconnecter. Ils se créent en SQL (voir `schema-v2.sql`, partie 3 : Soline et Emile sur le
compte de Marion) :

```sql
insert into public.sudocat_joueurs (user_id, nom)
select user_id, 'Prénom' from public.sudocat_profils where lower(pseudo) = 'pseudo du compte';
```

## Mise en service des comptes (projet Supabase dédié)

Tant que `config.js` est vide, l'appli tourne en **mode local de test** : comptes et
progression dans le navigateur seulement (un bandeau l'indique).

1. Sur supabase.com : **New project** (ex. « sudocat »), région Europe.
2. **Authentication → Providers → Email** : activé. **Confirm email** : au choix
   (désactivé = inscription immédiate ; activé = lien de confirmation, géré par l'appli).
3. **Authentication → URL Configuration** :
   - Site URL : `https://gamestof.fr/sudocat/`
   - Redirect URLs : `https://gamestof.fr/sudocat/` (lien « mot de passe oublié »)
4. **SQL Editor → New query** : coller `schema.sql` → **Run**, puis de même `schema-v2.sql`
   (paliers, joueurs secondaires). Droits : chacun ne voit que ses données.
5. **Project Settings → API** : copier *Project URL* et la clé *anon public* dans `config.js`.

La clé *anon* est publique par nature (elle est aussi dans `topissimo/config.js`) ; la
protection vient des règles RLS du SQL.

> Limite connue : la montée de niveau est décidée dans le navigateur. Un joueur bricoleur
> pourrait modifier son niveau lui-même ; sans enjeu tant qu'il n'y a pas de classement.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css`, `jeu.js` | page, plateau, gestes, joueurs, progression |
| `progression.js` | les 100 paliers (niveau du moteur + taille) |
| `mascottes.js` | les deux dessins (chat calico, chien) |
| `manifest.json`, `icon-*.png`, `icon.svg` | appli installable sur l'écran d'accueil |
| `stockage.js` | comptes et sauvegarde : Supabase, ou mode local si `config.js` est vide |
| `worker.js` | génère les grilles en tâche de fond (jusqu'à quelques secondes en niveau 6) |
| `moteur.js` | **copie** du moteur du générateur (`generateur.js`) |
| `maj-moteur.sh` | recopie le moteur depuis le générateur |
| `schema.sql`, `schema-v2.sql`, `config.js` | base Supabase (v1 puis mise à jour v2) et ses identifiants |

Après une modification du moteur dans le générateur : `./maj-moteur.sh`, puis
augmenter `?v=` dans `index.html` (et dans `worker.js` pour `moteur.js`).
