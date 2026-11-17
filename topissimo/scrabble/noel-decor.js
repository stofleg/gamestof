// ============================================================
//  Décor de Noël dessiné en SVG (aucun fichier) : paysage enneigé en bas de l'écran
//  (sapins, chalet éclairé, lutins, pile de cadeaux, père Noël qui salue, renne au nez rouge),
//  lune et étoiles qui scintillent, et de temps en temps le traîneau du père Noël tiré par
//  ses rennes qui traverse le ciel. Tout reste derrière le jeu (pointer-events: none).
// ============================================================
const PEAU = "#f6cfae", JOUES = "#f29a8c", ROUGE = "#c8102e", ROUGE2 = "#9e0d24", OR = "#e8c35a", VERT = "#1f7a45", VERT2 = "#14532f";
const BRUN = "#8a5a2b", BRUN2 = "#6b421c", BOIS = "#5b3a1a";

/** Sapin (origine : pied du tronc). */
function sapin(x, y, h, lumieres = true) {
  const w = h * .62, etages = [[0, 1], [.28, .78], [.52, .56]];
  let s = `<g transform="translate(${x} ${y})"><rect x="${-h * .05}" y="${-h * .12}" width="${h * .1}" height="${h * .12}" fill="${BOIS}"/>`;
  for (const [d, k] of etages) {
    const base = -h * .1 - d * h, haut = base - h * .42 * (k + .25), demi = w / 2 * k;
    s += `<path d="M${-demi} ${base} L0 ${haut} L${demi} ${base} Q0 ${base - h * .05} ${-demi} ${base}Z" fill="${VERT2}"/>`;
    s += `<path d="M${-demi * .55} ${base - (base - haut) * .45} L0 ${haut} L${demi * .55} ${base - (base - haut) * .45} Q${demi * .2} ${base - (base - haut) * .38} 0 ${base - (base - haut) * .48} Q${-demi * .2} ${base - (base - haut) * .38} ${-demi * .55} ${base - (base - haut) * .45}Z" fill="#f4f8ff"/>`;
    if (lumieres) for (let i = 0; i < 4; i++) {
      const t = (i + .5) / 4, lx = (-demi + 2 * demi * t) * .8, ly = base - h * .04 - Math.abs(lx) * .15;
      s += `<circle class="nd-lum" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${(h * .022).toFixed(1)}" fill="${["#ff4d4d", "#ffd23f", "#4dabff", "#ff8ad8"][i]}" style="animation-delay:${(i * .4 + x % 3 * .3).toFixed(2)}s"/>`;
    }
  }
  return s + `<path d="M0 ${-h * 1.02} l${h * .035} ${h * .07} l${h * .075} 0 l${-h * .06} ${h * .045} l${h * .025} ${h * .075} l${-h * .075} ${-h * .045} l${-h * .075} ${h * .045} l${h * .025} ${-h * .075} l${-h * .06} ${-h * .045} l${h * .075} 0z" fill="${OR}" transform="translate(0 ${-h * .035})"/></g>`;
}
/** Paquet cadeau (origine : bas à gauche). */
function cadeau(x, y, w, h, fond, ruban) {
  return `<g transform="translate(${x} ${y})">
    <rect x="0" y="${-h}" width="${w}" height="${h}" rx="2" fill="${fond}"/>
    <rect x="0" y="${-h}" width="${w}" height="${h * .14}" fill="#000" opacity=".12"/>
    <rect x="${w / 2 - w * .07}" y="${-h}" width="${w * .14}" height="${h}" fill="${ruban}"/>
    <rect x="0" y="${-h * .58}" width="${w}" height="${h * .13}" fill="${ruban}"/>
    <path d="M${w / 2} ${-h} c${-w * .32} ${-h * .42} ${-w * .42} ${h * .05} 0 0 c${w * .42} ${h * .05} ${w * .32} ${-h * .42} 0 0z" fill="${ruban}" stroke="${ruban}" stroke-width="2"/>
  </g>`;
}
/** Lutin (origine : entre les pieds). `porte` : tient un cadeau au-dessus de la tête. */
function lutin(x, y, k = 1, { chapeau = ROUGE, tunique = VERT, porte = null, sens = 1 } = {}) {
  const bras = porte
    ? `<path d="M-9 -44 L-13 -66" stroke="${tunique}" stroke-width="6" stroke-linecap="round"/><path d="M9 -44 L13 -66" stroke="${tunique}" stroke-width="6" stroke-linecap="round"/>${cadeau(-17, -68, 34, 22, porte[0], porte[1])}`
    : `<g class="nd-salut"><path d="M9 -44 L22 -58" stroke="${tunique}" stroke-width="6" stroke-linecap="round"/><circle cx="23" cy="-60" r="4" fill="${PEAU}"/></g><path d="M-9 -44 L-15 -30" stroke="${tunique}" stroke-width="6" stroke-linecap="round"/><circle cx="-15.5" cy="-28" r="3.6" fill="${PEAU}"/>`;
  return `<g class="nd-lutin" transform="translate(${x} ${y}) scale(${k * sens} ${k})">
    <rect x="-8" y="-24" width="5.5" height="20" fill="url(#ndRayures)"/><rect x="2.5" y="-24" width="5.5" height="20" fill="url(#ndRayures)"/>
    <path d="M-10 -4 h8 v4 h-6 q-6 0 -6 -6z" fill="${VERT2}"/><path d="M2 -4 h8 q4 0 6 -5 q1 5 -4 9 h-10z" fill="${VERT2}"/>
    <path d="M-12 -24 L-9 -50 h18 L12 -24 q-12 5 -24 0z" fill="${tunique}"/>
    <rect x="-11" y="-32" width="22" height="4" fill="#222"/><rect x="-3" y="-33" width="6" height="6" fill="none" stroke="${OR}" stroke-width="1.6"/>
    <path d="M-10 -50 l4 5 l4 -5 l4 5 l4 -5 l4 5 l4 -5z" fill="${ROUGE}"/>
    ${bras}
    <path d="M-11 -62 l-7 -6 l4 9z M11 -62 l7 -6 l-4 9z" fill="${PEAU}"/>
    <circle cx="0" cy="-60" r="10.5" fill="${PEAU}"/>
    <circle cx="-5" cy="-57" r="2.4" fill="${JOUES}" opacity=".8"/><circle cx="5" cy="-57" r="2.4" fill="${JOUES}" opacity=".8"/>
    <circle cx="-3.6" cy="-62" r="1.3" fill="#2b1d12"/><circle cx="3.6" cy="-62" r="1.3" fill="#2b1d12"/>
    <path d="M-3.5 -56.5 q3.5 3 7 0" stroke="#7a2e1d" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M-11.5 -66 q4 -22 26 -19 q-6 4 -10 10 q-6 5 -16 9z" fill="${chapeau}"/>
    <rect x="-12.5" y="-69" width="25" height="5" rx="2.5" fill="#fff"/>
    <circle cx="15" cy="-84" r="3.6" fill="${OR}"/>
  </g>`;
}
/** Père Noël debout qui salue, sa hotte à côté (origine : entre les pieds). */
function pereNoel(x, y, k = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <path d="M-52 0 q-10 -40 6 -58 q14 -10 26 0 q12 22 4 58z" fill="${BRUN}"/>
    <path d="M-48 -56 q12 -8 26 -2" stroke="${BRUN2}" stroke-width="4" fill="none"/>
    ${cadeau(-50, -54, 16, 14, "#4dabff", "#fff")}${cadeau(-36, -58, 13, 18, VERT, OR)}
    <rect x="-15" y="-10" width="12" height="10" rx="3" fill="#1b1b1b"/><rect x="3" y="-10" width="12" height="10" rx="3" fill="#1b1b1b"/>
    <rect x="-14" y="-30" width="11" height="22" fill="${ROUGE2}"/><rect x="3" y="-30" width="11" height="22" fill="${ROUGE2}"/>
    <path d="M-24 -28 q-2 -40 8 -52 h32 q10 12 8 52z" fill="${ROUGE}"/>
    <path d="M-25 -30 h50 v7 h-50z" fill="#fff"/><rect x="-3" y="-80" width="6" height="50" fill="#fff"/>
    <rect x="-24" y="-48" width="48" height="7" fill="#1b1b1b"/><rect x="-6" y="-50" width="12" height="11" rx="1" fill="none" stroke="${OR}" stroke-width="2.4"/>
    <path d="M-17 -74 q-14 14 -10 34" stroke="${ROUGE}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="-27" cy="-38" r="5.5" fill="#1b1b1b"/>
    <g class="nd-salut-pn"><path d="M17 -74 q14 -8 20 -26" stroke="${ROUGE}" stroke-width="10" stroke-linecap="round" fill="none"/><rect x="31" y="-104" width="11" height="6" rx="3" fill="#fff" transform="rotate(-20 36 -101)"/><circle cx="38" cy="-108" r="6" fill="#1b1b1b"/></g>
    <circle cx="0" cy="-96" r="14" fill="${PEAU}"/>
    <path d="M-17 -96 q-2 26 17 34 q19 -8 17 -34 q-6 6 -17 6 q-11 0 -17 -6z" fill="#fff"/>
    <path d="M-10 -89 q5 -5 10 0 q5 -5 10 0 q-5 5 -10 1 q-5 4 -10 -1z" fill="#f1f1f1" stroke="#ddd" stroke-width=".6"/>
    <circle cx="0" cy="-92" r="3.6" fill="#e86a5c"/>
    <circle cx="-5.5" cy="-99" r="1.6" fill="#2b1d12"/><circle cx="5.5" cy="-99" r="1.6" fill="#2b1d12"/>
    <circle cx="-9" cy="-94" r="2.8" fill="${JOUES}" opacity=".7"/><circle cx="9" cy="-94" r="2.8" fill="${JOUES}" opacity=".7"/>
    <path d="M-9 -103 q4 -3 7 -1 M2 -104 q4 -2 7 1" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M-16 -106 q6 -26 30 -20 q10 4 12 16 q-8 -8 -14 -6 q-12 2 -28 10z" fill="${ROUGE}"/>
    <rect x="-17" y="-110" width="34" height="8" rx="4" fill="#fff"/><circle cx="27" cy="-109" r="6" fill="#fff"/>
  </g>`;
}
/** Renne debout, Rudolph au nez rouge (origine : sous les pattes). */
function renne(x, y, k = 1, { nez = true, sens = 1 } = {}) {
  return `<g transform="translate(${x} ${y}) scale(${k * sens} ${k})">
    <path d="M-30 0 l2 -28 M-20 0 l1 -28 M14 0 l-1 -28 M24 0 l1 -28" stroke="${BRUN2}" stroke-width="5" stroke-linecap="round"/>
    <path d="M-30 0 h4 M-20 0 h4 M14 0 h4 M24 0 h4" stroke="#2b1d12" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="-3" cy="-36" rx="34" ry="15" fill="${BRUN}"/>
    <ellipse cx="-3" cy="-30" rx="24" ry="7" fill="#c49461" opacity=".6"/>
    <path d="M-36 -42 q-8 -6 -4 2z" fill="#f4ead8"/>
    <path d="M20 -44 q6 -18 14 -26 l9 6 q-8 10 -12 26z" fill="${BRUN}"/>
    <path d="M18 -46 q8 6 18 -4" stroke="${ROUGE}" stroke-width="4" fill="none"/><circle cx="27" cy="-46" r="2.6" fill="${OR}"/>
    <path d="M32 -88 q-6 -10 -2 -18 M31 -95 q-7 -2 -10 -8 M40 -86 q4 -12 12 -16 M47 -96 q5 -3 4 -9" stroke="${BOIS}" stroke-width="3" stroke-linecap="round" fill="none"/>
    <ellipse cx="40" cy="-76" rx="11" ry="9" fill="${BRUN}"/>
    <ellipse cx="51" cy="-72" rx="8" ry="6" fill="#a8743f"/>
    <path d="M30 -82 q-8 -2 -10 -8 q8 0 12 4z" fill="${BRUN2}"/>
    <circle cx="42" cy="-80" r="1.8" fill="#1b1b1b"/>
    ${nez ? `<circle class="nd-nez" cx="58" cy="-73" r="4.6" fill="#ff2a2a"/>` : `<circle cx="58" cy="-73" r="3.6" fill="#2b1d12"/>`}
  </g>`;
}
/** Chalet éclairé, cheminée fumante (origine : bas à gauche). */
function chalet(x, y, k = 1) {
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <rect x="62" y="-104" width="14" height="30" fill="#7b3b2a"/><rect x="60" y="-108" width="18" height="6" fill="#fff"/>
    <g class="nd-fumee"><circle cx="69" cy="-118" r="6" fill="#dfe7f1" opacity=".55"/><circle cx="75" cy="-132" r="8" fill="#dfe7f1" opacity=".4"/><circle cx="70" cy="-148" r="10" fill="#dfe7f1" opacity=".25"/></g>
    <rect x="6" y="-62" width="98" height="62" fill="#8a4b2a"/>
    ${[0, 1, 2, 3, 4].map(i => `<line x1="6" x2="104" y1="${-12 * i - 6}" y2="${-12 * i - 6}" stroke="#6e3a1f" stroke-width="2"/>`).join("")}
    <path d="M-6 -60 L55 -108 L116 -60z" fill="#5a2e1a"/>
    <path d="M-10 -58 Q-2 -70 8 -66 L55 -112 L102 -66 Q112 -70 120 -58 Q110 -62 104 -58 Q96 -66 86 -60 Q76 -68 66 -62 Q56 -70 46 -62 Q36 -68 26 -60 Q16 -66 6 -58 Q-2 -64 -10 -58z" fill="#f4f8ff"/>
    <rect x="44" y="-36" width="22" height="36" rx="2" fill="#5a2e1a"/><circle cx="61" cy="-17" r="1.8" fill="${OR}"/>
    <path d="M47 -32 h16 v4 h-16z" fill="${VERT}"/><circle cx="55" cy="-26" r="5" fill="none" stroke="${VERT}" stroke-width="3"/><circle cx="55" cy="-21" r="1.6" fill="${ROUGE}"/>
    <rect class="nd-fenetre" x="14" y="-46" width="22" height="20" fill="#ffd36b"/><path d="M25 -46 v20 M14 -36 h22" stroke="#6e3a1f" stroke-width="2.4"/>
    <rect class="nd-fenetre" x="76" y="-46" width="22" height="20" fill="#ffd36b"/><path d="M87 -46 v20 M76 -36 h22" stroke="#6e3a1f" stroke-width="2.4"/>
    <path d="M12 -26 h26 v4 h-26z M74 -26 h26 v4 h-26z" fill="#f4f8ff"/>
  </g>`;
}
/** Renne en plein vol (pour le traîneau). */
function renneVol(x, y, nez) {
  return `<g transform="translate(${x} ${y})">
    <g class="nd-galop"><path d="M14 4 l12 6 M8 4 l10 9" stroke="${BRUN2}" stroke-width="3.4" stroke-linecap="round"/><path d="M-14 4 l-14 4 M-9 5 l-12 9" stroke="${BRUN2}" stroke-width="3.4" stroke-linecap="round"/></g>
    <ellipse cx="0" cy="0" rx="20" ry="8.5" fill="${BRUN}"/>
    <path d="M-20 -3 q-6 -4 -3 2z" fill="#f4ead8"/>
    <path d="M14 -4 q6 -10 12 -14 l5 5 q-6 6 -9 14z" fill="${BRUN}"/>
    <path d="M23 -24 q-3 -7 0 -12 M22 -28 q-5 -1 -7 -5 M28 -23 q3 -7 8 -9" stroke="${BOIS}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <ellipse cx="29" cy="-17" rx="7" ry="5.5" fill="${BRUN}"/><ellipse cx="35" cy="-15" rx="4.5" ry="3.6" fill="#a8743f"/>
    <circle cx="30" cy="-19" r="1.2" fill="#1b1b1b"/>
    ${nez ? `<circle class="nd-nez" cx="39" cy="-15.5" r="3" fill="#ff2a2a"/>` : ""}
    <path d="M10 -6 q6 4 12 -2" stroke="${ROUGE}" stroke-width="3" fill="none"/>
  </g>`;
}
/** Traîneau du père Noël tiré par 4 rennes (Rudolph en tête), avec traînée d'étoiles. */
function traineau() {
  return `<svg class="nd-traineau" viewBox="-40 -90 420 130" aria-hidden="true">
    <g class="nd-traine">${Array.from({ length: 9 }, (_, i) => `<circle cx="${-30 - i * 0}" cy="${10 + (i % 3) * 6 - 6}" r="${2.4 - i * .2}" fill="${OR}" style="animation-delay:${i * .12}s"/>`).join("")}</g>
    <path d="M78 6 L150 -8 L230 -8 L300 -12 L360 -18" stroke="${OR}" stroke-width="1.6" fill="none"/>
    ${renneVol(150, 0, false)}${renneVol(212, -4, false)}${renneVol(270, -8, false)}${renneVol(330, -14, true)}
    <path d="M10 -36 q-14 8 -4 30 h52" stroke="${BRUN2}" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M-10 -40 q-12 -18 6 -22 q20 -2 26 18z" fill="#7a4a22"/>
    ${cadeau(-4, -50, 14, 13, "#4dabff", "#fff")}${cadeau(8, -54, 12, 16, VERT, OR)}
    <path d="M0 -6 L-2 -36 q34 -12 66 -2 q14 4 18 14 q-6 18 -24 24z" fill="${ROUGE}"/>
    <path d="M2 -30 q30 -10 58 -2" stroke="${OR}" stroke-width="2.4" fill="none"/>
    <path d="M-6 12 h76 q16 0 18 -14" stroke="${OR}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path d="M10 -6 v18 M58 -6 v18" stroke="${OR}" stroke-width="2.6"/>
    <path d="M30 -40 q-2 -16 12 -18 q14 0 14 18z" fill="${ROUGE}"/>
    <circle cx="44" cy="-62" r="8" fill="${PEAU}"/>
    <path d="M35 -62 q0 14 9 18 q10 -4 10 -18 q-4 4 -10 4 q-6 0 -9 -4z" fill="#fff"/>
    <circle cx="48" cy="-63" r="1.2" fill="#2b1d12"/><circle cx="50" cy="-59" r="2" fill="#e86a5c"/>
    <path d="M36 -67 Q38 -84 52 -80 Q56 -76 54 -67z M38 -76 Q30 -82 25 -76 L30 -74z" fill="${ROUGE}"/><rect x="34" y="-70" width="22" height="5" rx="2.5" fill="#fff"/><circle cx="25" cy="-75" r="3.6" fill="#fff"/>
    <path d="M54 -46 q14 0 24 6" stroke="${ROUGE}" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

const DEFS = `<defs>
  <pattern id="ndRayures" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fff"/><rect width="6" height="3" fill="${ROUGE}"/></pattern>
  <linearGradient id="ndNeige" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfe0f2"/></linearGradient>
  <linearGradient id="ndNeige2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f1fb"/><stop offset="1" stop-color="#b8cde4"/></linearGradient>
</defs>`;

/** Paysage du bas : collines de neige sur toute la largeur + deux scènes ancrées aux coins. */
function paysage() {
  const fond = `<svg class="nd-collines" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">${DEFS}
    <path d="M0 70 Q150 30 320 62 T640 56 T960 48 T1200 60 V120 H0z" fill="url(#ndNeige2)"/>
    <path d="M0 92 Q200 64 420 88 T860 80 T1200 86 V120 H0z" fill="url(#ndNeige)"/></svg>`;
  const gauche = `<svg class="nd-scene nd-gauche" viewBox="0 0 420 200" aria-hidden="true">${DEFS}
    ${sapin(34, 176, 150)}${sapin(96, 182, 104, false)}
    ${chalet(118, 182, 1)}
    ${cadeau(250, 186, 34, 28, ROUGE, OR)}${cadeau(282, 186, 26, 38, VERT, "#fff")}${cadeau(262, 158, 22, 18, "#4dabff", "#fff")}${cadeau(306, 186, 22, 20, "#ff8ad8", ROUGE)}
    ${lutin(350, 188, 1.05, { porte: [ROUGE, OR] })}
    ${lutin(392, 190, .95, { chapeau: VERT, tunique: ROUGE, sens: -1 })}
    <path d="M0 186 Q120 170 230 184 T420 182 V200 H0z" fill="url(#ndNeige)"/></svg>`;
  const droite = `<svg class="nd-scene nd-droite" viewBox="0 0 420 200" aria-hidden="true">${DEFS}
    ${renne(70, 186, .95, { nez: true })}
    ${pereNoel(196, 188, 1.12)}
    ${lutin(262, 190, .9, { chapeau: ROUGE, tunique: VERT })}
    ${cadeau(282, 190, 30, 24, OR, ROUGE)}${cadeau(300, 190, 22, 32, ROUGE, "#fff")}
    ${sapin(352, 182, 130)}${sapin(404, 188, 96, false)}
    <path d="M0 184 Q140 172 260 186 T420 180 V200 H0z" fill="url(#ndNeige)"/></svg>`;
  return fond + gauche + droite;
}
function ciel() {
  let s = `<svg class="nd-ciel" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
    <defs><radialGradient id="ndLune"><stop offset="0" stop-color="#fffbe6" stop-opacity=".55"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient></defs>
    <circle cx="120" cy="120" r="90" fill="url(#ndLune)"/>
    <circle cx="120" cy="120" r="34" fill="#fdf6d8"/><circle cx="108" cy="110" r="6" fill="#efe4b8"/><circle cx="132" cy="132" r="4" fill="#efe4b8"/><circle cx="130" cy="106" r="3" fill="#efe4b8"/>`;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 1200, y = 40 + Math.random() * 240, r = .6 + Math.random() * 1.4;
    s += `<circle class="nd-etoile" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" style="animation-delay:${(Math.random() * 4).toFixed(2)}s"/>`;
  }
  return s + `</svg>`;
}

let racine = null, traine = null, volT = null;
/** Affiche ou retire le décor. */
export function decor(on) {
  if (!on) { clearTimeout(volT); racine?.remove(); traine?.remove(); racine = traine = null; return; }
  if (racine) return;
  racine = document.createElement("div");
  racine.className = "noel-decor"; racine.setAttribute("aria-hidden", "true");
  racine.innerHTML = ciel() + paysage();
  document.body.prepend(racine);
  // le traîneau, devant le jeu, ne passe que pour fêter un scrabble (voir traineauPasse)
  const tmp = document.createElement("div"); tmp.innerHTML = traineau();
  traine = tmp.firstElementChild; document.body.appendChild(traine);
}
/** Le traîneau du père Noël traverse le ciel (scrabble !) ; renvoie la durée du passage en ms. */
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
  .noel-decor { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
  .nd-ciel { position: absolute; left: 0; top: 0; width: 100%; height: 45vh; }
  .nd-etoile { animation: ndScintille 3s ease-in-out infinite alternate; }
  @keyframes ndScintille { from { opacity: .25; } to { opacity: 1; } }
  .nd-collines { position: absolute; left: 0; right: 0; bottom: 0; width: 100%; height: clamp(50px, 9vh, 110px); }
  .nd-scene { position: absolute; bottom: 0; width: clamp(220px, 31vw, 470px); height: auto; }
  .nd-gauche { left: 0; } .nd-droite { right: 0; }
  .nd-lum { animation: ndLum 1.6s ease-in-out infinite alternate; }
  @keyframes ndLum { from { opacity: 1; } to { opacity: .3; } }
  .nd-nez { animation: ndNez 1.2s ease-in-out infinite alternate; filter: drop-shadow(0 0 4px #ff3b3b); }
  @keyframes ndNez { from { opacity: 1; } to { opacity: .55; } }
  .nd-fenetre { animation: ndFenetre 4s ease-in-out infinite alternate; filter: drop-shadow(0 0 6px #ffcf5a); }
  @keyframes ndFenetre { from { fill: #ffd36b; } to { fill: #ffbf47; } }
  .nd-fumee { animation: ndFumee 5s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
  @keyframes ndFumee { 0% { transform: translateY(4px); opacity: .6; } 100% { transform: translateY(-10px) scale(1.15); opacity: 1; } }
  .nd-salut { transform-box: fill-box; transform-origin: 0 100%; animation: ndSalut 1.2s ease-in-out infinite alternate; }
  @keyframes ndSalut { from { transform: rotate(-12deg); } to { transform: rotate(18deg); } }
  .nd-salut-pn { transform-box: fill-box; transform-origin: 0 100%; animation: ndSalutPn 1s ease-in-out infinite alternate; }
  @keyframes ndSalutPn { from { transform: rotate(-8deg); } to { transform: rotate(14deg); } }
  .nd-lutin { animation: ndSaute 2.4s ease-in-out infinite; }
  .nd-scene .nd-lutin:nth-of-type(2n) { animation-delay: .8s; }
  @keyframes ndSaute { 0%, 70%, 100% { translate: 0 0; } 80% { translate: 0 -6px; } 90% { translate: 0 0; } }
  .nd-traineau { position: fixed; left: 0; z-index: 60; pointer-events: none; width: clamp(240px, 34vw, 460px); height: auto; transform: translateX(-120%); opacity: 0; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); }
  .nd-traineau.vole { animation: ndVol 7s linear forwards; }
  @media (prefers-reduced-motion: reduce) { .nd-traineau.vole { animation-duration: 3s !important; } }
  @keyframes ndVol { 0% { transform: translate(-120%, 30px) rotate(-4deg); opacity: 1; } 25% { transform: translate(25vw, -6px) rotate(-6deg); }
    50% { transform: translate(50vw, 12px) rotate(-3deg); } 75% { transform: translate(78vw, -8px) rotate(-6deg); } 100% { transform: translate(110vw, -30px) rotate(-8deg); opacity: 1; } }
  .nd-galop { transform-box: fill-box; transform-origin: 50% 0; animation: ndGalop .45s ease-in-out infinite alternate; }
  @keyframes ndGalop { from { transform: rotate(-14deg); } to { transform: rotate(14deg); } }
  .nd-traine circle { animation: ndTraine 1s linear infinite; }
  @keyframes ndTraine { from { transform: translate(0, 0); opacity: 1; } to { transform: translate(-40px, 6px); opacity: 0; } }
  @media (max-width: 860px) { .nd-scene { width: 46vw; } .nd-ciel { height: 30vh; } }
`;
