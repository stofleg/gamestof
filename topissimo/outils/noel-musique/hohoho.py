# « Ho ! Ho ! Ho ! » du père Noël : synthèse par formants (type Klatt).
# Source glottique (impulsions de Rosenberg, pente spectrale, micro-variations de hauteur et
# d'amplitude, souffle), aspiration du H filtrée par les formants, voyelle [o] qui glisse vers [ʊ],
# résonateurs en cascade, voix de poitrine grave (≈ 95–125 Hz), rire qui descend, salle.
import numpy as np, wave
sr = 44100
rng = np.random.default_rng(3)

def resonateur(x, f, bw):
    """Résonateur de Klatt (2e ordre) à fréquence/bande variables (tableaux par échantillon)."""
    y = np.zeros_like(x); y1 = y2 = 0.0
    f = np.broadcast_to(f, x.shape); bw = np.broadcast_to(bw, x.shape)
    C = -np.exp(-2 * np.pi * bw / sr); B = 2 * np.exp(-np.pi * bw / sr) * np.cos(2 * np.pi * f / sr); A = 1 - B - C
    for i in range(len(x)):
        v = A[i] * x[i] + B[i] * y1 + C[i] * y2
        y2 = y1; y1 = v; y[i] = v
    return y

def syllabe(duree, f0_debut, f0_fin, force, voyelle_fin=0.45):
    n = int(sr * duree); t = np.arange(n) / sr
    # hauteur : petite montée puis chute (rire), vibrato lent, micro-variations
    f0 = np.interp(t, [0, .12 * duree, duree], [f0_debut * .96, f0_debut * 1.05, f0_fin])
    f0 *= 1 + .012 * np.sin(2 * np.pi * 5.5 * t) + .006 * np.convolve(rng.standard_normal(n), np.ones(400) / 400, "same") * 20
    phase = np.cumsum(f0 / sr)
    p = phase % 1.0
    # impulsion de Rosenberg : ouverture 40 %, fermeture 16 %
    to, tc = .40, .16
    g = np.where(p < to, .5 * (1 - np.cos(np.pi * p / to)), np.where(p < to + tc, np.cos(np.pi * (p - to) / (2 * tc)), 0.0))
    src = np.diff(g, prepend=0) * 60                   # dérivée → pente de la source
    shimmer = 1 + .08 * np.convolve(rng.standard_normal(n), np.ones(220) / 220, "same") * 12
    souffle_voix = rng.standard_normal(n) * .018 * (g > .1)
    src = src * shimmer + souffle_voix
    # enveloppes : H aspiré (0–70 ms), puis voix ; fin douce
    h_len = int(sr * .075)
    env_v = np.interp(t, [0, .055, .10, duree * .55, duree], [0, .15, 1, .8, 0]) ** 1.2
    asp = rng.standard_normal(n) * np.interp(t, [0, .02, .07, .11], [0, .55, .4, 0], right=0)
    x = src * env_v * force + asp * force
    # formants : [o] → [ʊ] ; F1 520→400, F2 880→760, F3 2450, F4 3300
    k = np.clip(t / duree, 0, 1)
    F1 = 520 - 120 * k ** 1.3 * voyelle_fin / .45; F2 = 880 - 120 * k; F3 = 2450 + 0 * k
    y = x
    for f, bw in ((3350, 260), (F3, 160), (F2, 90), (F1, 70)):
        y = resonateur(y, f, bw)
    # poitrine : résonance grave
    y = y + .35 * resonateur(x * .4, 230, 120)
    return y

def assemble():
    parties = [  # (début, durée, f0 départ, f0 fin, force)
        (0.00, .34, 128, 112, 1.00),
        (0.40, .32, 118, 104, .90),
        (0.78, .62, 112, 88, 1.05),
    ]
    tot = int(sr * 1.9); out = np.zeros(tot)
    for d0, du, a, b, f in parties:
        s = syllabe(du, a, b, f)
        i = int(sr * d0); out[i:i + len(s)] += s
    out /= np.abs(out).max()
    return out

voix = assemble()
# stéréo légèrement élargie (deux micros), passage en salle (réponse impulsionnelle ir.wav)
w = wave.open("ir.wav"); ir = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float).reshape(-1, 2) / 32768
L = np.convolve(voix, ir[:, 0])[:len(voix) + sr]; R = np.convolve(voix, ir[:, 1])[:len(voix) + sr]
sec = np.pad(voix, (0, sr))
st = np.stack([sec + .12 * L / np.abs(L).max(), np.roll(sec, 18) + .12 * R / np.abs(R).max()], 1)
st /= np.abs(st).max() * 1.12
ww = wave.open("hohoho.wav", "wb"); ww.setnchannels(2); ww.setsampwidth(2); ww.setframerate(sr); ww.writeframes((st * 32767).astype(np.int16).tobytes()); ww.close()
print("hohoho.wav", len(st) / sr, "s")
