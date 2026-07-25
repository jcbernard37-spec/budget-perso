/* ==================================================================
   MOTEUR D'IMPORT UNIVERSEL
   ------------------------------------------------------------------
   Objectif : accepter n'importe quel relevé bancaire (CSV, TXT, XLSX)
   sans dépendre d'un format figé, et trier automatiquement les lignes
   par LIBELLÉ (et non par colonne débit/crédit, qui ment souvent).
   ================================================================== */

/* ------------------------------------------------------------------ */
/*  1. Lecture fichier + détection d'encodage                          */
/* ------------------------------------------------------------------ */

// Les banques françaises exportent en CP1252/ISO-8859-1 la moitié du temps.
// On lit d'abord en UTF-8 : si on voit le caractère de remplacement (U+FFFD)
// ou des séquences typiques d'un mauvais décodage, on relit en windows-1252.
export function readFileSmart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
    reader.onload = (e) => {
      const utf8 = e.target.result;
      const looksBroken =
        utf8.includes("\uFFFD") ||
        /Ã©|Ã¨|Ã |Ã´|Ã§|Â€/.test(utf8); // "é" mal décodé, etc.

      if (!looksBroken) return resolve(utf8);

      const r2 = new FileReader();
      r2.onerror = () => resolve(utf8); // en dernier recours on garde l'UTF-8
      r2.onload = (e2) => resolve(e2.target.result);
      r2.readAsText(file, "windows-1252");
    };
    reader.readAsText(file, "utf-8");
  });
}

/* ------------------------------------------------------------------ */
/*  2. Détection du séparateur                                         */
/* ------------------------------------------------------------------ */

export function detectDelimiter(text) {
  const sample = text.split("\n").slice(0, 60).join("\n");
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestScore = -1;

  for (const d of candidates) {
    // On compte le nombre de colonnes par ligne ; le bon séparateur est
    // celui qui donne un nombre de colonnes stable et > 1.
    const counts = sample
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => splitRespectingQuotes(l, d).length);
    if (!counts.length) continue;
    const max = Math.max(...counts);
    if (max < 2) continue;
    const modal = counts.filter((c) => c === max).length;
    const score = max * modal;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// Split qui ignore les séparateurs situés à l'intérieur de guillemets.
// Indispensable : les libellés du Crédit Agricole contiennent des ';'
// et des retours à la ligne encadrés par des '"'.
export function splitRespectingQuotes(line, delim) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Guillemet doublé = guillemet littéral
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === delim && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------------ */
/*  3. Découpage en enregistrements (gère les libellés multi-lignes)   */
/* ------------------------------------------------------------------ */

// Un enregistrement peut s'étaler sur plusieurs lignes physiques si un
// champ entre guillemets contient des \n. On recolle avant de parser.
function toRecords(text, delim) {
  const rows = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQ = !inQ;
      cur += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) rows.push(cur);

  return rows
    .map((r) => splitRespectingQuotes(r, delim).map((c) => c.replace(/^"|"$/g, "").trim()))
    .filter((cells) => cells.some((c) => c !== ""));
}

/* ------------------------------------------------------------------ */
/*  4. Détection des colonnes                                          */
/* ------------------------------------------------------------------ */

const HEADER_HINTS = {
  date: ["date", "date operation", "date opération", "date valeur", "date de valeur", "date comptable", "jour"],
  label: ["libelle", "libellé", "description", "nature", "intitule", "intitulé", "operation", "opération", "detail", "détail", "motif", "objet"],
  debit: ["debit", "débit", "debit euros", "débit euros", "sortie", "sortie d'argent", "retrait", "depense", "dépense"],
  credit: ["credit", "crédit", "credit euros", "crédit euros", "entree", "entrée", "entree d'argent", "entrée d'argent", "versement", "recette"],
  amount: ["montant", "montant euros", "somme", "valeur", "amount"],
};

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function matchHeader(cell, hints) {
  const n = norm(cell);
  if (!n) return false;
  return hints.some((h) => {
    const hn = norm(h);
    return n === hn || n.startsWith(hn) || hn.startsWith(n);
  });
}

const DATE_RE = /^\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s*$|^\s*(\d{4})-(\d{2})-(\d{2})/;

// Cherche la ligne d'en-tête : celle qui contient au minimum une colonne
// "date" et une colonne "libellé". Si aucun en-tête n'est trouvé, on
// bascule en détection heuristique sur le contenu.
function findHeader(records) {
  for (let i = 0; i < Math.min(records.length, 40); i++) {
    const cells = records[i];
    const map = { date: -1, label: -1, debit: -1, credit: -1, amount: -1 };
    cells.forEach((c, idx) => {
      for (const key of Object.keys(HEADER_HINTS)) {
        if (map[key] === -1 && matchHeader(c, HEADER_HINTS[key])) map[key] = idx;
      }
    });
    const hasAmount = map.debit >= 0 || map.credit >= 0 || map.amount >= 0;
    if (map.date >= 0 && map.label >= 0 && hasAmount) {
      return { headerIndex: i, map };
    }
  }
  return null;
}

// Pas d'en-tête reconnu : on devine à partir des données.
// Colonne date = celle qui contient le plus de dates valides.
// Colonne montant = celle qui contient le plus de nombres.
// Colonne libellé = la plus longue en moyenne parmi les colonnes texte.
function guessColumns(records) {
  const body = records.filter((r) => r.some((c) => DATE_RE.test(c)));
  if (body.length < 2) return null;
  const width = Math.max(...body.map((r) => r.length));

  const dateScore = new Array(width).fill(0);
  const numScore = new Array(width).fill(0);
  const textLen = new Array(width).fill(0);

  for (const row of body) {
    for (let c = 0; c < width; c++) {
      const v = row[c] || "";
      if (DATE_RE.test(v)) dateScore[c]++;
      else if (parseAmount(v) !== null) numScore[c]++;
      else textLen[c] += v.length;
    }
  }

  const dateIdx = dateScore.indexOf(Math.max(...dateScore));
  const labelIdx = textLen.indexOf(Math.max(...textLen));
  const numCols = numScore
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s > body.length * 0.15 && x.i !== dateIdx)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);

  if (dateIdx < 0 || labelIdx < 0 || !numCols.length) return null;

  // Deux colonnes numériques distinctes -> probablement débit / crédit
  if (numCols.length >= 2) {
    const [a, b] = numCols.slice(0, 2).sort((x, y) => x - y);
    return { headerIndex: -1, map: { date: dateIdx, label: labelIdx, debit: a, credit: b, amount: -1 } };
  }
  return { headerIndex: -1, map: { date: dateIdx, label: labelIdx, debit: -1, credit: -1, amount: numCols[0] } };
}

/* ------------------------------------------------------------------ */
/*  5. Parsing des valeurs                                             */
/* ------------------------------------------------------------------ */

// Accepte "1 234,56", "1,234.56", "-45.90", "45,90 €", "(45,90)"
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[€$£\s\u00A0]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // format FR : la virgule est le séparateur décimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // format EN : le point est le séparateur décimal
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

// Renvoie une date ISO (YYYY-MM-DD) quelle que soit la forme d'entrée.
export function parseDate(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 70 ? "19" : "20") + y;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/* ------------------------------------------------------------------ */
/*  6. Catégorisation par LIBELLÉ                                      */
/* ------------------------------------------------------------------ */
/*  Règle fondamentale : c'est le libellé qui décide, pas la colonne.
    Un "Paiement par carte LECLERC" est une dépense alimentation même
    s'il apparaît en crédit (annulation, remboursement partiel...).     */

// Chaque règle : { re: RegExp, type, category, label }
// L'ordre compte : les règles les plus spécifiques d'abord.
const RULES = [
  /* --- REVENUS --- */
  { re: /\bsalaire\b|nrco siege|siege social.*salaire|paie\b|bulletin de paie|remuneration|rémunération/i, type: "revenu", category: "salaire", label: "Salaire" },
  { re: /\bcaf\b|caisse d.?allocations|allocations familiales|\bapl\b|aide au logement|prime d.?activite|prime d.?activité/i, type: "revenu", category: "caf", label: "CAF / APL" },
  { re: /france travail|pole emploi|pôle emploi|assedic/i, type: "revenu", category: "autre", label: "France Travail" },
  { re: /dgfip|finances publiques|tresor public|trésor public|impots.*(remb|rembours)/i, type: "revenu", category: "autre", label: "DGFiP / Impôts" },
  { re: /audiens|mutuelle.*(remb|prest)|prevoyance.*prest|prévoyance.*prest|remboursement.*(sante|santé|mutuelle)|\bcpam\b|assurance maladie|ameli/i, type: "revenu", category: "autre", label: "Remboursement santé" },
  { re: /pension alimentaire (recue|reçue|percue|perçue)/i, type: "revenu", category: "pension", label: "Pension alimentaire perçue" },
  { re: /\bprime\b|bonus|13e mois|treizieme mois/i, type: "revenu", category: "prime", label: "Prime" },
  { re: /vinted|leboncoin|le bon coin|vente\b/i, type: "revenu", category: "autre", label: "Vente occasion" },
  { re: /remboursement|\bremb\b|moitie|moitié|virement en votre faveur|vir inst de|incoming transfer/i, type: "revenu", category: "autre", label: "Virement reçu" },

  /* --- LOGEMENT --- */
  { re: /cdc habitat|\bloyer\b|bailleur|\bhlm\b|office public|opac|\bicf\b|foncia|nexity|syndic|copropriete|copropriété|charges locatives/i, type: "charge", category: "logement", label: "Logement" },
  { re: /assurance habitation|\bmaif\b.*habitation|habitation.*assurance/i, type: "charge", category: "logement", label: "Assurance habitation" },
  { re: /taxe fonciere|taxe foncière|taxe d.?habitation|ordures menageres|ordures ménagères/i, type: "charge", category: "logement", label: "Taxe / charges" },

  /* --- ÉNERGIE & COMMUNICATION --- */
  { re: /\bedf\b|electricite de france|électricité de france|engie|total energies|totalenergies|ekwateur|enercoop|\bgrdf\b|\benedis\b/i, type: "charge", category: "energie", label: "Électricité / Gaz" },
  { re: /veolia|\bsaur\b|suez|eau de |compagnie generale des eaux|compagnie générale des eaux|syndicat des eaux/i, type: "charge", category: "energie", label: "Eau" },
  { re: /\bsfr\b|\borange\b|bouygues|\bfree\b|sosh|red by|\bnrj mobile\b|prixtel|telecom|mobile.*forfait|box internet/i, type: "charge", category: "energie", label: "Téléphone / Internet" },

  /* --- TRANSPORT --- */
  { re: /\bmacif\b|\bmaaf\b|\bmatmut\b|\bgmf\b|\bamv\b|allianz|\baxa\b|groupama|direct assurance|assurance auto|assurance moto|assurance vehicule|assurance véhicule/i, type: "charge", category: "transport", label: "Assurance véhicule" },
  { re: /carbu|carburant|essence|station u|station service|\btotal\b|\bbp \b|\besso\b|\bshell\b|avia|intermarche carbu|leclerc carbu|auchan carbu|dac auchan/i, type: "charge", category: "transport", label: "Carburant" },
  { re: /cofiroute|autoroute|\bvinci\b|\basf\b|\bsanef\b|\baprr\b|peage|péage|telepeage|télépéage/i, type: "charge", category: "transport", label: "Péage" },
  { re: /norauto|feu vert|midas|speedy|garage|controle technique|contrôle technique|dekra|autosur|carte grise|\bsiv\b|pneu/i, type: "charge", category: "transport", label: "Entretien véhicule" },
  { re: /\bsncf\b|\bratp\b|navigo|keolis|\btcl\b|\btan\b|fil bleu|\bbus\b|\btram\b|blablacar|\buber\b(?!.*eats)|\bta[xy]i\b/i, type: "charge", category: "transport", label: "Transport" },
  { re: /\beffia\b|indigo park|parking|\bgab\b.*parking|aqua auto|lavage auto|station de lavage/i, type: "charge", category: "transport", label: "Parking / lavage" },

  /* --- ALIMENTATION --- */
  { re: /leclerc|carrefour|\blidl\b|\baldi\b|intermarche|intermarché|super u|hyper u|\bu express\b|auchan|casino|monoprix|franprix|\bcora\b|\bmatch\b|grand frais|biocoop|naturalia|picard|\bnetto\b|\bspar\b|\bproxi\b/i, type: "charge", category: "alimentation", label: "Courses" },
  { re: /uber ?\*?eats|deliveroo|just ?eat|frichti|\bdelivery\b/i, type: "charge", category: "alimentation", label: "Livraison repas" },
  { re: /mcdo|mc ?donald|burger king|\bkfc\b|quick\b|subway|\bpizza\b|pizzeria|padova|restaurant|brasserie|\bbar\b|\bcafe\b|\bcafé\b|maxicoffee|boulangerie|patisserie|pâtisserie|boucherie|traiteur|\bsnack\b|le pacio|citizen bar|le napoleon|vins sur|l.?artiblo|saveur du bon|lambassadeur|le prety/i, type: "charge", category: "alimentation", label: "Restaurant / bar" },
  { re: /distributeur automatique|vending|nyx\*/i, type: "charge", category: "alimentation", label: "Distributeur" },
  { re: /\brelay\b|patapain|patàpain|paul\b|brioche doree|brioche dorée|columbus cafe|starbucks|maxi ?coffee/i, type: "charge", category: "alimentation", label: "Snack / café" },
  { re: /au bureau|la manufacture|le longchamp|jean jau|maison gloria|la civette|le qg\b|\bpub\b|taverne|bistrot|le pacio|citizen|napoleon|napoléon/i, type: "charge", category: "alimentation", label: "Bar / restaurant" },

  /* --- ENFANTS --- */
  { re: /creche|crèche|halte garderie|assistante maternelle|\bassmat\b|nounou/i, type: "charge", category: "enfants", label: "Crèche / garde" },
  { re: /cantine|restauration scolaire|periscolaire|périscolaire|garderie|centre de loisirs|regie unique|régie unique|\bkadoro\b|lycee|lycée|college|collège|ecole|école/i, type: "charge", category: "enfants", label: "Cantine / périscolaire" },
  { re: /petits culott|pampers|\bbebe\b|\bbébé\b|orchestra|vertbaudet|okaidi|sergent major|jouet|\bkiabi\b/i, type: "charge", category: "enfants", label: "Enfants - équipement" },
  { re: /pension alimentaire (versee|versée|payee|payée)|pension alimentaire$/i, type: "charge", category: "enfants", label: "Pension alimentaire versée" },

  /* --- SANTÉ --- */
  { re: /pharmacie|\bpharma\b/i, type: "charge", category: "sante", label: "Pharmacie" },
  { re: /docteur|\bdr \b|cabinet medical|cabinet médical|doctolib|laboratoire|\bselas\b|\bscm\b|dentiste|ophtalmo|kine|kiné|kinesither|kinésithér|osteopathe|ostéopathe|infirmier|hopital|hôpital|clinique|radiologie/i, type: "charge", category: "sante", label: "Frais médicaux" },
  { re: /predica|harmonie mutuelle|malakoff|\bmgen\b|\bmnh\b|apivia|\bswisslife\b|mutuelle|complementaire sante|complémentaire santé|prevoyance|prévoyance/i, type: "charge", category: "sante", label: "Mutuelle / prévoyance" },

  /* --- AUTRES CHARGES --- */
  { re: /netflix|spotify|deezer|disney|canal ?\+|amazon prime|apple\.com|itunes|google ?\*|\bpaypal\b|anthropic|claude\.ai|openai|elevenlabs|adobe|microsoft|abonnement/i, type: "charge", category: "autres", label: "Abonnement" },
  { re: /credit conso|crédit conso|pret personnel|prêt personnel|\bcofidis\b|\bcetelem\b|\bsofinco\b|\bcofinoga\b|echeance pret|échéance prêt|remboursement pret|remboursement prêt/i, type: "charge", category: "autres", label: "Crédit" },
  { re: /frais bancaire|cotisation carte|commission d.?intervention|agios|frais de tenue|frais tenue de compte/i, type: "charge", category: "autres", label: "Frais bancaires" },
  { re: /retrait|\bgab\b|distributeur de billets|\batm\b/i, type: "charge", category: "autres", label: "Retrait espèces" },
  { re: /amazon|\bfnac\b|cdiscount|cultura|action\b|\bb&m\b|gifi|decathlon|courir|zalando|shein|\bvinted\b.*achat/i, type: "charge", category: "autres", label: "Achats divers" },
  { re: /coiffeur|barbier|barbi|salon de coiffure|esthetique|esthétique|institut/i, type: "charge", category: "autres", label: "Coiffeur / soins" },
  { re: /hotel|hôtel|premiere classe|première classe|ibis|\bb&b\b|airbnb|booking|camping|gite|gîte/i, type: "charge", category: "autres", label: "Hébergement" },
  { re: /salle de sport|basic fit|fitness park|\bgym\b|piscine|club sportif|licence sportive|hello asso/i, type: "charge", category: "autres", label: "Sport / loisirs" },
  { re: /crca|caisse reg cred agric|credit agricole touraine|crédit agricole touraine/i, type: "charge", category: "autres", label: "Prélèvement Crédit Agricole" },
  { re: /quatre pattes|animalerie|veterinaire|vétérinaire|maxi ?zoo|croquettes/i, type: "charge", category: "autres", label: "Animaux" },
  { re: /carte grise|\bsiv\b|prefecture|préfecture|\bants\b/i, type: "charge", category: "transport", label: "Démarche véhicule" },
];

/* Impôts SORTANTS : un prélèvement DGFiP est une charge, pas un revenu.
   Cette règle est appliquée après la détection du sens (voir categorize). */
const IMPOTS_RE = /dgfip|finances publiques|direction generale des finances|direction générale des finances|tresor public|trésor public|impot|impôt/i;

/* --- Détection du SENS de l'opération ---------------------------------
   C'est le signal le plus fiable, avant même le marchand.
   "Virement émis vers X"        -> argent qui SORT
   "Virement en votre faveur X"  -> argent qui ENTRE
   Un "Prélèvement DGFIP" est une charge ; un "Virement en votre faveur
   DGFIP" est un remboursement. Le marchand seul ne permet pas de trancher. */

const SORTANT = /virement emis|virement émis|\bprelevement\b|\bprélèvement\b|paiement par carte|\bretrait\b|wero vers|vers\b.*\bplacement\b|outgoing transfer|\bdebit\b.*carte|cheque emis|chèque émis|\bfrais\b|cotisation/i;

const ENTRANT = /virement en votre faveur|en votre faveur|incoming transfer|remise de ch|interets crediteurs|intérêts créditeurs|annul\.? ?op|annulation.*debitrice|annulation.*débitrice|\bavoir\b|versement recu|versement reçu/i;

export function detectDirection(libelle) {
  const l = libelle || "";
  // L'entrant est testé en premier : "Annul. opé. débitrices PREL ..."
  // contient "PREL" mais c'est bien un remboursement.
  if (ENTRANT.test(l)) return "in";
  if (SORTANT.test(l)) return "out";
  return null;
}

/* --- Épargne / mouvements internes ------------------------------------
   Virement vers soi-même, PEA, Trade Republic : ce n'est ni une dépense
   ni un revenu, c'est un déplacement d'argent. Traité à part. */
const EPARGNE_RE = /versement pea|savings plan|buy trade|trade ?r?republi|\bpea\b|livret a\b|\bldds\b|assurance vie|\betf\b|ishares|amundi|bnp paribas easy|\bplacement\b|vers jean christophe|vers m\.? bernard|de jean christophe/i;

/**
 * Classement final d'une ligne.
 * @param {string} libelle
 * @param {"debit"|"credit"|null} colSign  ce que dit la colonne bancaire
 */
export function categorize(libelle, colSign = null) {
  const l = libelle || "";

  // 1. Épargne / mouvement interne : prioritaire, quel que soit le sens
  if (EPARGNE_RE.test(l)) {
    return { type: "epargne", category: "epargne", label: "Épargne / placement", matched: true };
  }

  // 2. Sens de l'opération (libellé > colonne bancaire)
  const dir = detectDirection(l) || (colSign === "credit" ? "in" : colSign === "debit" ? "out" : null);

  // 3. Marchand / nature -> donne la CATÉGORIE
  let rule = null;
  for (const r of RULES) {
    if (r.re.test(l)) {
      rule = r;
      break;
    }
  }

  if (!dir) {
    // Aucun sens détecté : on se fie entièrement à la règle marchand
    if (rule) return { type: rule.type, category: rule.category, label: rule.label, matched: true };
    return { type: null, category: null, label: null, matched: false };
  }

  if (dir === "in") {
    // Argent entrant : c'est un revenu. La règle affine juste l'origine.
    const cat =
      rule && rule.type === "revenu" ? rule.category
      : /caf\b|allocations|\bapl\b/i.test(l) ? "caf"
      : /salaire|paie\b|nrco/i.test(l) ? "salaire"
      : /prime\b/i.test(l) ? "prime"
      : /pension alimentaire/i.test(l) ? "pension"
      : "autre";
    return {
      type: "revenu",
      category: cat,
      label: rule && rule.type === "revenu" ? rule.label : null,
      matched: Boolean(rule) || cat !== "autre",
    };
  }

  // dir === "out" : argent sortant, c'est une charge.
  // Cas particulier : un prélèvement du fisc est un impôt payé.
  if (IMPOTS_RE.test(l)) {
    return { type: "charge", category: "autres", label: "Impôts", matched: true };
  }
  // La règle marchand donne la catégorie de dépense.
  if (rule && rule.type === "charge") {
    return { type: "charge", category: rule.category, label: rule.label, matched: true };
  }
  return { type: "charge", category: "autres", label: null, matched: Boolean(rule) };
}

/* ------------------------------------------------------------------ */
/*  7. Parsing complet d'un relevé                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {string} text        contenu du fichier
 * @param {object} learned     { "MOT CLE": {type, category} } règles apprises
 * @returns {{ok:boolean, transactions?:Array, error?:string, columns?:object, preview?:Array}}
 */
export function parseStatement(text, learned = {}) {
  if (!text || !text.trim()) {
    return { ok: false, error: "Le fichier est vide." };
  }

  const delim = detectDelimiter(text);
  const records = toRecords(text, delim);
  if (records.length < 2) {
    return { ok: false, error: "Aucune ligne exploitable trouvée dans le fichier." };
  }

  let detected = findHeader(records);
  let body;
  if (detected) {
    body = records.slice(detected.headerIndex + 1);
  } else {
    detected = guessColumns(records);
    if (!detected) {
      return {
        ok: false,
        error: "Colonnes non identifiées automatiquement.",
        needsMapping: true,
        preview: records.slice(0, 12),
        delimiter: delim,
      };
    }
    body = records;
  }

  const { map } = detected;
  const transactions = [];

  for (const cells of body) {
    const dateISO = parseDate(cells[map.date]);
    if (!dateISO) continue; // ligne de total, de solde, etc.

    const libelle = (cells[map.label] || "").replace(/\s+/g, " ").trim();
    if (!libelle) continue;

    // Montant : soit deux colonnes débit/crédit, soit une colonne signée
    let montant = null;
    let colSign = null; // "debit" | "credit" — ce que dit la banque
    if (map.amount >= 0) {
      const v = parseAmount(cells[map.amount]);
      if (v === null || v === 0) continue;
      montant = Math.abs(v);
      colSign = v < 0 ? "debit" : "credit";
    } else {
      const d = parseAmount(cells[map.debit]);
      const c = parseAmount(cells[map.credit]);
      if (d) {
        montant = Math.abs(d);
        colSign = "debit";
      } else if (c) {
        montant = Math.abs(c);
        colSign = "credit";
      } else continue;
    }
    if (!montant) continue;

    // --- Classement : sens de l'opération + libellé priment sur la colonne ---
    let verdict = applyLearned(libelle, learned) || categorize(libelle, colSign);

    if (!verdict.type) {
      // Cas extrême : ni sens ni marchand reconnus -> on suit la banque
      verdict = {
        type: colSign === "credit" ? "revenu" : "charge",
        category: colSign === "credit" ? "autre" : "autres",
        label: null,
        matched: false,
      };
    }

    transactions.push({
      dateISO,
      dateFR: isoToFR(dateISO),
      libelle,
      montant,
      colSign,
      type: verdict.type, // "revenu" | "charge" | "epargne"
      category: verdict.category,
      autoLabel: verdict.label,
      certain: verdict.matched,
      // signalé si la banque et le libellé ne disent pas la même chose
      conflit: verdict.matched && verdict.type !== "epargne" &&
        ((colSign === "credit" && verdict.type === "charge") ||
         (colSign === "debit" && verdict.type === "revenu")),
      selected: true,
      key: dedupKey(dateISO, montant, libelle),
    });
  }

  if (!transactions.length) {
    return { ok: false, error: "Aucune transaction lisible. Vérifie que le fichier contient bien des lignes d'opérations." };
  }

  return { ok: true, transactions, columns: map, delimiter: delim };
}

function applyLearned(libelle, learned) {
  const l = norm(libelle);
  for (const key of Object.keys(learned || {})) {
    if (l.includes(norm(key))) {
      return { ...learned[key], label: null, matched: true };
    }
  }
  return null;
}

export const isoToFR = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/* ------------------------------------------------------------------ */
/*  8. Anti-doublons                                                   */
/* ------------------------------------------------------------------ */

export function dedupKey(dateISO, montant, libelle) {
  return [
    dateISO,
    Math.round(montant * 100),
    norm(libelle).slice(0, 40),
  ].join("|");
}

/** Retire les transactions déjà présentes dans l'historique. */
export function removeDuplicates(transactions, existingKeys) {
  const seen = new Set(existingKeys || []);
  const kept = [];
  let removed = 0;
  for (const t of transactions) {
    if (seen.has(t.key)) {
      removed++;
      continue;
    }
    seen.add(t.key);
    kept.push(t);
  }
  return { kept, removed };
}

/* ------------------------------------------------------------------ */
/*  9. Détection des récurrences                                       */
/* ------------------------------------------------------------------ */

/**
 * Repère les opérations qui reviennent chaque mois (à montant proche) :
 * ce sont les charges fixes / revenus réguliers.
 * Renvoie [{ libelle, category, type, montantMoyen, occurrences, mois }]
 */
export function detectRecurring(transactions, { minOccurrences = 2, tolerance = 0.15 } = {}) {
  const groups = new Map();

  for (const t of transactions) {
    if (t.type === "epargne") continue;
    const k = signature(t.libelle) + "|" + t.type;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const out = [];
  for (const [, items] of groups) {
    const mois = new Set(items.map((i) => i.dateISO.slice(0, 7)));
    if (mois.size < minOccurrences) continue;

    const montants = items.map((i) => i.montant);
    const moyenne = montants.reduce((a, b) => a + b, 0) / montants.length;
    // On exige une certaine stabilité du montant (sinon c'est du variable)
    const stable = montants.every((m) => Math.abs(m - moyenne) <= moyenne * tolerance + 2);
    if (!stable) continue;

    const ref = items[0];
    out.push({
      libelle: cleanLabel(ref.libelle),
      type: ref.type,
      category: ref.category,
      montantMoyen: Math.round(moyenne * 100) / 100,
      occurrences: items.length,
      mois: [...mois].sort(),
      jour: Number(ref.dateISO.slice(8, 10)) || null,
    });
  }

  return out.sort((a, b) => b.montantMoyen - a.montantMoyen);
}

// Signature = libellé débarrassé des dates, numéros de carte, références.
function signature(libelle) {
  return norm(libelle)
    .replace(/\b\d{2}[\/\-.]\d{2}([\/\-.]\d{2,4})?\b/g, " ")
    .replace(/\bx?\d{4,}\b/g, " ")
    .replace(/\b(paiement par carte|prelevement|prélèvement|virement emis|virement émis|virement en votre faveur|carte)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(" ");
}

// Libellé lisible pour l'affichage : on coupe les références techniques.
export function cleanLabel(libelle) {
  let s = String(libelle || "")
    .replace(/\b[A-Z0-9]{10,}\b/g, "")
    .replace(/\bx?\d{6,}\b/gi, "")
    .replace(/\b\d{2}\/\d{2}\b/g, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > 48) s = s.slice(0, 48).trim() + "…";
  return s || "Opération";
}

/* ------------------------------------------------------------------ */
/*  10. Agrégations mensuelles                                         */
/* ------------------------------------------------------------------ */

export const monthKey = (iso) => (iso || "").slice(0, 7); // "2026-07"

export function monthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  return `${mois[Number(m) - 1]} ${y}`;
}

/** Liste des mois présents dans les transactions, du plus récent au plus ancien. */
export function availableMonths(transactions) {
  const s = new Set(transactions.map((t) => monthKey(t.dateISO)));
  return [...s].sort().reverse();
}

/** Totaux d'un mois donné. */
export function monthTotals(transactions, key) {
  const rows = transactions.filter((t) => monthKey(t.dateISO) === key);
  let revenus = 0;
  let charges = 0;
  let epargne = 0;
  const parCategorie = {};

  for (const t of rows) {
    if (t.type === "revenu") revenus += t.montant;
    else if (t.type === "epargne") epargne += t.montant;
    else {
      charges += t.montant;
      parCategorie[t.category] = (parCategorie[t.category] || 0) + t.montant;
    }
  }
  return {
    revenus: round2(revenus),
    charges: round2(charges),
    epargne: round2(epargne),
    reste: round2(revenus - charges - epargne),
    parCategorie,
    nb: rows.length,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Reste par jour jusqu'à la fin du mois (pour le mois en cours uniquement). */
export function resteParJour(reste, key) {
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (key !== currentKey) return null;
  const dernierJour = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const joursRestants = Math.max(1, dernierJour - now.getDate() + 1);
  return { parJour: round2(reste / joursRestants), joursRestants };
}
