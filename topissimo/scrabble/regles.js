//  Règles des formules superoriginales, affichées à l'ouverture d'une partie.
//  Public : joueurs aguerris qui connaissent le topping par cœur — on ne décrit
//  QUE ce qui change par rapport à une partie normale.
export const REGLES = {
  "6lettres": {
    titre: "6 lettres",
    points: [
      "Tirages de <b>6 lettres</b> au lieu de 7.",
      "Pas de scrabble : <b>aucune prime de 50</b>, même en posant les 6 lettres.",
      "<b>66 s</b> de réflexion par coup.",
      "La partie entière dure <b>666 s</b>. Lorsque le temps est écoulé, les coups restants sont ajoutés au <b>négatif</b> du joueur.",
    ],
  },
  "7sur15": {
    titre: "7 sur 15",
    points: [
      "Tirage de <b>15 lettres</b>, dont tu poses <b>7 au maximum</b>.",
      "Prime de 50 pour 7 lettres posées, comme d'habitude.",
    ],
  },
  jokerpayant: {
    titre: "Joker payant",
    points: [
      "Le joker <b>vaut les points de la lettre qu'il remplace</b> (un joker en Z rapporte 10).",
    ],
  },
  horizvert: {
    titre: "Horizontal / Vertical",
    points: [
      "Le sens est <b>imposé</b> et alterne : coups impairs <b>horizontaux</b>, coups pairs <b>verticaux</b>.",
      "Le top est le meilleur coup <b>dans le sens imposé</b>.",
    ],
  },
  topsoustop: {
    titre: "Top / sous-top",
    points: [
      "Il faut trouver <b>le top ET le sous-top</b>.",
      "En cas d'isotops, le sous-top est le <b>score immédiatement inférieur</b> : un deuxième isotop ne compte pas.",
    ],
  },
  infjoker: {
    titre: "Double joker infini",
    points: [
      "Chaque tirage contient <b>2 jokers + 5 lettres</b>.",
      "Les jokers posés <b>restent sur la grille</b> et ne sont jamais recyclés : il y en a toujours deux nouveaux.",
      "La partie s'arrête quand toutes les lettres réelles du sac ont été posées.",
    ],
  },
  paques: {
    titre: "🐣 Pâques",
    points: [
      "Les E (les œufs) ont disparu : <b>pas de E dans le sac</b>, et <b>le joker ne peut pas valoir E</b> non plus. C'est une partie joker : quand le vrai top utiliserait un joker en E, c'est le meilleur coup sans E qu'il faut trouver.",
      "<b>15 œufs sont cachés</b> dans la grille. Chaque mot valide que tu tapes (top ou simple essai) découvre les œufs des cases qu'il couvre : <b>+5 points par œuf</b> 🥚.",
      "Les cases déjà parcourues par tes mots sont marquées d'un point violet : cherche des mots qui passent ailleurs.",
    ],
  },
  topsping: {
    titre: "🎾 TopSping",
    points: [
      "Tu affrontes <b>le top</b> : <b>40 s</b> par coup au maximum, le coup s'arrête dès que tu trouves le top. Top trouvé : point pour toi ; raté : point pour le top.",
      "Jeu en 15, 30, 40, jeu (avantage à 40-40). Set en 6 jeux avec 2 d'écart, <b>tie-break</b> en 7 points à 6-6. Match en <b>3 sets gagnants</b>.",
      "Chaque jeu se joue sur une nouvelle partie : à partir du coup 1 au 1er set, du coup 5 au 2e set, du coup 9 au 3e…",
      "7 tours : 1er tour (Normale), 2e tour (Joker), 16es (7 sur 8), 8es (7 sur 8 joker), quarts (7 et 8), demie (7 et 8 joker), finale (7, 8 et 9).",
      "Un match perdu, ou un abandon, termine ton tournoi. Classement : tour atteint, puis tops ratés, puis négatif.",
      "Pause : bouton ⏸ (prise à la fin du coup), et aux changements de côté, fins de set et entre les matchs. On peut quitter pendant une pause et revenir plus tard ; quitter pendant un coup le fait compter comme raté.",
    ],
  },
  grillecoeur: {
    titre: "Grille cœur",
    points: [
      "Les <b>cases bonus dessinent deux cœurs</b> : même nombre de cases de chaque type que la grille classique, mais placées autrement.",
      "<b>Prime de 100 points</b> pour le mot <b>AMOUR</b> : quand il est jouable, il devient le plus souvent le top du coup.",
      "Le premier coup passe toujours par la case centrale ★.",
    ],
  },
  grillerandom: {
    titre: "Grille random",
    points: [
      "Les <b>cases bonus sont redistribuées au hasard</b>.",
      "Le premier coup passe toujours par la case centrale ★.",
    ],
  },
  sablier: {
    titre: "Sablier",
    points: [
      "Le temps <b>diminue de 5 s à chaque coup</b> : 120 s au premier, 115 s au deuxième… jusqu'à 5 s minimum.",
    ],
  },
  gigogne: {
    titre: "Gigogne",
    points: [
      "Le tirage <b>grandit</b> : 2 lettres au coup 1, 3 au coup 2… (coup n → n+1 lettres).",
      "Tu peux poser <b>toutes</b> les lettres du tirage.",
      "Primes de scrabble progressives : <b>50 à 7 lettres, puis +25 par lettre</b> (75, 100, 125…).",
    ],
  },
  anglaise: {
    titre: "À l'anglaise",
    points: [
      "Mots <b>français</b> (ODS), mais <b>sac et valeurs du Scrabble anglais</b> : K 5, W 4, Y 4, H 4, V 4, J 8, X 8, Q 10, Z 10, D 2, G 2…",
    ],
  },
  lettrecachee: {
    titre: "Lettre cachée",
    points: [
      "Après chaque coup, <b>un jeton déjà posé est retourné</b> : tu ne vois plus sa lettre.",
      "Il reste en place, <b>jouable et compté</b> normalement : à toi de t'en souvenir.",
    ],
  },
  voyelles: {
    titre: "Voyelles",
    points: [
      "Seules les <b>voyelles</b> des tirages sont fournies.",
      "Tu choisis les <b>consonnes de ton choix</b>, mais le tirage doit toujours compter <b>7 lettres</b> (voyelles incluses) et les consonnes doivent être <b>disponibles dans le sac</b>.",
      "Le <b>Y</b> est une consonne.",
    ],
  },
  invasion: {
    titre: "Invasion 🕷️",
    points: [
      "Des <b>araignées</b> envahissent la grille, de plus en plus vite, et celles qu'on laisse vivre <b>pondent</b>.",
      "Une araignée <b>cache la case</b> qu'elle occupe et empêche d'y poser une lettre.",
      "<b>Clique</b> pour l'écraser — ou garde le bouton enfoncé et <b>balaie</b> la grille comme avec un pulvérisateur.",
      "Si elles recouvrent <b>tout le plateau</b>, la partie est perdue. La pause les fige.",
    ],
  },
  puzzle: {
    titre: "Grille puzzle 🧩",
    sansPied: true,
    points: [
      "Une grille finale a été <b>découpée en pièces</b> mélangées à droite.",
      "<b>Glisse</b> chaque pièce à sa place sur la grille vide (pas de rotation). Clic droit sur une pièce posée : elle retourne dans la réserve.",
      "Range les pièces où tu veux autour de la grille, même en dessous.",
      "Le chrono s'arrête quand la grille est entièrement reconstituée.",
      "Jigsaw rapporte jusqu'à <b>500 points</b> : 250 pour la grille reconstituée, 250 pour le temps (−3 points par minute de retard sur le plus rapide).",
      "« Abandonner » : pas de points de résolution, mais si tu as cherché <b>au moins 15 minutes</b>, ton essai rapporte de 125 à 200 points (200 à partir de 30 minutes).",
    ],
  },
};

/** Fenêtre des règles. `parent` : élément où l'insérer ; renvoie une promesse
 *  résolue à la fermeture. */
export function afficheRegles(cle, titre = null, origine = null, retour = null, texteOk = "C'est parti !") {
  const r = REGLES[cle];
  if (!r) return Promise.resolve();
  return new Promise(ok => {
    const fond = document.createElement("div");
    fond.className = "regles-fond";
    fond.innerHTML = `<div class="regles-boite" role="dialog" aria-modal="true" aria-labelledby="reglesTitre">
        <div class="regles-sur">${titre ? "Le tournoi de la Mort" : "Formule superoriginale"}</div>
        <h2 id="reglesTitre">${titre || r.titre}${origine ? ` <small class="regles-origine">${origine}</small>` : ""}</h2>
        <ul>${r.points.map(p => `<li>${p}</li>`).join("")}</ul>
        ${r.sansPied ? "" : '<p class="regles-pied">Le reste : règles habituelles du topping.</p>'}
        ${titre ? '<p class="regles-mort">⏸ <b>Pause</b> : demande-la quand tu veux, elle commence à la fin du coup en cours (top trouvé ou temps écoulé). En pause, tu peux quitter et revenir plus tard.<br>⚠️ Changer d\'onglet n\'arrête pas le chrono, et <b>quitter la partie en cours de coup</b> la fait considérer comme <b>abandonnée</b>.</p>' : ""}
        <div class="regles-boutons">${retour ? '<button type="button" class="regles-retour">← Retour aux parties</button>' : ""}<button type="button" class="regles-ok">${texteOk}</button></div>
      </div>`;
    const ferme = () => { fond.remove(); document.removeEventListener("keydown", clavier, true); ok(); };
    const clavier = e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ferme(); } };
    fond.querySelector(".regles-ok").onclick = ferme;
    // « Retour » : on repart vers la liste sans avoir lancé la partie (rien n'est enregistré).
    const btnRetour = fond.querySelector(".regles-retour");
    if (btnRetour) btnRetour.onclick = () => { location.href = retour; };
    document.addEventListener("keydown", clavier, true);
    document.body.appendChild(fond);
    fond.querySelector(".regles-ok").focus();
  });
}
