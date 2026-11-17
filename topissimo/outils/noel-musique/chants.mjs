// Chants de Noël du domaine public : mélodie, accords et arrangement de référence.
export const MORCEAUX = {
  vive: {
    titre: "Vive le vent (Jingle Bells)", credit: "James Lord Pierpont, 1857", bpm: 128, metre: 4, festif: true,
    melodie:
      // couplet
      "G4:1 E5:1 D5:1 C5:1 G4:3 G4:.5 G4:.5 G4:1 E5:1 D5:1 C5:1 A4:4 A4:1 F5:1 E5:1 D5:1 B4:4 G5:1 G5:1 F5:1 D5:1 E5:4 " +
      "G4:1 E5:1 D5:1 C5:1 G4:4 G4:1 E5:1 D5:1 C5:1 A4:3 A4:1 A4:1 F5:1 E5:1 D5:1 G5:1 G5:1 G5:1 G5:1 A5:1 G5:1 F5:1 D5:1 C5:4 " +
      // refrain
      "E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1.5 D5:.5 E5:4 F5:1 F5:1 F5:1.5 F5:.5 F5:1 E5:1 E5:1 E5:.5 E5:.5 E5:1 D5:1 D5:1 E5:1 D5:2 G5:2 " +
      "E5:1 E5:1 E5:2 E5:1 E5:1 E5:2 E5:1 G5:1 C5:1.5 D5:.5 E5:4 F5:1 F5:1 F5:1.5 F5:.5 F5:1 E5:1 E5:1 E5:.5 E5:.5 G5:1 G5:1 F5:1 D5:1 C5:4",
    accords:
      "C:4 C:4 C:4 F:4 Dm:4 G:4 G7:4 C:4 C:4 C:4 C:4 F:4 F:4 G:4 G7:4 C:4 " +
      "C:4 C:4 C:4 C:4 F:4 C:4 D7:4 G7:4 C:4 C:4 C:4 C:4 F:4 C:4 G7:4 C:4",
    sections: [
      { lead: "celesta", oct: 0, cordes: "pizz", harpe: true, grelots: 1 },
      { lead: "cordes", oct: 0, double: "flute", cor: true, harpe: true, glock: true, grelots: 2, timbales: true, choeur: false },
      { lead: "cuivres", transpo: 2, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, grelots: 2, timbales: true, depuis: 64 },
    ],
  },
  nuit: {
    titre: "Douce nuit", credit: "Franz Xaver Gruber, 1818", bpm: 150, metre: 6, festif: false, unite: .5,
    melodie:
      "G4:3 A4:1 G4:2 E4:6 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 B4:6 C5:4 C5:2 G4:6 A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 " +
      "A4:4 A4:2 C5:3 B4:1 A4:2 G4:3 A4:1 G4:2 E4:6 D5:4 D5:2 F5:3 D5:1 B4:2 C5:6 E5:6 C5:3 G4:1 E4:2 G4:3 F4:1 D4:2 C4:12",
    accords:
      "C:6 C:6 C:6 C:6 G7:6 G7:6 C:6 C:6 F:6 F:6 C:6 C:6 F:6 F:6 C:6 C:6 G7:6 G7:6 C:6 C:6 C:6 G7:6 C:12",
    sections: [
      { lead: "celesta", oct: 12, harpe: true, cordes: "nappe", arpRapide: true },
      { lead: "cordesLentes", oct: 12, double: "flute", choeur: true, cor: true, harpe: true, arpRapide: true, cloches: true },
    ],
  },
  wish: {
    titre: "We Wish You a Merry Christmas", credit: "chant traditionnel anglais", bpm: 168, metre: 3, festif: true, levee: 1,
    melodie: "D4:1 G4:1 G4:.5 A4:.5 G4:.5 F#4:.5 E4:1 E4:1 E4:1 A4:1 A4:.5 B4:.5 A4:.5 G4:.5 F#4:1 D4:1 D4:1 B4:1 B4:.5 C5:.5 B4:.5 A4:.5 G4:1 E4:1 D4:.5 D4:.5 E4:1 A4:1 F#4:1 G4:2",
    accords: "D7:1 G:3 C:3 A7:3 D:3 B7:3 Em:3 C:1 D7:2 G:2",
    sections: [
      { lead: "celesta", oct: 12, cordes: "pizz", grelots: 1 },
      { lead: "flute", oct: 12, cordes: "pizz", harpe: true, glock: true, grelots: 2 },
      { lead: "cordes", oct: 12, double: "clarinette", cor: true, harpe: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 12, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 12, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true, ralenti: true },
    ],
  },
  deck: {
    titre: "Deck the Halls", credit: "chant traditionnel gallois", bpm: 120, metre: 4, festif: true,
    melodie:
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 " +
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 G4:.5 A4:.5 Bb4:.5 G4:.5 A4:1.5 G4:.5 F4:1 E4:1 F4:2 " +
      "G4:1.5 A4:.5 Bb4:1 G4:1 A4:1.5 Bb4:.5 C5:1 G4:1 A4:.5 B4:.5 C5:1 D5:.5 E5:.5 F5:1 E5:1 D5:1 C5:2 " +
      "C5:1.5 Bb4:.5 A4:1 G4:1 F4:1 G4:1 A4:1 F4:1 D5:.5 D5:.5 D5:.5 D5:.5 C5:1.5 Bb4:.5 A4:1 G4:1 F4:2",
    accords:
      "F:4 F:2 C7:2 C7:2 F:2 C7:2 F:2 F:4 F:2 C7:2 C7:2 F:2 C7:2 F:2 " +
      "C:4 F:2 C:2 Dm:2 G7:2 C:4 F:4 F:4 Bb:2 F:2 C7:2 F:2",
    sections: [
      { lead: "hautbois", oct: 0, cordes: "pizz", harpe: true, grelots: 1 },
      { lead: "cordes", oct: 12, double: "flute", cor: true, harpe: true, glock: true, grelots: 2, timbales: true },
      { lead: "cuivres", transpo: 2, oct: 0, double: "cordesHaut", cor: true, choeur: true, harpe: true, glock: true, grelots: 2, timbales: true, ralenti: true },
    ],
  },
  joie: {
    titre: "Joy to the World", credit: "Lowell Mason d’après Haendel, 1839", bpm: 100, metre: 4, festif: false,
    melodie:
      "D5:1 C#5:.75 B4:.25 A4:1.5 G4:.5 F#4:1 E4:1 D4:1.5 A4:.5 B4:1.5 B4:.5 C#5:1.5 C#5:.5 D5:3 " +
      "D5:.5 D5:.5 C#5:.5 B4:.5 A4:.5 A4:.75 G4:.25 F#4:.5 D5:.5 D5:.5 C#5:.5 B4:.5 A4:.5 A4:.75 G4:.25 F#4:.5 " +
      "F#4:.5 F#4:.5 F#4:.5 F#4:.5 F#4:.25 G4:.25 A4:1.5 G4:.25 F#4:.25 E4:.5 E4:.5 E4:.5 E4:.25 F#4:.25 G4:1.5 " +
      "F#4:.25 E4:.25 D4:.5 D5:1 B4:.5 A4:.75 G4:.25 F#4:.5 G4:.5 F#4:1 E4:1 D4:2.5",
    accords:
      "D:4 D:1 A7:1 D:2 G:2 A:2 D:3 D:2 A7:2 D:4 D:4 A7:4 D:1 G:1 D:1 G:1 A7:2 D:3",
    sections: [
      { lead: "cloches", oct: 0, cordes: "nappe", harpe: true },
      { lead: "cordes", oct: 0, double: "flute", cor: true, harpe: true, timbales: true },
      { lead: "cuivres", transpo: 1, oct: 0, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, timbales: true },
      { lead: "cuivres", transpo: 1, oct: 0, double: "cordesHaut", choeur: true, cor: true, harpe: true, glock: true, timbales: true, ralenti: true },
    ],
  },
};

