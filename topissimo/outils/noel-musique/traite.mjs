// Chaîne commune : rendu WAV → salle, compression douce, −18 LUFS (2 passes), AAC 64 kbit/s.
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
export async function traite(wav, m4a) {
  const PRE = "[0:a]asplit=2[d][w];[w][1:a]afir=gtype=none[r];[r]volume=0.18[rv];[d][rv]amix=inputs=2:weights=1 1:normalize=0,acompressor=threshold=0.1:ratio=2:attack=80:release=800";
  const mes = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-i", "ir.wav", "-filter_complex", `${PRE},loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const j = JSON.parse(mes.slice(mes.lastIndexOf("{"), mes.lastIndexOf("}") + 1));
  const ln = `loudnorm=I=-18:TP=-1.5:LRA=11:linear=true:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-i", "ir.wav", "-filter_complex", `${PRE},${ln}`, "-ar", "44100", "-c:a", "aac", "-b:a", "64k", m4a]);
  await fs.rm(wav);
}
