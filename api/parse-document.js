// Fonction serverless Vercel (gratuite dans la limite du plan Hobby).
// Reçoit une photo/PDF depuis le navigateur, appelle Gemini CÔTÉ SERVEUR avec
// GEMINI_API_KEY (variable d'environnement Vercel — jamais dans le code, jamais
// envoyée au navigateur), et renvoie uniquement les montants/dates extraits.

const MODEL = "gemini-1.5-flash";
// Si ce modèle n'est plus proposé par Google, remplace le nom ci-dessus par celui
// affiché dans ta console AI Studio (bouton "clé API" → liste des modèles).

const PROMPT = `Tu es un assistant qui extrait des informations depuis des documents administratifs et financiers français (fiche de paye, avis d'imposition, avis d'échéance d'assurance, courrier CAF, etc.).

Analyse le document fourni et réponds UNIQUEMENT avec un objet JSON valide (aucun texte avant/après, aucun bloc markdown, aucun \`\`\`), exactement dans ce format :

{
  "type_document": "fiche_de_paye" | "avis_imposition" | "autre_echeance" | "illisible",
  "revenu": { "libelle": string, "montant": number, "periodicite": "mensuel" } | null,
  "echeance": { "titre": string, "categorie": "impots" | "caf" | "assurance" | "vehicule" | "enfants" | "autre", "date_limite": "YYYY-MM-DD" | null, "montant": number | null } | null,
  "confiance": "haute" | "moyenne" | "basse",
  "remarque": string
}

Règles strictes :
- Si c'est une fiche de paye : remplis "revenu" avec le NET À PAYER (jamais le brut), laisse "echeance" à null.
- Si c'est un avis d'imposition, une échéance d'assurance, ou un document CAF avec une date limite : remplis "echeance" (titre court, catégorie la plus proche dans la liste fournie, date limite au format YYYY-MM-DD si visible, montant si visible), laisse "revenu" à null.
- Si le document ne correspond à aucun cas ci-dessus, ou si l'image est floue/illisible : mets "type_document" à "autre_echeance" ou "illisible", "revenu" et "echeance" à null, et explique brièvement pourquoi dans "remarque".
- Les montants sont des nombres purs (pas de symbole €, pas d'espaces, pas de virgule comme séparateur de milliers).
- N'invente JAMAIS une valeur absente ou peu claire : mets null et baisse "confiance" plutôt que de deviner.
- "remarque" : une phrase courte en français, utile pour que l'utilisateur sache quoi vérifier.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "GEMINI_API_KEY absente côté serveur. Ajoute-la dans Vercel → Settings → Environment Variables, puis redéploie.",
    });
    return;
  }

  const { mimeType, data } = req.body || {};
  if (!mimeType || !data) {
    res.status(400).json({ error: "Document manquant dans la requête." });
    return;
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data } }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      }
    );

    if (geminiRes.status === 429) {
      res.status(429).json({
        error: "Limite gratuite Gemini atteinte pour l'instant — réessaie dans une minute, ou saisis à la main.",
      });
      return;
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.status(502).json({ error: `Gemini a répondu une erreur (${geminiRes.status}).`, details: errText.slice(0, 300) });
      return;
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: "Réponse Gemini vide ou inattendue." });
      return;
    }

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "La réponse de l'IA n'était pas un JSON valide." });
      return;
    }

    res.status(200).json(extracted);
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur inconnue lors de l'appel à Gemini." });
  }
}
