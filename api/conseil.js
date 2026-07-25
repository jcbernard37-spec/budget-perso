// Analyse du budget par l'IA.
// Reçoit un RÉSUMÉ CHIFFRÉ du budget (jamais les libellés bruts, jamais de
// donnée nominative), et renvoie des observations concrètes.
//
// Principe : l'IA commente ce qu'elle voit dans les chiffres. Elle ne se
// substitue pas à un conseiller — les pistes qu'elle signale sont formulées
// comme des points à vérifier, pas comme des certitudes.

const MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-flash-latest",
  "gemini-1.5-flash-latest",
  "gemini-pro-latest",
];

const SYSTEME = `Tu analyses le budget d'un particulier français. Tu reçois des chiffres agrégés, jamais de données nominatives.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, exactement dans ce format :

{
  "synthese": string,
  "observations": [
    { "titre": string, "detail": string, "gravite": "info" | "attention" | "alerte", "montant": number | null }
  ],
  "pistes": [
    { "titre": string, "detail": string, "gain_estime": number | null, "a_verifier": string }
  ],
  "question": string | null
}

Règles :
- "synthese" : 2 phrases maximum. L'état réel du budget, sans dramatiser ni minimiser.
- "observations" : 3 à 5 constats CHIFFRÉS tirés des données fournies. Toujours citer le montant ou le pourcentage. Pas de généralité du type "surveillez vos dépenses".
  - "alerte" = déficit ou dérive qui met le budget en danger
  - "attention" = poste anormalement élevé ou en hausse
  - "info" = constat neutre utile
- "pistes" : 2 à 4 leviers CONCRETS et adaptés à la situation décrite. Pour chacun :
  - "gain_estime" : ordre de grandeur en euros par mois, ou null si impossible à estimer. N'invente pas de chiffre précis.
  - "a_verifier" : où et comment vérifier (organisme, site, document). Obligatoire.
- "question" : une seule question dont la réponse changerait vraiment l'analyse, ou null.
- N'affirme jamais un droit ou un montant d'aide comme acquis : formule au conditionnel et renvoie vers l'organisme.
- Ne recommande aucun placement financier ni produit bancaire.
- Français simple et direct. Tutoiement. Pas de jargon.
- Si les données sont trop maigres pour conclure, dis-le dans "synthese" plutôt que de broder.`;

async function appeler(model, apiKey, contenu) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEME }] },
        contents: [{ parts: [{ text: contenu }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
    }
  );
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
      conseil: "Ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables.",
    });
    return;
  }

  const { resume } = req.body || {};
  if (!resume) {
    res.status(400).json({ error: "Aucune donnée à analyser." });
    return;
  }

  const tentatives = [];

  for (const model of MODELS) {
    let r;
    try {
      r = await appeler(model, apiKey, resume);
    } catch (e) {
      tentatives.push(`${model}: réseau`);
      continue;
    }

    if (r.status === 429) {
      res.status(429).json({
        error: "Quota gratuit Gemini épuisé pour aujourd'hui.",
        conseil: "Le quota repart à zéro chaque jour. Le reste de l'appli fonctionne normalement.",
      });
      return;
    }

    if (r.status === 400 || r.status === 403) {
      const txt = await r.text();
      res.status(r.status).json({
        error: r.status === 403 ? "Clé API refusée par Google." : "Requête refusée par Google.",
        conseil: "Vérifie que l'API « Generative Language » est activée dans Google Cloud Console.",
        details: txt.slice(0, 300),
      });
      return;
    }

    if (!r.ok) {
      tentatives.push(`${model}: HTTP ${r.status}`);
      continue;
    }

    const json = await r.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      tentatives.push(`${model}: réponse vide`);
      continue;
    }

    const nettoye = text.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    let analyse;
    try {
      analyse = JSON.parse(nettoye);
    } catch {
      tentatives.push(`${model}: JSON invalide`);
      continue;
    }

    res.status(200).json({ ...analyse, _model: model });
    return;
  }

  res.status(502).json({
    error: "Aucun modèle Gemini n'a pu analyser le budget.",
    details: tentatives.join(" · "),
  });
}
