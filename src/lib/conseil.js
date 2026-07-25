/* Prépare le résumé envoyé à l'IA pour analyse.

   Point important : on n'envoie QUE des agrégats. Aucun libellé brut, aucun
   nom, aucun numéro de compte. L'IA voit « Alimentation : 449 € sur juillet »,
   jamais « Paiement carte X4648 LECLERC ». */

import { monthTotals, monthLabel, availableMonths } from "./import-engine.js";

const arrondi = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} state       état complet du budget
 * @param {string} moisCourant clé du mois affiché ("2026-07")
 * @param {object} extra       { categories, provisions, profils }
 */
export function construireResume(state, moisCourant, extra = {}) {
  const tx = state.transactions || [];
  const lignes = [];

  lignes.push("CONTEXTE");
  lignes.push("Parent solo avec deux enfants en bas âge, salarié en alternance dans l'IT, locataire en logement social, département Indre-et-Loire. Séparation récente : certaines charges sont encore partagées avec l'ex-conjointe.");
  lignes.push("");

  // --- Mois affiché ---
  if (moisCourant && tx.length) {
    const t = monthTotals(tx, moisCourant);
    lignes.push(`MOIS ANALYSÉ : ${monthLabel(moisCourant)}`);
    lignes.push(`Revenus encaissés : ${arrondi(t.revenus)} €`);
    lignes.push(`Dépenses : ${arrondi(t.charges)} €`);
    lignes.push(`Mouvements vers épargne/placement : ${arrondi(t.epargne)} €`);
    lignes.push(`Reste à vivre : ${arrondi(t.reste)} €`);
    lignes.push(`Nombre d'opérations : ${t.nb}`);
    lignes.push("");

    lignes.push("RÉPARTITION DES DÉPENSES DU MOIS");
    const cats = extra.categories || [];
    const tri = Object.entries(t.parCategorie || {}).sort((a, b) => b[1] - a[1]);
    for (const [id, montant] of tri) {
      const nom = cats.find((c) => c.id === id)?.label || id;
      const pct = t.charges > 0 ? Math.round((montant / t.charges) * 100) : 0;
      lignes.push(`- ${nom} : ${arrondi(montant)} € (${pct} % des dépenses)`);
    }
    lignes.push("");
  }

  // --- Historique pour repérer les tendances ---
  const mois = availableMonths(tx).slice(0, 6);
  if (mois.length > 1) {
    lignes.push("HISTORIQUE MENSUEL (du plus récent au plus ancien)");
    for (const m of mois) {
      const t = monthTotals(tx, m);
      lignes.push(`- ${monthLabel(m)} : revenus ${arrondi(t.revenus)} €, dépenses ${arrondi(t.charges)} €, reste ${arrondi(t.reste)} €`);
    }
    lignes.push("");
  }

  // --- Charges fixes ---
  const fixes = (state.charges || []).filter((c) => c.periodicity === "mensuel");
  if (fixes.length) {
    const total = fixes.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    lignes.push(`CHARGES FIXES MENSUELLES (total ${arrondi(total)} €)`);
    const cats = extra.categories || [];
    for (const c of [...fixes].sort((a, b) => b.amount - a.amount).slice(0, 15)) {
      const nom = cats.find((x) => x.id === c.category)?.label || c.category;
      lignes.push(`- ${nom} : ${arrondi(c.amount)} €`);
    }
    lignes.push("");
  }

  // --- Revenus réguliers ---
  const rev = (state.incomes || []).filter((i) => i.periodicity === "mensuel");
  if (rev.length) {
    const total = rev.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    lignes.push(`REVENUS RÉGULIERS MENSUELS (total ${arrondi(total)} €)`);
    for (const i of rev) lignes.push(`- ${i.category} : ${arrondi(i.amount)} €`);
    lignes.push("");
  }

  // --- Provisions ---
  const prov = state.provisions || [];
  if (prov.length) {
    lignes.push("DÉPENSES PROVISIONNÉES");
    for (const p of prov) lignes.push(`- ${p.label} : ${arrondi(p.cible)} € pour ${p.dateISO}`);
    lignes.push("");
  }

  lignes.push("DEMANDE");
  lignes.push("Analyse ce budget. Signale ce qui cloche avec des montants précis, et propose des leviers concrets adaptés à un parent solo en alternance.");

  return lignes.join("\n");
}

export async function analyserBudget(resume) {
  const res = await fetch("/api/conseil", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json.error || `Erreur serveur (${res.status}).`;
    const err = new Error(json.conseil ? `${message} ${json.conseil}` : message);
    err.details = json.details;
    throw err;
  }
  return json;
}
