// Mixage « No Hell ! » comme en studio : chaque instrument est rendu à part (GeneralUser GS), passe
// dans sa propre chaîne (ffmpeg), puis les pistes sont dosées en sonie et mélangées.
//  - guitares (rythmiques et solo) : simulateur d'ampli, c.-à-d. coupe-bas qui resserre, bosse
//    de médiums (pédale d'overdrive), deux étages de saturation, puis le filtrage d'un baffle 4×12
//    (bosse vers 120 Hz, creux vers 450 Hz, présence vers 2,4 kHz, coupure au-delà de 5,5 kHz) ;
//    variante « DI » : la guitare est jouée en son clair, toute la saturation vient de l'ampli ;
//  - guitare solo : écho (delay) ; basse : compression et un peu de grain ;
//  - batterie : compression, grosse caisse plus pleine, attaque, petite pièce (premières réflexions) ;
//  - bus : compression douce, −18 LUFS, AAC 96 kbit/s.
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { metal, CH } from "./metal.mjs";
import { rendu } from "./moteur.mjs";

const baffle = "highpass=f=80,equalizer=f=120:t=q:w=1:g=3,equalizer=f=450:t=q:w=1.2:g=-5,equalizer=f=2400:t=q:w=1:g=3,lowpass=f=5400:p=2,lowpass=f=6800:p=2";
const ampli = (di, gain = 0) => di
  ? `highpass=f=110,equalizer=f=750:t=q:w=1:g=6,volume=${18 + gain}dB,asoftclip=type=tanh,volume=-4dB,equalizer=f=1200:t=q:w=1:g=3,volume=${12 + gain}dB,asoftclip=type=tanh,volume=-8dB,${baffle}`
  : `highpass=f=100,equalizer=f=750:t=q:w=1:g=4,volume=${6 + gain}dB,asoftclip=type=tanh,volume=-6dB,${baffle}`;
const PISTES = {
  gtrG: { canaux: [CH.rythG], chaine: di => ampli(di), cible: -24 },
  gtrD: { canaux: [CH.rythD], chaine: di => ampli(di), cible: -24 },
  // mélodie : compressée avant l'ampli (tenue des notes), pédale qui pousse les médiums, trois étages
  // de saturation, baffle un peu plus ouvert dans les aigus, écho
  solo: { canaux: [CH.lead, CH.jumelle], chaine: () => "highpass=f=140,acompressor=threshold=0.1:ratio=6:attack=3:release=120:makeup=3,equalizer=f=800:t=q:w=1:g=7,volume=20dB,asoftclip=type=tanh,volume=-3dB,equalizer=f=1500:t=q:w=1:g=4,volume=14dB,asoftclip=type=tanh,volume=-3dB,volume=8dB,asoftclip=type=atan,volume=-9dB,highpass=f=90,equalizer=f=150:t=q:w=1:g=2,equalizer=f=500:t=q:w=1.2:g=-4,equalizer=f=2600:t=q:w=1:g=4,lowpass=f=6500:p=2,lowpass=f=8000:p=2,aecho=1:0.9:360:0.2", cible: -21.5 },
  basse: { canaux: [CH.basse], chaine: () => "highpass=f=35,acompressor=threshold=0.2:ratio=4:attack=10:release=150,volume=8dB,asoftclip=type=tanh,volume=-8dB,lowpass=f=3500,equalizer=f=80:t=q:w=1:g=2,equalizer=f=800:t=q:w=1:g=2", cible: -25 },
  batterie: { canaux: [CH.drums], chaine: () => "acompressor=threshold=0.25:ratio=3:attack=6:release=120:makeup=1.2,equalizer=f=60:t=q:w=1:g=3,equalizer=f=400:t=q:w=1.2:g=-3,equalizer=f=4500:t=q:w=1:g=3,highshelf=f=9000:g=2,aecho=0.9:0.9:17|29:0.16|0.1", cible: -21 },
  autres: { canaux: [CH.claire, CH.choeur, CH.cordes, CH.orgue, CH.hit], chaine: () => "aecho=0.9:0.9:23|41:0.14|0.08", cible: -26 },
};
function sonie(f) {
  const e = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(e.slice(e.lastIndexOf("{"), e.lastIndexOf("}") + 1));
  return { i: +j.input_i, j };
}
/** Fabrique un morceau : `variante` "A" (guitares saturées de la banque) ou "B" (son clair + ampli). */
export async function fabriqueMetal(P, style, graine, m4a, variante = "B", tmp = "tmp-mix") {
  await fs.mkdir(tmp, { recursive: true });
  const di = variante === "B";
  const r = metal(P, style, graine, { di });
  const entrees = [];
  for (const [nom, p] of Object.entries(PISTES)) {
    const brut = `${tmp}/${nom}.wav`, traite = `${tmp}/${nom}-t.wav`;
    await rendu(r.midiDe(p.canaux), brut);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", brut, "-af", p.chaine(di), "-c:a", "pcm_f32le", traite]);
    const { i } = sonie(traite);
    if (!isFinite(i) || i < -70) continue;                 // piste muette (pas d'orgue, etc.)
    entrees.push({ f: traite, gain: p.cible - i });
  }
  const filtres = entrees.map((e, k) => `[${k}:a]volume=${e.gain.toFixed(2)}dB[p${k}]`).join(";");
  const BUS = `${filtres};${entrees.map((_, k) => `[p${k}]`).join("")}amix=inputs=${entrees.length}:normalize=0,acompressor=threshold=0.15:ratio=2.5:attack=15:release=200:makeup=1.3,equalizer=f=250:t=q:w=1.1:g=-1.5,highshelf=f=8000:g=1.5`;
  const args = entrees.flatMap(e => ["-i", e.f]);
  const mes = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args, "-filter_complex", `${BUS},loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(mes.slice(mes.lastIndexOf("{"), mes.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-18:TP=-1.5:LRA=9:linear=true:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, "-filter_complex", `${BUS},${ln}`, "-ar", "44100", "-c:a", "aac", "-b:a", "96k", "-cutoff", "17000", m4a]);
  await fs.rm(tmp, { recursive: true, force: true });
  return r;
}
