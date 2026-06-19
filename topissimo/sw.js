// ============================================================
//  KILL-SWITCH — le service worker est SUPPRIMÉ.
//
//  Ce SW ne met plus rien en cache : au contraire, il se DÉSINSCRIT lui-même
//  et vide tous les caches, puis recharge les onglets ouverts pour repartir
//  sur du code frais servi directement par le réseau.
//
//  Pourquoi : le SW provoquait l'exécution de code périmé (« 1er coup faux »).
//  Pour cette app (qui a de toute façon besoin du réseau), il n'apportait
//  presque rien. La fraîcheur du code est désormais assurée par le versioning
//  des URL (game.js?v=NNN, style.css?v=NNN).
//
//  Les clients déjà équipés récupèrent ce script via leur vérification de mise
//  à jour habituelle ; il s'auto-détruit alors proprement.
// ============================================================
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // 1) Vider tous les caches.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch { /* ignore */ }
    // 2) Se désinscrire.
    try { await self.registration.unregister(); } catch { /* ignore */ }
    // NB : on NE recharge PAS les onglets ouverts — cela interromprait un
    // joueur en pleine partie. Le nettoyage prend effet silencieusement ; c'est
    // le PROCHAIN chargement (navigation/refresh naturel) qui repart sans SW,
    // sur du code frais. De plus ce SW n'a pas de handler "fetch" : dès son
    // activation, les requêtes vont déjà directement au réseau.
  })());
});

// On ne sert plus rien : pas de handler "fetch". Les requêtes vont directement
// au réseau (le navigateur gère son cache HTTP normal, qui s'auto-périme).
