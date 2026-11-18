// Chaîne « No Hell ! » : petite salle, coupe-bas, compression de bus plus ferme, −18 LUFS, AAC.
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
export async function traiteMetal(wav, m4a, garder = false) {
  const PRE = "[0:a]asplit=2[d][w];[w][1:a]afir=gtype=none[r];[r]volume=0.08[rv];[d][rv]amix=inputs=2:weights=1 1:normalize=0,highpass=f=32,equalizer=f=420:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=1:g=1.5,acompressor=threshold=0.12:ratio=3:attack=12:release=220:makeup=1.5";
  const mes = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-i", "ir.wav", "-filter_complex", `${PRE},loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(mes.slice(mes.lastIndexOf("{"), mes.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-18:TP=-1.5:LRA=9:linear=true:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-i", "ir.wav", "-filter_complex", `${PRE},${ln}`, "-ar", "44100", "-c:a", "aac", "-b:a", "64k", m4a]);
  if (!garder) await fs.rm(wav);
}
