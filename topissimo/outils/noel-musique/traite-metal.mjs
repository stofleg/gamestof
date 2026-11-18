// Chaîne « No Hell ! » : son sec et proche (pas de salle), égalisation, compression de bus, −18 LUFS, AAC 96 kbit/s.
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
export async function traiteMetal(wav, m4a, garder = false) {
  // Son sec et proche (pas de salle) : coupe-bas, moins de boue vers 250 Hz, présence vers 3 kHz,
  // brillance au-dessus de 8 kHz, compression de bus.
  const PRE = "[0:a]highpass=f=32,equalizer=f=250:t=q:w=1.1:g=-2.5,equalizer=f=2800:t=q:w=1.1:g=3,highshelf=f=8000:g=3,acompressor=threshold=0.12:ratio=3:attack=10:release=180:makeup=1.5";
  const mes = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-filter_complex", `${PRE},loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(mes.slice(mes.lastIndexOf("{"), mes.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-18:TP=-1.5:LRA=9:linear=true:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-filter_complex", `${PRE},${ln}`, "-ar", "44100", "-c:a", "aac", "-b:a", "96k", "-cutoff", "17000", m4a]);
  if (!garder) await fs.rm(wav);
}
