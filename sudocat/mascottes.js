/* =========================================================================
   Sudocat en ligne — les deux mascottes (une seule image par thème).
   Dessins vectoriels sans identifiant ni dégradé : on peut les répéter autant
   de fois qu'on veut dans la page. Contour sombre pour ressortir sur toutes
   les couleurs de zones.
   ========================================================================= */
const MASCOTTES = {
  // Chat calico (choisi parmi 4 propositions le 2026-10-25).
  chat: {
    box: [8, 8, 84, 84],
    body: '<g stroke="#14121F" stroke-width="3.6" stroke-linejoin="round"><path d="M19 47 Q14 16 22 10 Q31 11 43 29 Z" fill="#FFF6EA"/><path d="M81 47 Q86 16 78 10 Q69 11 57 29 Z" fill="#FFF6EA"/><path d="M12 60 C12 35 29 25 50 25 C71 25 88 35 88 60 C88 80 71 90 50 90 C29 90 12 80 12 60 Z" fill="#FFF6EA"/></g><path d="M19 47 Q14 16 22 10 Q31 11 43 29 Q30 30 23 44 Z" fill="#F29A4A"/><path d="M81 47 Q86 16 78 10 Q69 11 57 29 Q66 33 72 26 Q80 34 81 47 Z" fill="#4A4458"/><path d="M14 52 C16 38 26 30 38 28 C42 38 34 50 22 54 Z" fill="#F29A4A"/><path d="M86 50 C84 40 77 32 66 29 C64 36 70 44 80 45 Z" fill="#4A4458"/><g fill="none" stroke="#14121F" stroke-width="3.6" stroke-linejoin="round"><path d="M19 47 Q14 16 22 10 Q31 11 43 29"/><path d="M81 47 Q86 16 78 10 Q69 11 57 29"/><path d="M12 60 C12 35 29 25 50 25 C71 25 88 35 88 60 C88 80 71 90 50 90 C29 90 12 80 12 60 Z"/></g><ellipse cx="35" cy="59" rx="6.8" ry="8.2" fill="#14121F"/><ellipse cx="65" cy="59" rx="6.8" ry="8.2" fill="#14121F"/><circle cx="37.5" cy="55.5" r="2.7" fill="#fff"/><circle cx="67.5" cy="55.5" r="2.7" fill="#fff"/><circle cx="33.3" cy="63" r="1.2" fill="#fff"/><circle cx="63.3" cy="63" r="1.2" fill="#fff"/><ellipse cx="24" cy="71" rx="6.5" ry="3.8" fill="#FF7FA3" opacity=".55"/><ellipse cx="76" cy="71" rx="6.5" ry="3.8" fill="#FF7FA3" opacity=".55"/><path d="M47 68 Q50 66 53 68 Q50 71.5 47 68 Z" fill="#FF6F96"/><path d="M50 70.5 Q47.8 74.5 44.8 72.6 M50 70.5 Q52.2 74.5 55.2 72.6" fill="none" stroke="#14121F" stroke-width="2.1" stroke-linecap="round"/><path d="M17 66 L7 64 M17 71 L8 73 M83 66 L93 64 M83 71 L92 73" stroke="#14121F" stroke-width="2" stroke-linecap="round"/>',
  },
  chien: {
    box: [4, 14, 92, 76],
    body:
      '<g stroke="#14121F" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">' +
      '<ellipse cx="50" cy="53" rx="31" ry="33" fill="#F2D3A8"/>' +
      '<path d="M27 26 C12 24 5 46 9 62 C12 74 25 72 28 60 C30 50 31 36 27 26 Z" fill="#8B5A3C"/>' +
      '<path d="M73 26 C88 24 95 46 91 62 C88 74 75 72 72 60 C70 50 69 36 73 26 Z" fill="#8B5A3C"/>' +
      '</g>' +
      '<ellipse cx="63" cy="46" rx="10" ry="11" fill="#C98A5B"/>' +
      '<ellipse cx="50" cy="71" rx="17" ry="13" fill="#FFF4E3" stroke="#14121F" stroke-width="3"/>' +
      '<circle cx="38" cy="48" r="5.5" fill="#14121F"/><circle cx="63" cy="48" r="5.5" fill="#14121F"/>' +
      '<circle cx="40" cy="46" r="1.8" fill="#fff"/><circle cx="65" cy="46" r="1.8" fill="#fff"/>' +
      '<ellipse cx="50" cy="64" rx="7.5" ry="5.2" fill="#14121F"/>' +
      '<circle cx="48" cy="62.5" r="1.6" fill="#fff" opacity=".7"/>' +
      '<path d="M46.5 74 Q50 86 53.5 74 Z" fill="#FF6B8A" stroke="#14121F" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M50 69 Q46 76 41 73 M50 69 Q54 76 59 73" fill="none" stroke="#14121F" stroke-width="2.2" stroke-linecap="round"/>',
  },
};
if (typeof module !== 'undefined') module.exports = { MASCOTTES };
