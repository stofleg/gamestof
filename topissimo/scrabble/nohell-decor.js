// ============================================================
//  Décor « No Hell ! » (l'ambiance de Noël version metal), dessiné en SVG (aucun fichier) :
//  ciel rouge sang et lune de sang, rochers et lave en bas de l'écran ; à gauche une pile
//  d'amplis et un sapin calciné aux boules de braise ; à droite le père Noël en blouson clouté qui
//  joue d'une guitare en V, un renne aux yeux rouges et des lutins qui headbanguent, cornes levées.
//  Au scrabble, le traîneau en flammes tiré par des rennes squelettes traverse le ciel.
//  Tout reste derrière le jeu (pointer-events: none).
// ============================================================
const PEAU = "#f1c7a6", ROUGE = "#b3121f", ROUGE2 = "#7c0a13", NOIR = "#141116", CUIR = "#211d24", ACIER = "#b9c1ca";
const FEU = "#ff6a00", FEU2 = "#ffb300", OS = "#efe6d2", BOIS = "#2a1a12";

/** Flamme (origine : base), animée. */
const flamme = (x, y, h, delai = 0) => `<g class="nh-flamme" style="animation-delay:${delai}s" transform="translate(${x} ${y})">
  <path d="M0 0 C${-h * .45} ${-h * .1} ${-h * .32} ${-h * .55} ${-h * .05} ${-h} C${-h * .02} ${-h * .62} ${h * .26} ${-h * .55} ${h * .2} ${-h * .78} C${h * .46} ${-h * .5} ${h * .42} ${-h * .1} 0 0z" fill="${FEU}"/>
  <path d="M0 0 C${-h * .22} ${-h * .08} ${-h * .18} ${-h * .34} 0 ${-h * .6} C${h * .2} ${-h * .36} ${h * .2} ${-h * .1} 0 0z" fill="${FEU2}"/></g>`;
/** Petite tête de mort (ornement). */
const crane = (x, y, r) => `<g transform="translate(${x} ${y})"><path d="M${-r} 0 a${r} ${r} 0 1 1 ${r * 2} 0 v${r * .45} h${-r * .4} v${r * .35} h${-r * 1.2} v${-r * .35} h${-r * .4}z" fill="${OS}"/>
  <circle cx="${-r * .38}" cy="${r * .05}" r="${r * .28}" fill="${NOIR}"/><circle cx="${r * .38}" cy="${r * .05}" r="${r * .28}" fill="${NOIR}"/></g>`;

/** Sapin calciné : silhouette noire, boules de braise qui rougeoient, flamme au sommet. */
function sapinNoir(x, y, h) {
  const w = h * .62;
  let s = `<g transform="translate(${x} ${y})"><rect x="${-h * .05}" y="${-h * .12}" width="${h * .1}" height="${h * .12}" fill="${BOIS}"/>`;
  for (const [d, k] of [[0, 1], [.28, .78], [.52, .56]]) {
    const base = -h * .1 - d * h, haut = base - h * .42 * (k + .25), demi = w / 2 * k;
    s += `<path d="M${-demi} ${base} L${-demi * .7} ${base - h * .06} L0 ${haut} L${demi * .7} ${base - h * .06} L${demi} ${base} L${demi * .5} ${base - h * .03} L${demi * .2} ${base + h * .01} L${-demi * .3} ${base - h * .03}Z" fill="#1d1a1c" stroke="#3a1712" stroke-width="1.5"/>`;
    for (let i = 0; i < 4; i++) {
      const t = (i + .5) / 4, lx = (-demi + 2 * demi * t) * .78, ly = base - h * .05 - Math.abs(lx) * .12;
      s += i === 1 && k === 1 ? crane(lx, ly - h * .02, h * .03) : `<circle class="nh-braise" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${(h * .024).toFixed(1)}" fill="${[FEU, "#ff2d1a", FEU2, "#ff4d00"][i]}" style="animation-delay:${(i * .37 + x % 5 * .2).toFixed(2)}s"/>`;
    }
  }
  return s + flamme(0, -h * 1.0, h * .2, .3) + `</g>`;
}
/** Pile d'amplis (origine : bas à gauche). */
function amplis(x, y, k = 1) {
  const baffle = (bx, by, w, hh) => `<rect x="${bx}" y="${by}" width="${w}" height="${hh}" rx="3" fill="${NOIR}" stroke="#3b3640" stroke-width="2"/>
    <rect x="${bx + 5}" y="${by + 5}" width="${w - 10}" height="${hh - 10}" fill="url(#nhGrille)"/>
    ${[[.3, .3], [.7, .3], [.3, .72], [.7, .72]].map(([a, b]) => `<circle cx="${bx + w * a}" cy="${by + hh * b}" r="${Math.min(w, hh) * .17}" fill="#0b0a0c" stroke="#2e2a31" stroke-width="2"/>`).join("")}`;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    ${baffle(0, -74, 86, 74)}${baffle(0, -148, 86, 74)}
    <rect x="-2" y="-176" width="90" height="28" rx="3" fill="${CUIR}" stroke="#3b3640" stroke-width="2"/>
    ${[0, 1, 2, 3, 4, 5].map(i => `<circle cx="${12 + i * 12}" cy="-158" r="3" fill="${ACIER}"/>`).join("")}
    <rect x="16" y="-173" width="54" height="9" rx="2" fill="${ROUGE}"/><text x="43" y="-165.6" font-family="Impact, 'Arial Black', sans-serif" font-size="8" fill="#fff" text-anchor="middle" letter-spacing=".6">NO HELL</text>
    <circle class="nh-braise" cx="80" cy="-158" r="2.6" fill="#ff2d1a"/>
  </g>`;
}
/** Guitare en V (origine : milieu du corps). */
const guitareV = (rot = -28) => `<g transform="rotate(${rot})">
  <path d="M-34 -16 L6 -2 L-34 14 L-26 0z" fill="${ROUGE}" stroke="${ROUGE2}" stroke-width="2"/>
  <path d="M-30 -10 L0 -1 L-30 9" fill="none" stroke="#fff" stroke-width="1.6" opacity=".6"/>
  <rect x="0" y="-3.2" width="62" height="6.4" rx="1.5" fill="${BOIS}"/><rect x="58" y="-5" width="14" height="10" rx="2" fill="${NOIR}"/>
  ${[8, 16, 24, 32, 40, 48].map(f => `<line x1="${f}" y1="-3" x2="${f}" y2="3" stroke="${ACIER}" stroke-width="1"/>`).join("")}
  <rect x="-18" y="-4" width="4" height="8" fill="${ACIER}"/><rect x="-11" y="-4" width="4" height="8" fill="${ACIER}"/></g>`;
/** Père Noël metal : blouson clouté, lunettes noires, guitare en V ; il headbangue. */
function pereNoelMetal(x, y, k = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <rect x="-15" y="-10" width="12" height="10" rx="3" fill="${NOIR}"/><rect x="3" y="-10" width="12" height="10" rx="3" fill="${NOIR}"/>
    <rect x="-14" y="-30" width="11" height="22" fill="#1b1d2a"/><rect x="3" y="-30" width="11" height="22" fill="#1b1d2a"/>
    <path d="M-24 -28 q-2 -40 8 -52 h32 q10 12 8 52z" fill="${ROUGE}"/>
    <path d="M-25 -30 q-1 -38 9 -50 l10 4 l-4 46z M25 -30 q1 -38 -9 -50 l-10 4 l4 46z" fill="${CUIR}"/>
    ${[-20, -14, 14, 20].flatMap(cx => [-70, -60, -50, -40].map(cy => `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${ACIER}"/>`)).join("")}
    <rect x="-24" y="-34" width="48" height="6" fill="${NOIR}"/><path d="M-6 -36 h12 v10 h-12z" fill="none" stroke="${ACIER}" stroke-width="2.2"/>
    <g transform="translate(-2 -46)">${guitareV(-24)}</g>
    <path d="M-18 -72 q-16 10 -18 28 q6 4 12 0" stroke="${CUIR}" stroke-width="10" stroke-linecap="round" fill="none"/>
    <g class="nh-gratte"><path d="M18 -72 q12 6 8 22 q-6 6 -18 4" stroke="${CUIR}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="7" cy="-46" r="5" fill="${PEAU}"/></g>
    <circle cx="-36" cy="-50" r="5" fill="${PEAU}"/>
    <g class="nh-headbang">
      <circle cx="0" cy="-96" r="14" fill="${PEAU}"/>
      <path d="M-17 -96 q-4 34 17 46 q21 -12 17 -46 q-6 6 -17 6 q-11 0 -17 -6z" fill="#f4f1ea"/>
      <path d="M-10 -89 q5 -5 10 0 q5 -5 10 0 q-5 5 -10 1 q-5 4 -10 -1z" fill="#e9e5dc" stroke="#cfc8bb" stroke-width=".6"/>
      <rect x="-12" y="-102" width="24" height="6" rx="2" fill="${NOIR}"/><path d="M-11 -101 l6 0 M3 -101 l6 0" stroke="#5a5a68" stroke-width="1.2"/>
      <path d="M-4 -82 q4 3 8 0" stroke="#7a2e1d" stroke-width="1.6" fill="none"/>
      <path d="M-16 -106 q6 -26 30 -20 q10 4 12 16 q-8 -8 -14 -6 q-12 2 -28 10z" fill="${ROUGE}"/>
      <rect x="-17" y="-110" width="34" height="8" rx="4" fill="${NOIR}"/>${[-12, -6, 0, 6, 12].map(cx => `<path d="M${cx - 2} -110 l2 -5 l2 5z" fill="${ACIER}"/>`).join("")}
      <circle cx="27" cy="-109" r="6" fill="${OS}"/>
    </g>
  </g>`;
}
/** Renne metal : pelage sombre, yeux rouges, collier clouté ; il headbangue. */
function renneMetal(x, y, k = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <path d="M-30 0 l2 -28 M-20 0 l1 -28 M14 0 l-1 -28 M24 0 l1 -28" stroke="#24161a" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="-3" cy="-36" rx="34" ry="15" fill="#3a2420"/>
    <path d="M20 -44 q6 -18 14 -26 l9 6 q-8 10 -12 26z" fill="#3a2420"/>
    <path d="M18 -46 q8 6 18 -4" stroke="${NOIR}" stroke-width="5" fill="none"/>${[22, 27, 32].map(cx => `<circle cx="${cx}" cy="-46" r="1.4" fill="${ACIER}"/>`).join("")}
    <g class="nh-headbang-r">
      <path d="M32 -88 q-8 -12 -4 -24 M30 -98 q-8 -2 -12 -10 M40 -86 q4 -14 14 -18 M50 -98 q6 -4 5 -11" stroke="#d9d0c0" stroke-width="3.4" stroke-linecap="round" fill="none"/>
      <ellipse cx="40" cy="-76" rx="11" ry="9" fill="#3a2420"/><ellipse cx="51" cy="-72" rx="8" ry="6" fill="#4d302a"/>
      <circle class="nh-oeil" cx="42" cy="-80" r="2.2" fill="#ff2a1a"/>
      <circle cx="58" cy="-73" r="3.6" fill="#1b0d0d"/>
    </g>
  </g>`;
}
/** Lutin metal : t-shirt noir, cornes du diable levées (🤘), il headbangue. */
function lutinMetal(x, y, k = 1, sens = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k * sens} ${k})">
    <rect x="-8" y="-24" width="5.5" height="20" fill="#1b1d2a"/><rect x="2.5" y="-24" width="5.5" height="20" fill="#1b1d2a"/>
    <path d="M-10 -4 h8 v4 h-10z M2 -4 h8 q4 0 4 4 h-12z" fill="${NOIR}"/>
    <path d="M-12 -24 L-9 -50 h18 L12 -24 q-12 5 -24 0z" fill="${NOIR}"/>
    <path d="M-5 -44 l5 6 l5 -6" stroke="${ROUGE}" stroke-width="2" fill="none"/>
    <g class="nh-cornes"><path d="M9 -46 L20 -66" stroke="${NOIR}" stroke-width="6" stroke-linecap="round"/><circle cx="21" cy="-68" r="4" fill="${PEAU}"/>
      <path d="M19 -70 l-1 -7 M23 -70 l1 -7" stroke="${PEAU}" stroke-width="2.2" stroke-linecap="round"/></g>
    <path d="M-9 -44 L-15 -30" stroke="${NOIR}" stroke-width="6" stroke-linecap="round"/><circle cx="-15.5" cy="-28" r="3.6" fill="${PEAU}"/>
    <g class="nh-headbang-l">
      <path d="M-11 -62 l-7 -6 l4 9z M11 -62 l7 -6 l-4 9z" fill="${PEAU}"/>
      <circle cx="0" cy="-60" r="10.5" fill="${PEAU}"/>
      <path d="M-11 -62 q-2 14 -6 20 M11 -62 q2 14 6 20 M-9 -66 q-4 16 -10 22" stroke="#2a1d16" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="-3.6" cy="-62" r="1.3" fill="#2b1d12"/><circle cx="3.6" cy="-62" r="1.3" fill="#2b1d12"/>
      <path d="M-3.5 -56 q3.5 3 7 0 z" fill="#7a2e1d"/>
      <path d="M-11.5 -66 q4 -22 26 -19 q-6 4 -10 10 q-6 5 -16 9z" fill="${ROUGE}"/>
      <rect x="-12.5" y="-69" width="25" height="5" rx="2.5" fill="${NOIR}"/><circle cx="15" cy="-84" r="3.6" fill="${ACIER}"/>
    </g>
  </g>`;
}
/** Renne squelette en plein vol (pour le traîneau). */
function renneSquelette(x, y) {
  return `<g transform="translate(${x} ${y})" stroke="${OS}" stroke-linecap="round" fill="none">
    <g class="nd-galop"><path d="M14 4 l12 6 M8 4 l10 9 M-14 4 l-14 4 M-9 5 l-12 9" stroke-width="2.6"/></g>
    <path d="M-18 0 h34" stroke-width="3"/>${[-12, -6, 0, 6, 12].map(cx => `<path d="M${cx} -6 v12" stroke-width="1.8"/>`).join("")}
    <path d="M16 -2 q6 -10 12 -14" stroke-width="2.6"/>
    <path d="M23 -24 q-3 -7 0 -12 M22 -28 q-5 -1 -7 -5 M28 -23 q3 -7 8 -9" stroke-width="2"/>
    <ellipse cx="31" cy="-16" rx="7" ry="4.6" fill="${OS}" stroke="none"/><circle cx="31" cy="-17" r="1.6" fill="#ff2a1a" stroke="none"/>
  </g>`;
}
/** Traîneau en flammes tiré par 4 rennes squelettes, traînée de feu. */
function traineau() {
  return `<svg class="nd-traineau nh-traineau" viewBox="-60 -90 440 130" aria-hidden="true">
    <g class="nh-traine">${Array.from({ length: 10 }, (_, i) => `<circle cx="-24" cy="${4 + (i % 3) * 6 - 6}" r="${3.4 - i * .25}" fill="${i % 2 ? FEU : FEU2}" style="animation-delay:${i * .1}s"/>`).join("")}</g>
    <path d="M78 6 L150 -8 L230 -8 L300 -12 L360 -18" stroke="${ACIER}" stroke-width="1.6" fill="none"/>
    ${renneSquelette(150, 0)}${renneSquelette(212, -4)}${renneSquelette(270, -8)}${renneSquelette(330, -14)}
    <path d="M0 -6 L-2 -36 q34 -12 66 -2 q14 4 18 14 q-6 18 -24 24z" fill="${NOIR}"/>
    <g transform="rotate(-90 0 -18)">${flamme(-8, -10, 30, 0)}${flamme(4, -6, 40, .2)}${flamme(18, -8, 34, .4)}${flamme(30, -10, 26, .1)}</g>
    ${flamme(14, -34, 22, .3)}${flamme(34, -38, 18, .6)}${flamme(56, -34, 20, .15)}
    <path d="M2 -30 q30 -10 58 -2" stroke="${FEU}" stroke-width="2.4" fill="none"/>${[10, 24, 38, 52].map(cx => `<circle cx="${cx}" cy="-20" r="2" fill="${ACIER}"/>`).join("")}
    <path d="M-6 12 h76 q16 0 18 -14" stroke="${ACIER}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path d="M10 -6 v18 M58 -6 v18" stroke="${ACIER}" stroke-width="2.6"/>
    <path d="M30 -40 q-2 -16 12 -18 q14 0 14 18z" fill="${CUIR}"/>
    <circle cx="44" cy="-62" r="8" fill="${PEAU}"/>
    <path d="M35 -62 q0 16 9 22 q10 -6 10 -22 q-4 4 -10 4 q-6 0 -9 -4z" fill="#f4f1ea"/>
    <rect x="38" y="-66" width="14" height="4" rx="1.5" fill="${NOIR}"/>
    <path d="M36 -67 Q38 -84 52 -80 Q56 -76 54 -67z M38 -76 Q30 -82 25 -76 L30 -74z" fill="${ROUGE}"/><rect x="34" y="-70" width="22" height="5" rx="2.5" fill="${NOIR}"/><circle cx="25" cy="-75" r="3.6" fill="${OS}"/>
    <g transform="translate(64 -50)"><path d="M0 0 l-6 -12 M5 0 l4 -12" stroke="${PEAU}" stroke-width="3.4" stroke-linecap="round"/><circle cx="2" cy="2" r="5" fill="${PEAU}"/></g>
    <path d="M54 -46 q8 -2 12 -4" stroke="${CUIR}" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

const DEFS = `<defs>
  <pattern id="nhGrille" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#1a171c"/><circle cx="2.5" cy="2.5" r="1" fill="#2c2830"/></pattern>
  <linearGradient id="nhRoche" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1416"/><stop offset="1" stop-color="#0d090b"/></linearGradient>
  <linearGradient id="nhLave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb300"/><stop offset=".5" stop-color="#ff4d00"/><stop offset="1" stop-color="#7c0a13"/></linearGradient>
</defs>`;

/** Paysage du bas : rochers fendus de lave sur toute la largeur + deux scènes ancrées aux coins. */
function paysage() {
  let flammes = "";
  for (let i = 0; i < 24; i++) flammes += flamme(25 + i * 50 + (i % 3) * 7, 120, 26 + (i * 37 % 5) * 6, (i * .23) % 1.6);
  const fond = `<svg class="nd-collines nh-collines" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">${DEFS}
    ${flammes}
    <path d="M0 74 L80 58 L150 70 L240 50 L320 66 L420 56 L520 72 L640 52 L760 68 L860 54 L960 70 L1080 52 L1200 64 V120 H0z" fill="url(#nhRoche)"/>
    <path class="nh-lave" d="M60 120 L90 96 L120 104 L150 86 M330 120 L350 98 L390 92 M600 120 L630 92 L660 100 L700 84 M900 120 L930 100 L980 96 M1120 120 L1140 94" stroke="url(#nhLave)" stroke-width="3" fill="none"/></svg>`;
  const sol = (d) => `<path d="${d}" fill="url(#nhRoche)"/>`;
  const gauche = `<svg class="nd-scene nd-gauche" viewBox="0 0 420 200" aria-hidden="true">${DEFS}
    ${amplis(8, 186, 1)}
    ${sapinNoir(150, 182, 150)}
    ${lutinMetal(232, 188, 1.05)}
    ${crane(276, 178, 7)}${crane(290, 182, 5)}
    ${lutinMetal(330, 190, .95, -1)}
    ${flamme(380, 188, 30, .4)}${flamme(400, 190, 22, .9)}
    ${sol("M0 184 L60 178 L130 186 L220 176 L300 186 L420 180 V200 H0z")}</svg>`;
  const droite = `<svg class="nd-scene nd-droite" viewBox="0 0 420 200" aria-hidden="true">${DEFS}
    ${renneMetal(70, 186, .95)}
    ${pereNoelMetal(196, 188, 1.12)}
    ${lutinMetal(262, 190, .9)}
    ${amplis(300, 186, .62)}
    ${sapinNoir(392, 186, 110)}
    ${sol("M0 182 L90 176 L170 188 L260 178 L340 188 L420 180 V200 H0z")}</svg>`;
  return fond + gauche + droite;
}
function ciel() {
  let s = `<svg class="nd-ciel" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
    <defs><radialGradient id="nhLune"><stop offset="0" stop-color="#ff3b1f" stop-opacity=".5"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>
    <circle cx="120" cy="120" r="96" fill="url(#nhLune)"/>
    <circle cx="120" cy="120" r="34" fill="#c3261b"/><circle cx="108" cy="110" r="6" fill="#a11d14"/><circle cx="132" cy="132" r="4" fill="#a11d14"/><circle cx="130" cy="106" r="3" fill="#a11d14"/>
    <path class="nh-nuage" d="M-40 60 q60 -30 120 0 q60 -24 120 4 q40 -14 80 6 v18 h-320z" fill="#3a0d12" opacity=".55"/>
    <path class="nh-nuage nh-nuage2" d="M700 40 q60 -30 120 0 q60 -24 120 4 q40 -14 80 6 v18 h-320z" fill="#3a0d12" opacity=".45"/>`;
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 1200, y = 40 + Math.random() * 240, r = .6 + Math.random() * 1.2;
    s += `<circle class="nd-etoile" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#ffb3a0" style="animation-delay:${(Math.random() * 4).toFixed(2)}s"/>`;
  }
  return s + `</svg>`;
}

let racine = null, traine = null, volT = null;
/** Affiche ou retire le décor. */
export function decor(on) {
  if (!on) { clearTimeout(volT); racine?.remove(); traine?.remove(); racine = traine = null; return; }
  if (racine) return;
  racine = document.createElement("div");
  racine.className = "noel-decor nh-decor"; racine.setAttribute("aria-hidden", "true");
  racine.innerHTML = ciel() + paysage();
  document.body.prepend(racine);
  const tmp = document.createElement("div"); tmp.innerHTML = traineau();
  traine = tmp.firstElementChild; document.body.appendChild(traine);
}
/** Le traîneau en flammes traverse le ciel (scrabble !) ; renvoie la durée du passage en ms. */
export function traineauPasse(duree = 7) {
  if (!traine) return 0;
  traine.style.animationDuration = `${duree}s`;
  traine.classList.remove("vole"); void traine.getBoundingClientRect();
  traine.style.top = `${8 + Math.random() * 14}vh`;
  traine.classList.add("vole");
  clearTimeout(volT); volT = setTimeout(() => traine?.classList.remove("vole"), duree * 1000 + 200);
  return duree * 1000;
}

export const CSS_DECOR = `
  .nh-flamme { transform-box: fill-box; transform-origin: 50% 100%; animation: nhFlamme .9s ease-in-out infinite alternate; }
  @keyframes nhFlamme { from { transform: scale(1, 1) skewX(-3deg); opacity: .95; } to { transform: scale(.88, 1.12) skewX(4deg); opacity: .8; } }
  .nh-braise { animation: nhBraise 1.3s ease-in-out infinite alternate; filter: drop-shadow(0 0 4px #ff4d00); }
  @keyframes nhBraise { from { opacity: 1; } to { opacity: .35; } }
  .nh-oeil { animation: nhBraise .9s ease-in-out infinite alternate; filter: drop-shadow(0 0 4px #ff2a1a); }
  .nh-lave { animation: nhBraise 2.2s ease-in-out infinite alternate; filter: drop-shadow(0 0 6px #ff4d00); }
  .nh-headbang { transform-box: fill-box; transform-origin: 50% 100%; animation: nhBang .5s ease-in-out infinite alternate; }
  .nh-headbang-l { transform-box: fill-box; transform-origin: 50% 100%; animation: nhBang .5s ease-in-out infinite alternate; animation-delay: .25s; }
  .nh-headbang-r { transform-box: fill-box; transform-origin: 0 100%; animation: nhBangR .5s ease-in-out infinite alternate; }
  @keyframes nhBang { from { transform: rotate(-6deg) translateY(-1px); } to { transform: rotate(14deg) translateY(2px); } }
  @keyframes nhBangR { from { transform: rotate(-4deg); } to { transform: rotate(16deg); } }
  .nh-gratte { transform-box: fill-box; transform-origin: 30% 10%; animation: nhGratte .25s ease-in-out infinite alternate; }
  @keyframes nhGratte { from { transform: rotate(-6deg); } to { transform: rotate(8deg); } }
  .nh-cornes { transform-box: fill-box; transform-origin: 0 100%; animation: nhCornes .5s ease-in-out infinite alternate; }
  @keyframes nhCornes { from { transform: rotate(-6deg); } to { transform: rotate(10deg) translateY(-2px); } }
  .nh-nuage { animation: nhNuage 40s linear infinite alternate; } .nh-nuage2 { animation-duration: 55s; }
  @keyframes nhNuage { from { transform: translateX(-30px); } to { transform: translateX(60px); } }
  .nh-traine circle { animation: nhTraine .7s linear infinite; }
  @keyframes nhTraine { from { transform: translate(0, 0) scale(1); opacity: 1; } to { transform: translate(-50px, -8px) scale(.4); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .nh-flamme, .nh-headbang, .nh-headbang-l, .nh-headbang-r, .nh-gratte, .nh-cornes, .nh-nuage { animation: none; } }
`;
