/* ==================================================================
   ÉCHÉANCES ADMINISTRATIVES & PROVISIONS
   ------------------------------------------------------------------
   Deux choses distinctes :

   1. Les ÉCHÉANCES = des démarches à ne pas oublier. Elles ne coûtent
      rien en soi, mais les oublier coûte cher (allocation suspendue,
      majoration de 10 %, surloyer appliqué...).

   2. Les PROVISIONS = des dépenses réelles mais non mensuelles
      (assurance annuelle, rentrée scolaire, contrôle technique).
      L'appli calcule combien mettre de côté chaque mois pour les
      absorber sans trou dans le budget.

   Les dates administratives varient d'une année à l'autre : celles
   ci-dessous sont les repères habituels, à ajuster si besoin.
   ================================================================== */

/* ------------------------------------------------------------------ */
/*  1. Catalogue des échéances récurrentes                             */
/* ------------------------------------------------------------------ */

/**
 * frequence : "mensuel" | "trimestriel" | "annuel"
 * mois      : 1-12 (pour annuel) ou mois de départ (pour trimestriel)
 * jour      : jour du mois
 * profil    : conditions d'apparition (pour ne proposer que le pertinent)
 */
/* ------------------------------------------------------------------ */
/*  Zones fiscales : la date limite de déclaration dépend du            */
/*  département de résidence au 1er janvier.                            */
/*    Zone 1 : 01 à 19 + non-résidents  -> ~21 mai                      */
/*    Zone 2 : 20 à 54                  -> ~28 mai                      */
/*    Zone 3 : 55 à 976                 -> ~4 juin                      */
/*  Déclaration papier : ~19 mai, quel que soit le département.         */
/*  Ces dates glissent de quelques jours chaque année : la date qui     */
/*  fait foi est celle affichée dans l'espace particulier impots.gouv.  */
/* ------------------------------------------------------------------ */

export function zoneFiscale(departement) {
  const n = parseInt(String(departement || "").slice(0, 2), 10);
  if (!n || Number.isNaN(n)) return 2;
  if (n <= 19) return 1;
  if (n <= 54) return 2;
  return 3;
}

// Jour indicatif de la date limite en ligne, par zone.
const JOUR_DECLARATION = { 1: { mois: 5, jour: 21 }, 2: { mois: 5, jour: 28 }, 3: { mois: 6, jour: 4 } };

export function dateDeclaration(departement) {
  return JOUR_DECLARATION[zoneFiscale(departement)];
}

export const ECHEANCES_TYPES = [
  {
    id: "france-travail",
    titre: "Actualisation France Travail",
    category: "autre",
    frequence: "mensuel",
    jour: 28,
    rappels: [3, 1],
    profil: ["france_travail"],
    enjeu: "Sans actualisation entre le 28 et le 15, le paiement du mois est suspendu.",
    notes: "À faire sur francetravail.fr ou l'appli. Fenêtre : du 28 du mois au 15 du mois suivant.",
  },
  {
    id: "caf-trimestrielle",
    titre: "Déclaration trimestrielle de ressources CAF",
    category: "caf",
    frequence: "trimestriel",
    jour: 5,
    moisDepart: 1, // janvier, avril, juillet, octobre
    rappels: [7, 2],
    profil: ["caf"],
    enjeu: "Sans déclaration, la prime d'activité et le RSA sont suspendus.",
    notes: "Concerne la prime d'activité et le RSA. Se fait sur caf.fr, rubrique « Mes ressources ».",
  },
  {
    id: "declaration-revenus",
    titre: "Déclaration de revenus",
    category: "impots",
    frequence: "annuel",
    mois: 5,
    jour: 28,
    zoneDependante: true, // date recalculée selon le département
    rappels: [30, 7, 1],
    profil: ["tous"],
    enjeu: "Retard = majoration de 10 % du montant dû.",
    notes: "Le service ouvre début avril. Date limite en ligne selon la zone du département ; déclaration papier ~19 mai partout. La date qui fait foi est celle affichée dans ton espace sur impots.gouv.fr.",
  },
  {
    id: "avis-imposition",
    titre: "Réception de l'avis d'imposition",
    category: "impots",
    frequence: "annuel",
    mois: 8,
    jour: 1,
    rappels: [7],
    profil: ["tous"],
    enjeu: "L'avis sert de justificatif pour la CAF, le bailleur, la cantine et le périscolaire.",
    notes: "Disponible en ligne fin juillet / août. À télécharger et garder : plusieurs organismes le demandent dans l'année.",
  },
  {
    id: "taux-prelevement",
    titre: "Mettre à jour le taux de prélèvement à la source",
    category: "impots",
    frequence: "annuel",
    mois: 9,
    jour: 15,
    rappels: [15],
    profil: ["tous"],
    enjeu: "Un taux non actualisé après un changement de situation fait payer trop (ou trop peu, avec régularisation ensuite).",
    notes: "Tout changement de situation familiale se déclare sous 60 jours sur impots.gouv.fr → « Gérer mon prélèvement à la source ».",
  },
  {
    id: "enquete-ressources-hlm",
    titre: "Enquête ressources du bailleur (SLS/OPS)",
    category: "autre",
    frequence: "annuel",
    mois: 2,
    jour: 15,
    rappels: [21, 7],
    profil: ["locataire_social"],
    enjeu: "Absence de réponse = surloyer appliqué d'office, parfois plusieurs centaines d'euros par mois.",
    notes: "Questionnaire envoyé par le bailleur en début d'année. Réponse obligatoire.",
  },
  {
    id: "attestation-assurance-habitation",
    titre: "Envoyer l'attestation d'assurance habitation au bailleur",
    category: "assurance",
    frequence: "annuel",
    mois: 1,
    jour: 15,
    rappels: [15],
    profil: ["locataire"],
    enjeu: "Sans attestation, le bailleur peut souscrire une assurance à ta place et te la facturer.",
    notes: "Attestation annuelle à demander à l'assureur puis à transmettre au bailleur.",
  },
  {
    id: "rentree-scolaire",
    titre: "Inscriptions scolaires / cantine / périscolaire",
    category: "enfants",
    frequence: "annuel",
    mois: 6,
    jour: 1,
    rappels: [21, 7],
    profil: ["enfants"],
    enjeu: "Dossier hors délai = pas de place en cantine ou en périscolaire à la rentrée.",
    notes: "Dossier de réinscription en mai-juin, souvent avec avis d'imposition à fournir pour le calcul du quotient.",
  },
  {
    id: "ars",
    titre: "Allocation de rentrée scolaire (vérifier le versement)",
    category: "caf",
    frequence: "annuel",
    mois: 8,
    jour: 20,
    rappels: [7],
    profil: ["enfants", "caf"],
    enjeu: "Versée automatiquement dès 6 ans, mais à déclarer soi-même pour les 16-18 ans.",
    notes: "Versement mi-août. Pour un enfant de plus de 16 ans, déclarer la poursuite de scolarité sur caf.fr.",
  },
  {
    id: "quotient-familial",
    titre: "Vérifier le quotient familial CAF",
    category: "caf",
    frequence: "annuel",
    mois: 1,
    jour: 20,
    rappels: [7],
    profil: ["caf"],
    enjeu: "Le quotient conditionne les APL, les allocations et les tarifs crèche/cantine.",
    notes: "Après un changement de situation familiale, il doit être recalculé. À vérifier sur caf.fr.",
  },
  {
    id: "controle-technique",
    titre: "Contrôle technique du véhicule",
    category: "vehicule",
    frequence: "annuel",
    mois: 3,
    jour: 1,
    rappels: [30, 7],
    profil: ["vehicule"],
    enjeu: "Contrôle expiré = amende et véhicule non assuré en cas de sinistre.",
    notes: "Tous les 2 ans pour un véhicule de plus de 4 ans. Ajuster la date selon ta carte grise.",
  },
  {
    id: "resiliation-assurances",
    titre: "Fenêtre de résiliation des assurances",
    category: "assurance",
    frequence: "annuel",
    mois: 10,
    jour: 1,
    rappels: [30],
    profil: ["tous"],
    enjeu: "Passée la date anniversaire, le contrat est reconduit pour un an.",
    notes: "Loi Hamon : résiliation possible à tout moment après 1 an d'ancienneté. Bon moment pour comparer auto, habitation et mutuelle.",
  },
];

/* ------------------------------------------------------------------ */
/*  2. Génération des dates concrètes                                  */
/* ------------------------------------------------------------------ */

/** Prochaine occurrence d'une échéance type, à partir d'aujourd'hui. */
export function prochaineDate(type, depuis = new Date()) {
  const y = depuis.getFullYear();
  const m = depuis.getMonth() + 1;

  if (type.frequence === "mensuel") {
    const d = new Date(y, depuis.getMonth(), type.jour);
    if (d < depuis) d.setMonth(d.getMonth() + 1);
    return iso(d);
  }

  if (type.frequence === "trimestriel") {
    const depart = type.moisDepart || 1;
    for (let i = 0; i < 8; i++) {
      const mois = depart + i * 3;
      const annee = y + Math.floor((mois - 1) / 12);
      const moisNorm = ((mois - 1) % 12) + 1;
      const d = new Date(annee, moisNorm - 1, type.jour);
      if (d >= depuis) return iso(d);
    }
    return iso(new Date(y + 1, depart - 1, type.jour));
  }

  // annuel
  const annee = type.mois >= m ? y : y + 1;
  return iso(new Date(annee, type.mois - 1, type.jour));
}

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Construit les échéances à insérer dans le budget.
 * @param {string[]} profils  ex: ["caf","enfants","locataire_social","vehicule"]
 */
export function genererEcheances(profils = ["tous"], uid = () => Math.random().toString(36).slice(2), departement = "") {
  const actifs = new Set([...profils, "tous"]);
  const zone = dateDeclaration(departement);
  return ECHEANCES_TYPES.filter((t) => t.profil.some((p) => actifs.has(p))).map((t) => {
    // La déclaration de revenus dépend de la zone fiscale du département
    const type = t.zoneDependante ? { ...t, mois: zone.mois, jour: zone.jour } : t;
    return {
    id: uid(),
    typeId: t.id,
    title: t.titre,
    category: t.category,
    date: prochaineDate(type),
    montant: "",
    notes: `${t.enjeu}\n\n${t.notes}`,
    rappels: t.rappels,
    frequence: t.frequence,
    done: false,
    auto: true,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  3. Provisions : lisser les dépenses non mensuelles                 */
/* ------------------------------------------------------------------ */

/**
 * Combien mettre de côté chaque mois pour absorber une dépense future.
 * @param {number} montant  montant total attendu
 * @param {string} dateISO  date d'échéance
 * @param {number} dejaMis  somme déjà provisionnée
 */
export function calculProvision(montant, dateISO, dejaMis = 0) {
  const cible = Number(montant) || 0;
  if (!cible || !dateISO) return null;

  const now = new Date();
  const echeance = new Date(dateISO);
  const moisRestants = Math.max(
    1,
    (echeance.getFullYear() - now.getFullYear()) * 12 + (echeance.getMonth() - now.getMonth())
  );
  const reste = Math.max(0, cible - (Number(dejaMis) || 0));

  return {
    parMois: Math.round((reste / moisRestants) * 100) / 100,
    moisRestants,
    reste: Math.round(reste * 100) / 100,
    cible,
    enRetard: echeance < now,
  };
}

/** Postes typiques à provisionner pour un parent solo locataire avec voiture. */
export const PROVISIONS_TYPES = [
  {
    id: "rentree-scolaire",
    label: "Rentrée scolaire (fournitures, vêtements)",
    category: "enfants",
    mois: 8,
    montantIndicatif: 250,
    note: "Partiellement couvert par l'ARS si tes enfants ont 6 ans ou plus.",
  },
  {
    id: "controle-technique",
    label: "Contrôle technique",
    category: "vehicule",
    mois: 3,
    montantIndicatif: 90,
    note: "Tous les 2 ans. Provisionner la moitié chaque année lisse la dépense.",
  },
  {
    id: "entretien-vehicule",
    label: "Entretien véhicule (révision, pneus)",
    category: "vehicule",
    mois: 6,
    montantIndicatif: 400,
    note: "Poste très sous-estimé. Une révision + deux pneus dépassent vite 400 €.",
  },
  {
    id: "solde-impots",
    label: "Solde d'impôt sur le revenu",
    category: "impots",
    mois: 9,
    montantIndicatif: 0,
    note: "À renseigner d'après ton avis d'imposition. 0 si tu es mensualisé et à jour.",
  },
  {
    id: "vacances",
    label: "Vacances avec les filles",
    category: "autre",
    mois: 7,
    montantIndicatif: 600,
    note: "Mieux vaut le budgéter que le découvrir sur le relevé.",
  },
  {
    id: "noel",
    label: "Noël et anniversaires",
    category: "enfants",
    mois: 12,
    montantIndicatif: 300,
    note: "Étalé sur l'année, c'est indolore. En décembre, c'est un trou.",
  },
  {
    id: "epargne-precaution",
    label: "Épargne de précaution",
    category: "autre",
    mois: 12,
    montantIndicatif: 1000,
    note: "Objectif recommandé : 1 à 3 mois de charges fixes. Pour toi, environ 1 600 € par mois de charges.",
  },
];

/** Génère les provisions avec leur date d'échéance et le montant mensuel. */
export function genererProvisions(choisies = [], uid = () => Math.random().toString(36).slice(2)) {
  const now = new Date();
  return PROVISIONS_TYPES.filter((p) => choisies.includes(p.id)).map((p) => {
    // On compare la date complète, pas seulement le mois : le 1er juillet
    // est déjà passé si on est le 25 juillet.
    let d = new Date(now.getFullYear(), p.mois - 1, 1);
    if (d <= now) d = new Date(now.getFullYear() + 1, p.mois - 1, 1);
    const dateISO = iso(d);
    const calc = calculProvision(p.montantIndicatif, dateISO, 0);
    return {
      id: uid(),
      typeId: p.id,
      label: p.label,
      category: p.category,
      cible: p.montantIndicatif,
      dateISO,
      dejaMis: 0,
      parMois: calc ? calc.parMois : 0,
      note: p.note,
    };
  });
}

/** Total à mettre de côté chaque mois, toutes provisions confondues. */
export function totalProvisionMensuelle(provisions = []) {
  const t = provisions.reduce((s, p) => {
    const c = calculProvision(p.cible, p.dateISO, p.dejaMis);
    return s + (c ? c.parMois : 0);
  }, 0);
  return Math.round(t * 100) / 100;
}
