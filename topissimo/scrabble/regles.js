//  Règles des formules superoriginales, affichées à l'ouverture d'une partie.
//  Public : joueurs aguerris qui connaissent le topping par cœur — on ne décrit
//  QUE ce qui change par rapport à une partie normale.
export const REGLES = {
  "6lettres": {
    titre: "6 lettres",
    points: [
      "Tirages de <b>6 lettres</b> au lieu de 7.",
      "Pas de scrabble : <b>aucune prime de 50</b>, même en posant les 6 lettres.",
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
      "Le chrono s'arrête quand la grille est entièrement reconstituée.",
    ],
  },
};

/** Fenêtre des règles. `parent` : élément où l'insérer ; renvoie une promesse
 *  résolue à la fermeture. */
export function afficheRegles(cle, titre = null) {
  const r = REGLES[cle];
  if (!r) return Promise.resolve();
  return new Promise(ok => {
    const fond = document.createElement("div");
    fond.className = "regles-fond";
    fond.innerHTML = `<div class="regles-boite" role="dialog" aria-modal="true" aria-labelledby="reglesTitre">
        <div class="regles-sur">${titre ? "Le tournoi de la Mort" : "Formule superoriginale"}</div>
        <h2 id="reglesTitre">${titre || r.titre}</h2>
        <ul>${r.points.map(p => `<li>${p}</li>`).join("")}</ul>
        ${r.sansPied ? "" : '<p class="regles-pied">Le reste : règles habituelles du topping.</p>'}
        <button type="button" class="regles-ok">C'est parti !</button>
      </div>`;
    const ferme = () => { fond.remove(); document.removeEventListener("keydown", clavier, true); ok(); };
    const clavier = e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ferme(); } };
    fond.querySelector(".regles-ok").onclick = ferme;
    document.addEventListener("keydown", clavier, true);
    document.body.appendChild(fond);
    fond.querySelector(".regles-ok").focus();
  });
}
