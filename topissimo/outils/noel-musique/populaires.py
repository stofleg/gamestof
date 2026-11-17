import json
from lecture_abc import piece
L = [
 ("essenFolksong/boehme20.abc", "O TANNENBAUM", 1, "Mon beau sapin (O Tannenbaum)", "chant traditionnel allemand"),
 ("essenFolksong/boehme20.abc", "GLOCKE DU KLINGST", 1, "Glocke, du klingst fröhlich", "chant traditionnel allemand"),
 ("essenFolksong/boehme20.abc", "DU LIEBER FROMMER", 1, "Du lieber, frommer, heil’ger Christ", "chant traditionnel allemand"),
 ("essenFolksong/boehme20.abc", "ES ZIEHT EIN STILLER ENGEL", 1, "Es zieht ein stiller Engel", "chant traditionnel allemand"),
 ("essenFolksong/erk30.abc", "LAUFET", 1, "Laufet, ihr Hirten", "chant de Noël traditionnel allemand"),
 ("essenFolksong/erk30.abc", "ES SANGEN DREI ENGEL", 1, "Es sangen drei Engel", "chant de Noël traditionnel allemand"),
 ("essenFolksong/erk30.abc", "VOM HIMMEL HOCH IHR ENGEL", 1, "Vom Himmel hoch, o Engel, kommt", "chant de Noël traditionnel allemand"),
 ("essenFolksong/lot.abc", "Ein Kind geboren zu Bethlehem", 1, "Ein Kind geboren zu Bethlehem (Puer natus)", "chant de Noël traditionnel"),
 ("essenFolksong/lot.abc", "Auf, auf, ihr Hirten", 1, "Auf, auf, ihr Hirten", "chant de Noël traditionnel"),
 ("essenFolksong/boehme10.abc", "IN EINEM THAL BEI ARMEN HIRTEN", 1, "In einem Thal bei armen Hirten", "chant de Noël traditionnel allemand"),
 ("essenFolksong/zuccal0.abc", "\"Engellied zu Weihnachten\"", 1, "Engellied zu Weihnachten", "chant de Noël traditionnel"),
 ("miscFolk/northumbrianminstrelsyopus.abc", "The Twelve Days of Christmas (2)", 1, "The Twelve Days of Christmas", "chant traditionnel anglais"),
 ("miscFolk/northumbrianminstrelsyopus.abc", "Christmas Day in the Morning", 1, "Christmas Day in the Morning", "air traditionnel de Northumbrie"),
 ("oneills1850/0487-0500.abc", "CHRISTMAS EVE", 1, "Christmas Eve", "air traditionnel irlandais (O’Neill, 1903)"),
 ("oneills1850/0811-0899.abc", "A Merry Christmas", 1, "A Merry Christmas", "air traditionnel irlandais (O’Neill, 1903)"),
 ("oneills1850/0951-0981.abc", "The Holly Tree", 1, "The Holly Tree", "air traditionnel irlandais (O’Neill, 1903)"),
 ("oneills1850/1625-1700.abc", "Frost and Snow", 1, "Frost and Snow", "air traditionnel irlandais (O’Neill, 1903)"),
 ("ryansMammoth/ChristmasHornpipe.abc", "Christmas", 1, "Christmas Hornpipe", "air traditionnel (Ryan’s Mammoth Collection, 1883)"),
 ("ryansMammoth/SnowFlakeHornpipe.abc", "Snow-Flake", 1, "Snow-Flake Hornpipe", "air traditionnel (Ryan’s Mammoth Collection, 1883)"),
 ("ryansMammoth/StarOfTheEastHornpipe.abc", "Star of the East", 1, "Star of the East Hornpipe", "air traditionnel (Ryan’s Mammoth Collection, 1883)"),
]
out = []
for chemin, t, occ, titre, credit in L:
    try:
        p = piece(chemin, t, occ)
        b = sum(float(x.split(":")[1]) for x in p["melodie"].split())
        p.update(titre=titre, credit=credit)
        out.append(p); print(titre, p["ts"], "levée", p["levee"], "durée (unités)", b, "mineur" if p["mineur"] else "")
    except SystemExit as e: print("!!", titre, e)
    except Exception as e: print("!! erreur", titre, repr(e))
json.dump(out, open("populaires.json", "w"), ensure_ascii=False)
