// Compositeur de pièces originales « esprit de Noël » : forme A A' B A', thème et réponse,
// motif rythmique repris, séquence harmonique, cadences (demi-cadence puis cadence parfaite).
const NOMS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const nom = m => NOMS[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 11];
const DEG = {
  I: [0, ""], Imaj7: [0, "maj7"], ii: [2, "m"], iii: [4, "m"], IV: [5, ""], iv: [5, "m"], V: [7, ""], V7: [7, "7"], vi: [9, "m"],
  II7: [2, "7"], VI7: [9, "7"], III7: [4, "7"], bVII: [10, ""],
  i: [0, "m"], III: [3, ""], VI: [8, ""], VII: [10, ""], iio: [2, "dim"],
};
const QINT = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6] };
const PROG_MAJ = [
  ["I", "vi", "IV", "V", "I", "vi", "II7", "V7"],
  ["I", "IV", "I", "V", "I", "IV", "ii", "V7"],
  ["I", "III7", "IV", "iv", "I", "VI7", "II7", "V7"],
  ["I", "V", "vi", "III7", "IV", "I", "ii", "V7"],
  ["Imaj7", "vi", "ii", "V7", "Imaj7", "vi", "II7", "V7"],
  ["I", "I", "IV", "I", "I", "VI7", "II7", "V7"],
];
const PROG_B_MAJ = [
  ["IV", "IV", "I", "I", "II7", "II7", "V", "V7"],
  ["vi", "vi", "iii", "iii", "IV", "IV", "II7", "V7"],
  ["IV", "V", "iii", "vi", "ii", "II7", "V", "V7"],
  ["iv", "iv", "I", "VI7", "ii", "II7", "V", "V7"],
];
const PROG_MIN = [["i", "iv", "V", "i", "VI", "iv", "V", "V7"], ["i", "VII", "VI", "V", "i", "iv", "iio", "V7"], ["i", "i", "iv", "i", "VI", "III", "iv", "V7"]];
const PROG_B_MIN = [["III", "VII", "i", "VI", "iv", "i", "V", "V7"], ["VI", "VI", "III", "III", "iv", "iv", "V", "V7"]];
const RYT = {
  4: { m: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, .5, 1, 1], [1, .5, .5, 1, 1], [.5, .5, 1, .5, .5, 1], [1.5, .5, 2], [1, 1, 1.5, .5]], demi: [[2, 2], [3, 1], [1, 1, 2]], fin: [[4], [2, 2]] },
  3: { m: [[1, 1, 1], [2, 1], [1.5, .5, 1], [1, .5, .5, 1], [.5, .5, 1, 1]], demi: [[2, 1], [3]], fin: [[3]] },
  6: { m: [[3, 1, 2], [2, 1, 2, 1], [3, 3], [1, 1, 1, 3], [2, 1, 3], [3, 2, 1]], demi: [[3, 3], [6]], fin: [[6]] },
};
const RYT_LENT = { 4: { m: [[2, 2], [3, 1], [2, 1, 1], [4]], demi: [[4]], fin: [[4]] }, 3: { m: [[2, 1], [3], [1, 1, 1]], demi: [[3]], fin: [[3]] }, 6: { m: [[3, 3], [6], [3, 1, 2]], demi: [[6]], fin: [[6]] } };

export function compose(graine, { metre = 4, tonique = 0, mineur = false, lent = false } = {}) {
  let s = graine >>> 0;
  const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const choix = a => a[Math.floor(r() * a.length)];
  const gamme = mineur ? MIN : MAJ;
  const base = 60 + tonique > 65 ? 48 + tonique : 60 + tonique;   // tonique entre F3 et F4… puis mélodie au-dessus
  const bas = base + 2, haut = base + 19;
  const dansGamme = p => gamme.includes(((p - tonique) % 12 + 12) % 12);
  const pas = (p, k) => { let q = p; const dir = Math.sign(k); for (let i = 0; i < Math.abs(k); i++) { q += dir; while (!dansGamme(q)) q += dir; } return q; };
  const tonsAccord = (deg, lo, hi) => { const [o, q] = DEG[deg]; const pcs = QINT[q].map(i => (tonique + o + i) % 12); const out = []; for (let n = lo; n <= hi; n++) if (pcs.includes(n % 12)) out.push(n); return out; };
  const nomAccord = deg => { const [o, q] = DEG[deg]; return NOMS[(tonique + o) % 12].replace("A#", "Bb").replace("D#", "Eb").replace("G#", "Ab") + q; };
  const R = (lent ? RYT_LENT : RYT)[metre];

  // une mesure : rythme + accord + direction ; renvoie les hauteurs
  const gammeLocale = deg => {
    const [o, q] = DEG[deg], ch = QINT[q].map(i => (tonique + o + i) % 12);
    let pcs = gamme.map(i => (tonique + i) % 12);
    for (const c of ch) if (!pcs.includes(c)) pcs = pcs.filter(x => Math.min((x - c + 12) % 12, (c - x + 12) % 12) > 1).concat(c);
    return pcs;
  };
  const pasLocal = (p, k, deg) => { const pcs = gammeLocale(deg); let q = p; const dir = Math.sign(k); for (let i = 0; i < Math.abs(k); i++) { q += dir; while (!pcs.includes(((q % 12) + 12) % 12)) q += dir; } return q; };
  const mesure = (deg, rythme, depart, dir, finTonique = false) => {
    const out = []; let p = depart, pos = 0;
    rythme.forEach((d, i) => {
      const fort = pos === 0 || (metre === 4 && pos === 2) || (metre === 6 && pos === 3);
      if (finTonique && i === rythme.length - 1) {
        const ts = tonsAccord("I", bas, haut).filter(n => (n - tonique) % 12 === 0);
        p = ts.reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a, ts[0]);
      } else if (fort) {
        const ts = tonsAccord(deg, bas, haut);
        const vise = p + dir * (1 + Math.floor(r() * 3));
        p = ts.reduce((a, b) => Math.abs(b - vise) < Math.abs(a - vise) ? b : a, ts[0]);
      } else {
        const k = (r() < .78 ? dir : -dir) * (r() < .8 ? 1 : 2);
        p = pasLocal(p, k, deg);
        if (p > haut) p = pasLocal(p, -2, deg); if (p < bas) p = pasLocal(p, 2, deg);
        // note longue à un demi-ton d'un ton de l'accord : on la pose sur le ton le plus proche
        if (d >= 1) { const ts = tonsAccord(deg, bas, haut); if (ts.some(t => Math.abs(t - p) === 1)) p = ts.reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a, ts[0]); }
      }
      out.push([p, d]); pos += d;
    });
    return out;
  };
  // une phrase de 8 mesures : motifs repris (mesures 1,3,5 / 2,6), séquence 5-6 = 1-2 sur l'accord
  const phrase = (prog, depart, contours, cadence, motifs) => {
    const [M1, M2, M3] = motifs;
    const mes = [];
    let p = depart;
    for (let k = 0; k < 8; k++) {
      const deg = Array.isArray(prog[k]) ? prog[k][0] : prog[k];
      let ry = k === 7 ? (cadence === "fin" ? choix(R.fin) : choix(R.demi)) : k === 3 ? choix(R.demi) : [0, 2, 4].includes(k) ? M1 : [1, 5].includes(k) ? M2 : M3;
      let notes;
      if ((k === 4 || k === 5) && mes[k - 4] && !lent) {
        // séquence : on reprend le contour des mesures 1-2, recalé sur un ton de l'accord
        const modele = mes[k - 4], ts = tonsAccord(deg, bas, haut);
        const d0 = ts.reduce((a, b) => Math.abs(b - (modele[0][0] + (k === 4 ? 2 : 2))) < Math.abs(a - (modele[0][0] + 2)) ? b : a, ts[0]);
        const ecart = d0 - modele[0][0];
        const pcs = gammeLocale(deg);
        notes = modele.map(([q, d], i) => { let n = q + ecart; if (!pcs.includes(((n % 12) + 12) % 12)) n = pasLocal(n, 1, deg); if (i === 0) n = d0; n = Math.max(bas, Math.min(haut, n)); if (!pcs.includes(((n % 12) + 12) % 12)) n = pasLocal(n, -1, deg); return [n, d]; });
      } else notes = mesure(deg, ry, p, contours[k], k === 7 && cadence === "fin");
      if (k === 7 && cadence !== "fin") { // demi-cadence : finir sur un ton de V
        const ts = tonsAccord(Array.isArray(prog[7]) ? prog[7][1] : prog[7], bas, haut), q = notes[notes.length - 1][0];
        notes[notes.length - 1][0] = ts.reduce((a, b) => Math.abs(b - q) < Math.abs(a - q) ? b : a, ts[0]);
      }
      mes.push(notes); p = notes[notes.length - 1][0];
    }
    return mes;
  };

  const progA = choix(mineur ? PROG_MIN : PROG_MAJ);
  const progB = choix(mineur ? PROG_B_MIN : PROG_B_MAJ);
  const progAfin = [...progA.slice(0, 6), mineur ? "iv" : "ii", mineur ? "V7" : "V7"];
  const cadFin = [...progA.slice(0, 6), [mineur ? "iv" : "ii", "V7"], mineur ? "i" : "I"];
  const motifsA = [choix(R.m), choix(R.m), choix(R.m)], motifsB = [choix(R.m), choix(R.m), choix(R.m)];
  const A = phrase(progAfin, base + 4 + Math.floor(r() * 5), [1, 1, -1, -1, 1, 1, -1, -1], "demi", motifsA);
  // A' : les six premières mesures de A, puis cadence vers la tonique
  const Afin = phrase(cadFin, A[5][A[5].length - 1][0], [1, 1, -1, -1, 1, 1, -1, -1], "fin", motifsA);
  const Ap = [...A.slice(0, 6), Afin[6], Afin[7]];
  const B = phrase(progB, base + 9 + Math.floor(r() * 4), [1, 1, 1, -1, 1, -1, -1, -1], "demi", motifsB);
  const forme = [[A, progAfin], [Ap, cadFin], [B, progB], [Ap, cadFin]];
  const mel = [], acc = [];
  for (const [mes, prog] of forme) {
    mes.forEach((notes, k) => {
      for (const [p, d] of notes) mel.push(`${nom(p)}:${d}`);
      const c = prog[k];
      if (Array.isArray(c)) { acc.push(`${nomAccord(c[0])}:${metre / 2}`, `${nomAccord(c[1])}:${metre / 2}`); }
      else acc.push(`${nomAccord(c)}:${metre}`);
    });
  }
  return { melodie: mel.join(" "), accords: acc.join(" "), mesures: 32 };
}
