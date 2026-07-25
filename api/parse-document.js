// Fonction serverless Vercel (gratuite dans la limite du plan Hobby).
// Reçoit une photo/PDF depuis le navigateur, appelle Gemini CÔTÉ SERVEUR avec
// GEMINI_API_KEY (variable d'environnement Vercel — jamais dans le code, jamais
// envoyée au navigateur), et renvoie uniquement les données extraites.

/* --- Cascade de modèles ------------------------------------------------
   Google retire régulièrement des modèles sans préavis (gemini-1.5-flash et
   gemini-2.5-flash ont déjà disparu). On essaie donc plusieurs noms dans
   l'ordre : au premier qui répond, on s'arrête. Plus besoin de redéployer
   à chaque changement côté Google. */
const MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
  "gemini-pro-latest",
];

const PROMPT = `Tu es un assistant qui extrait des informations depuis des documents administratifs et financiers français : fiche de paye, avis d'imposition, avis d'échéance d'assurance, courrier CAF, quittance de loyer, facture, ou RELEVÉ DE COMPTE BANCAIRE.

Analyse le document fourni et réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown), exactement dans ce format :

{
  "type_document": "fiche_de_paye" | "avis_imposition" | "releve_bancaire" | "autre_echeance" | "illisible",
  "revenu": { "libelle": string, "montant": number, "periodicite": "mensuel" } | null,
  "echeance": { "titre": string, "categorie": "impots" | "caf" | "assurance" | "vehicule" | "enfants" | "autre", "date_limite": "YYYY-MM-DD" | null, "montant": number | null } | null,
  "transactions": [ { "date": "YYYY-MM-DD", "libelle": string, "montant": number, "sens": "debit" | "credit" } ] | null,
  "confiance": "haute" | "moyenne" | "basse",
  "remarque": string
}

Regles strictes :
- FICHE DE PAYE : remplis "revenu" avec le NET A PAYER (jamais le brut). "echeance" et "transactions" a null.
- RELEVE DE COMPTE BANCAIRE : remplis "transactions" avec TOUTES les operations lisibles (date, libelle complet, montant positif, sens "debit" si l'argent sort / "credit" s'il entre). "revenu" et "echeance" a null. N'invente aucune ligne.
- AVIS D'IMPOSITION, ECHEANCE D'ASSURANCE, DOCUMENT CAF avec date limite : remplis "echeance" (titre court, categorie la plus proche, date limite YYYY-MM-DD si visible, montant si visible). Les autres champs a null.
- Si le document ne correspond a aucun cas, ou si l'image est floue/illisible : "type_document" a "illisible", tous les autres champs a null, et explique pourquoi dans "remarque".
- Les montants sont des nombres purs (pas de symbole euro, pas d'espaces, pas de virgule comme separateur de milliers).
- N'invente JAMAIS une valeur absente ou peu claire : mets null et baisse "confiance" plutot que de deviner.
- "remarque" : une phrase courte en francais, utile pour savoir quoi verifier.`;

async function appelerGemini(model, apiKey, mimeType, data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data } }] },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 8192, // un releve peut contenir beaucoup de lignes
      },
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Clé API absente côté serveur.",
      conseil: "Ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
    });
    return;
  }

  const { mimeType, data } = req.body || {};
  if (!mimeType || !data) {
    res.status(400).json({ error: "Document manquant dans la requête." });
    return;
  }

  const tentatives = [];

  for (const model of MODELS) {
    let geminiRes;
    try {
      geminiRes = await appelerGemini(model, apiKey, mimeType, data);
    } catch (e) {
      tentatives.push(`${model}: réseau (${e.message})`);
      continue;
    }

    // Quota épuisé : inutile d'essayer les autres modèles, c'est le même compte.
    if (geminiRes.status === 429) {
      res.status(429).json({
        error: "Quota gratuit Gemini épuisé pour aujourd'hui.",
        conseil: "Le quota repart à zéro chaque jour. En attendant, importe ton relevé en CSV : ça ne consomme aucun quota.",
      });
      return;
    }

    // Clé invalide ou API non activée : réessayer un autre modèle ne sert à rien.
    if (geminiRes.status === 400 || geminiRes.status === 403) {
      const txt = await geminiRes.text();
      res.status(geminiRes.status).json({
        error: geminiRes.status === 403 ? "Clé API refusée par Google." : "Requête refusée par Google.",
        conseil: "Vérifie que l'API « Generative Language » est activée dans Google Cloud Console et que GEMINI_API_KEY est correcte.",
        details: txt.slice(0, 300),
      });
      return;
    }

    // Modèle introuvable/retiré : on passe au suivant de la cascade.
    if (geminiRes.status === 404) {
      tentatives.push(`${model}: indisponible (404)`);
      continue;
    }

    if (!geminiRes.ok) {
      tentatives.push(`${model}: HTTP ${geminiRes.status}`);
      continue;
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      const raison = geminiJson?.candidates?.[0]?.finishReason;
      tentatives.push(`${model}: réponse vide${raison ? " (" + raison + ")" : ""}`);
      continue;
    }

    // Certains modèles ajoutent malgré tout des balises markdown.
    const nettoye = text.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();

    let extracted;
    try {
      extracted = JSON.parse(nettoye);
    } catch {
      tentatives.push(`${model}: JSON invalide`);
      continue;
    }

    res.status(200).json({ ...extracted, _model: model });
    return;
  }

  res.status(502).json({
    error: "Aucun modèle Gemini n'a pu traiter le document.",
    conseil: "Importe ton relevé en CSV en attendant — l'import CSV fonctionne sans IA et sans quota.",
    details: tentatives.join(" · "),
  });
}
