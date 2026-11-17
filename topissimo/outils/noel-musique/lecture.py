# Lecture des partitions MusicXML (.mxl) des chorals : notes par partie (temps en noires, hauteur MIDI),
# reprises et voltas déroulées, instruments transpositeurs ramenés en sons réels, points d'orgue.
import zipfile, re, json, sys, xml.etree.ElementTree as ET
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

def lit(chemin):
    z = zipfile.ZipFile(chemin)
    nom = [n for n in z.namelist() if n.endswith(".xml") and "META" not in n][0]
    root = ET.fromstring(z.read(nom))
    noms = {sp.get("id"): (sp.findtext("part-name") or "").strip() for sp in root.iter("score-part")}
    parties, ts, fermates = [], None, set()
    for part in root.findall("part"):
        mesures = part.findall("measure")
        # déroulé des reprises (|: … :|) avec voltas 1/2
        ordre, i, debut_rep, repris = [], 0, 0, set()
        while i < len(mesures):
            m = mesures[i]
            for b in m.findall("barline"):
                r = b.find("repeat")
                if r is not None and r.get("direction") == "forward": debut_rep = i
            ending = None
            for b in m.findall("barline"):
                e = b.find("ending")
                if e is not None and e.get("type") == "start": ending = e.get("number")
            passage = 2 if i in repris or any(j >= debut_rep and j in repris for j in [i]) else 1
            if ending and "1" in ending.split(",") and (debut_rep, "fait") in repris:
                i += 1; continue           # volta 1 sautée au 2e passage
            ordre.append(i)
            back = any(b.find("repeat") is not None and b.find("repeat").get("direction") == "backward" for b in m.findall("barline"))
            if back and (debut_rep, "fait") not in repris:
                repris.add((debut_rep, "fait")); i = debut_rep; continue
            i += 1
        div, t, notes, tr = 1, 0.0, [], 0
        ouvertes = {}
        for idx in ordre:
            m = mesures[idx]
            for el in m:
                if el.tag == "attributes":
                    if el.findtext("divisions"): div = int(el.findtext("divisions"))
                    tp = el.find("transpose")
                    if tp is not None: tr = int(tp.findtext("chromatic") or 0) + 12 * int(tp.findtext("octave-change") or 0)
                    tm = el.find("time")
                    if tm is not None and ts is None: ts = (int(tm.findtext("beats")), int(tm.findtext("beat-type")))
                elif el.tag == "backup": t -= int(el.findtext("duration")) / div
                elif el.tag == "forward": t += int(el.findtext("duration")) / div
                elif el.tag == "note":
                    if el.find("grace") is not None: continue
                    d = int(el.findtext("duration") or 0) / div
                    chord = el.find("chord") is not None
                    t0 = t - (dern if chord else 0)
                    p = el.find("pitch")
                    if p is not None:
                        h = 12 * (int(p.findtext("octave")) + 1) + STEP[p.findtext("step")] + int(float(p.findtext("alter") or 0)) + tr
                        ties = [x.get("type") for x in el.findall("tie")]
                        if "stop" in ties and h in ouvertes:
                            ouvertes[h][1] += d
                            if "start" not in ties: del ouvertes[h]
                        else:
                            n = [round(t0, 4), d, h]; notes.append(n)
                            if "start" in ties: ouvertes[h] = n
                        if el.find("notations/fermata") is not None: fermates.add(round(t0 + d, 4))
                    if not chord: t += d; dern = d
        parties.append({"nom": noms.get(part.get("id"), ""), "notes": notes})
    return {"ts": ts or (4, 4), "parties": parties, "fermates": sorted(fermates), "fin": max(n[0] + n[1] for p in parties for n in p["notes"])}

if __name__ == "__main__":
    for f in sys.argv[1:]:
        d = lit(f)
        out = f.rsplit("/", 1)[-1].replace(".mxl", ".json")
        json.dump(d, open("chorals/" + out, "w"))
        print(out, d["ts"], len(d["parties"]), "parties", round(d["fin"], 1), "noires", len(d["fermates"]), "fermates")
