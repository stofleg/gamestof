# Chants de Noël populaires (corpus music21, notation ABC) : lecture de la mélodie, puis
# harmonisation automatique (I, ii, iii, IV, V, V7, vi… ; programmation dynamique avec cadences).
import zipfile, re, json, sys
from fractions import Fraction as F

WHL = "../m21/music21-10.5.2-py3-none-any.whl"
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NOMS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
DIESES = ["F", "C", "G", "D", "A", "E", "B"]
TONIQUES = {"C": 0, "G": 7, "D": 2, "A": 9, "E": 4, "B": 11, "F#": 6, "F": 5, "Bb": 10, "Eb": 3, "Ab": 8, "Db": 1}

def armure(k):
    m = re.match(r"([A-G])([#b]?)\s*(m(?:in)?|maj|mix|dor|aeo|ion)?", k.strip(), re.I)
    ton = m.group(1) + (m.group(2) or "")
    mode = (m.group(3) or "").lower()
    mineur = mode in ("m", "min", "aeo")
    rel = (TONIQUES.get(ton, 0) + (3 if mineur else 0)) % 12      # tonique du majeur relatif
    if mode == "mix": rel = (TONIQUES.get(ton, 0) + 5) % 12
    if mode == "dor": rel = (TONIQUES.get(ton, 0) + 10) % 12
    n = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5}[rel]
    alt = {}
    if n > 0:
        for x in DIESES[:n]: alt[x] = 1
    else:
        for x in list(reversed(DIESES))[:-n]: alt[x] = -1
    return alt, TONIQUES.get(ton, 0), mineur

def bloc(chemin, titre, occ=1):
    t = zipfile.ZipFile(WHL).read("music21/corpus/" + chemin).decode("latin1")
    k = 0
    for b in re.split(r"\n(?=X:)", t):
        if re.search(r"^T:\s*" + re.escape(titre), b, re.M | re.I):
            k += 1
            if k == occ: return b
    raise SystemExit("introuvable " + titre)

def lit_abc(b):
    champs = dict(re.findall(r"^([A-Z]):\s*(.*)$", b, re.M))
    M = champs.get("M", "4/4").strip(); M = {"C": "4/4", "C|": "2/2"}.get(M, M)
    num, den = map(int, M.split("/"))
    L = F(champs.get("L", "1/8").strip()) if "L" in champs else (F(1, 16) if num / den < .75 else F(1, 8))
    alt, tonique, mineur = armure(champs.get("K", "C"))
    corps = "\n".join(l for l in b.splitlines() if not re.match(r"^[A-Za-z]:", l))
    corps = re.sub(r"%.*", "", corps)
    corps = re.sub(r'"[^"]*"', "", corps)            # accords et annotations
    corps = re.sub(r"![^!]*!|\+[^+]*\+", "", corps)  # décorations
    corps = re.sub(r"\{[^}]*\}", "", corps)          # notes d'agrément
    # jetons
    jet = re.findall(r"\[\d|\|\d|:\|\]?|\|:|::|\|\]|\|\||\[\||\||\(\d|[_^=]*[A-Ga-gzx][,']*\d*/*\d*|[<>]+|-", corps)
    # mesures et reprises
    notes, i = [], 0
    sections, cur = [], []
    elems = []
    for j in jet:
        elems.append(j)
    # déroulé simple des reprises |: … :| avec volte [1 [2
    sortie, debut, volta, deja = [], 0, None, False
    seq = []
    k = 0
    pile = elems
    def suite(lst):
        res, start, v1, idx = [], 0, None, 0
        while idx < len(lst):
            x = lst[idx]
            if x in ("|:", "[|"): start = len(res)
            elif x in ("[1", "|1"): v1 = len(res)
            elif x in ("[2", "|2"): pass
            elif x.startswith(":|") or x == "::":
                res.extend(res[start:(v1 if v1 is not None else len(res))])
                v1 = None; start = len(res)
            else: res.append(x)
            idx += 1
        return res
    flux = suite(pile)
    t = F(0)
    acc_mesure = {}
    tuplet = 0
    casse = None
    notes = []
    premiere_barre = None
    for x in flux:
        if x in ("|", "||", "|]", "[|"):
            acc_mesure = {}
            if premiere_barre is None and notes: premiere_barre = sum(n["d"] for n in notes)
            continue
        if x.startswith("("): tuplet = int(x[1]); ratio = F(2, 3) if tuplet == 3 else F(1); continue
        if x == "-":
            if notes: notes[-1]["lie"] = True
            continue
        if x in (">", "<", ">>", "<<"): casse = x; continue
        m = re.match(r"([_^=]*)([A-Ga-gzx])([,']*)(\d*)(/*)(\d*)", x)
        if not m: continue
        acc, l, octs, n1, sl, n2 = m.groups()
        d = F(int(n1) if n1 else 1)
        if sl: d = d / (int(n2) if n2 else 2 ** len(sl))
        d *= L * 4   # en noires
        if tuplet: d = d * ratio; tuplet -= 1
        if casse and notes:
            prev = notes[-1]
            if casse == ">": prev["d"] += prev["d"] / 2; d = d / 2
            elif casse == "<": prev["d"] -= prev["d"] / 2; d = d * 3 / 2
            casse = None
        if l in "zx": notes.append({"h": None, "d": d}); continue
        base = 12 * (5 if l.islower() else 4) + STEP[l.upper()]
        base += 12 * octs.count("'") - 12 * octs.count(",")
        if acc:
            a = acc.count("^") - acc.count("_")
            acc_mesure[l.upper() + octs] = a
        a = acc_mesure.get(l.upper() + octs, alt.get(l.upper(), 0))
        h = base + a
        if notes and notes[-1].get("lie") and notes[-1]["h"] == h:
            notes[-1]["d"] += d; notes[-1]["lie"] = False; continue
        notes.append({"h": h, "d": d})
    mes = F(num * 4, den)
    levee = premiere_barre if premiere_barre is not None and 0 < premiere_barre < mes else F(0)
    return notes, (num, den), tonique, mineur, levee

# ------------------------------------------------------------ harmonisation
MAJ = {"I": (0, ""), "ii": (2, "m"), "iii": (4, "m"), "IV": (5, ""), "V": (7, ""), "V7": (7, "7"), "vi": (9, "m"), "II7": (2, "7")}
MIN = {"i": (0, "m"), "iv": (5, "m"), "V": (7, ""), "V7": (7, "7"), "VI": (8, ""), "III": (3, ""), "VII": (10, ""), "iio": (2, "dim")}
Q = {"": [0, 4, 7], "m": [0, 3, 7], "7": [0, 4, 7, 10], "dim": [0, 3, 6]}
COUT = {"iii": -.4, "II7": -.5, "VII": -.3, "iio": -.4, "III": -.2, "ii": -.1, "vi": -.05}
TRANS = {("V", "I"): 1.2, ("V7", "I"): 1.4, ("IV", "V"): .5, ("ii", "V"): .7, ("ii", "V7"): .8, ("IV", "I"): .4, ("I", "IV"): .3, ("vi", "ii"): .4, ("vi", "IV"): .3,
         ("II7", "V"): .8, ("II7", "V7"): .8, ("V", "vi"): .2, ("V7", "IV"): -.8, ("V", "IV"): -.4, ("V7", "ii"): -.6,
         ("V", "i"): 1.2, ("V7", "i"): 1.4, ("iv", "V"): .6, ("iv", "i"): .3, ("i", "iv"): .3, ("VI", "iv"): .3, ("VI", "V"): .3, ("III", "VI"): .3, ("VII", "III"): .4, ("iio", "V"): .7}

def harmonise(notes, ts, tonique, mineur, levee):
    num, den = ts
    mesure = F(num * 4, den)
    seg = mesure / 2 if (num, den) in ((4, 4), (6, 8), (6, 4)) else mesure
    tot = sum(n["d"] for n in notes)
    # segments alignés sur la levée
    bornes = [F(0)] + [levee + k * seg for k in range(0, 1000) if levee + k * seg < tot and levee + k * seg > 0] + [tot]
    bornes = sorted(set(bornes))
    segs = list(zip(bornes[:-1], bornes[1:]))
    D = MIN if mineur else MAJ
    tons = {c: [(tonique + r + i) % 12 for i in Q[q]] for c, (r, q) in D.items()}
    # placement temporel des notes
    pos, t = [], F(0)
    for n in notes: pos.append((t, n["d"], n["h"])); t += n["d"]
    def score(c, a, b):
        s = COUT.get(c, 0)
        for (t0, d, h) in pos:
            if h is None: continue
            o = min(b, t0 + d) - max(a, t0)
            if o <= 0: continue
            fort = 1.6 if t0 == a or (t0 - a) % (seg / 2 if seg > 1 else seg) == 0 and t0 >= a else 1
            w = float(o) * fort
            s += w if h % 12 in tons[c] else -.55 * w
        return s
    noms = list(D)
    V = [{c: (score(c, *segs[0]) + (2 if c in ("I", "i") else 0), None) for c in noms}]
    for k in range(1, len(segs)):
        a, b = segs[k]
        ligne = {}
        for c in noms:
            sc = score(c, a, b)
            if k == len(segs) - 1: sc += 6 if c in ("I", "i") else -6
            if k == len(segs) - 2: sc += 1.5 if c in ("V", "V7") else 0
            if k == 1 and levee: sc += 2 if c in ("I", "i") else 0
            best = max(noms, key=lambda p: V[-1][p][0] + TRANS.get((p, c), 0) + (.35 if p == c else 0))
            ligne[c] = (V[-1][best][0] + TRANS.get((best, c), 0) + (.35 if best == c else 0) + sc, best)
        V.append(ligne)
    c = max(noms, key=lambda x: V[-1][x][0])
    chemin = [c]
    for k in range(len(segs) - 1, 0, -1):
        c = V[k][c][1]; chemin.append(c)
    chemin.reverse()
    out = []
    for (a, b), c in zip(segs, chemin):
        r, q = D[c]
        out.append((NOMS[(tonique + r) % 12] + q, b - a))
    return out

def fmt(x):
    x = float(x); return str(int(x)) if x == int(x) else f"{x:g}"

def piece(chemin, titre, occ=1, transpo=0):
    notes, ts, tonique, mineur, levee = lit_abc(bloc(chemin, titre, occ))
    num, den = ts
    mesure = F(num * 4, den)
    # levée : notes avant la première barre complète (déduite de la longueur totale)
    # ramène la mélodie autour de A4 (médiane), sauf transposition voulue
    hs = sorted(n["h"] for n in notes if n["h"] is not None)
    med = hs[len(hs) // 2]
    dec = 12 * round((69 - med) / 12) + transpo
    acc = harmonise(notes, ts, tonique, mineur, levee)
    unite = F(1, 2) if den == 8 else F(1)
    mel = []
    for n in notes:
        d = n["d"] / unite
        mel.append(("-" if n["h"] is None else NOMS[(n["h"] + dec) % 12] + str((n["h"] + dec) // 12 - 1)) + ":" + fmt(d))
    def tr_acc(a):
        r = a[:2] if len(a) > 1 and a[1] in "#b" else a[:1]
        return NOMS[(TONIQUES.get(r, {"C#": 1, "D#": 3, "G#": 8, "A#": 10, "Gb": 6, "Cb": 11}.get(r, 0)) + dec) % 12] + a[len(r):]
    acs = [tr_acc(a) + ":" + fmt(d / unite) for a, d in acc]
    metre = num if den == 4 else (num if den == 8 else num * 2)
    return {"melodie": " ".join(mel), "accords": " ".join(acs), "metre": metre, "unite": float(unite), "levee": float(levee / unite), "ts": f"{num}/{den}", "mineur": mineur}

if __name__ == "__main__":
    import pprint
    p = piece(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    print(p["ts"], "levée", p["levee"]); print(p["melodie"]); print(p["accords"])
