import { useState, useEffect, useMemo, useCallback } from "react";
import Papa from "papaparse";
import { storage } from "./lib/storage.js";
import * as Drive from "./lib/google-drive.js";
import { extractDocument } from "./lib/gemini-parse.js";
import {
  Home, Zap, Car, ShoppingCart, Users, HeartPulse, MoreHorizontal,
  Plus, Trash2, Pencil, AlertTriangle, CheckCircle2, Wallet,
  LayoutDashboard, Landmark, ClipboardList, X, Save, Loader2, Clock3,
  Download, FileText, Cloud, CloudOff, Upload, ShieldCheck, Settings, Sparkles, FileSpreadsheet,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */
const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";

const C = {
  ink: "#1C2541",
  slate: "#3A506B",
  slateLight: "#6B7A99",
  paper: "#FAF8F5",
  sand: "#EFE7D8",
  sandLine: "#DED2BA",
  sage: "#5F8A73",
  sageBg: "#E4EEE7",
  amber: "#B9822E",
  amberBg: "#F5E8D2",
  clay: "#B0524F",
  clayBg: "#F5E0DE",
};

const CHARGE_CATEGORIES = [
  { id: "logement", label: "Logement", icon: Home, color: "#3A506B" },
  { id: "energie", label: "Énergie & communication", icon: Zap, color: "#B9822E" },
  { id: "transport", label: "Transport", icon: Car, color: "#5F8A73" },
  { id: "alimentation", label: "Alimentation", icon: ShoppingCart, color: "#B0524F" },
  { id: "enfants", label: "Enfants", icon: Users, color: "#7C6C9C" },
  { id: "sante", label: "Santé", icon: HeartPulse, color: "#4C8577" },
  { id: "autres", label: "Autres charges fixes", icon: MoreHorizontal, color: "#8A8272" },
];

const INCOME_CATEGORIES = [
  { id: "salaire", label: "Salaire net" },
  { id: "prime", label: "Prime(s)" },
  { id: "caf", label: "CAF" },
  { id: "pension", label: "Pension alimentaire perçue" },
  { id: "autre", label: "Autre revenu" },
];

const ECHEANCE_CATEGORIES = [
  { id: "impots", label: "Impôts" },
  { id: "caf", label: "CAF" },
  { id: "assurance", label: "Assurance" },
  { id: "vehicule", label: "Véhicule" },
  { id: "enfants", label: "Enfants" },
  { id: "autre", label: "Autre" },
];

const CHARGE_PERIODS = [
  { id: "mensuel", label: "Mensuelle" },
  { id: "trimestriel", label: "Trimestrielle" },
  { id: "annuel", label: "Annuelle" },
];
const INCOME_PERIODS = [
  { id: "mensuel", label: "Mensuel" },
  { id: "ponctuel", label: "Ponctuel (ce mois-ci)" },
  { id: "annuel", label: "Annuel (réparti /12)" },
];

const uid = () =>
  window.crypto?.randomUUID ? window.crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2, 10);

const toMonthly = (amount, periodicity) => {
  const n = Number(amount) || 0;
  if (periodicity === "trimestriel") return n / 3;
  if (periodicity === "annuel") return n / 12;
  return n; // mensuel / ponctuel
};

const fmt = (n) =>
  (Math.round((n || 0) * 100) / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";

const downloadBlob = (content, filename, mime) => {
  const blob = new Blob(["\uFEFF" + content], { type: mime }); // BOM -> accents corrects dans Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const STORAGE_KEY = "budget-perso-v1";

const emptyState = () => ({
  incomes: [],
  charges: [],
  echeances: [],
  customChargeCategories: [],
  updatedAt: null,
});

/* ------------------------------------------------------------------ */
/*  Small UI atoms                                                     */
/* ------------------------------------------------------------------ */
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
      <span style={{ color: C.slate, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  border: `1px solid ${C.sandLine}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontFamily: "Inter, sans-serif",
  fontSize: 14,
  color: C.ink,
  background: "#fff",
  outline: "none",
};

function IconBtn({ onClick, children, title, danger }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        border: "none",
        background: "transparent",
        color: danger ? C.clay : C.slateLight,
        cursor: "pointer",
        padding: 6,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? C.clayBg : C.sand)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

function PrimaryBtn({ onClick, children, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.ink,
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "9px 16px",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "Inter, sans-serif",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function GhostBtn({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color: C.slate,
        border: `1px solid ${C.sandLine}`,
        borderRadius: 8,
        padding: "9px 14px",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Income form                                                        */
/* ------------------------------------------------------------------ */
function IncomeForm({ initial, onSave, onCancel, previewDelta }) {
  const [form, setForm] = useState(
    initial || { label: "", category: "salaire", customCategory: "", amount: "", periodicity: "mensuel" }
  );
  const monthly = toMonthly(form.amount, form.periodicity);

  return (
    <div style={{ background: C.sand, border: `1px solid ${C.sandLine}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 0.8fr 1fr", gap: 10 }}>
        <Field label="Libellé">
          <input
            style={inputStyle}
            value={form.label}
            placeholder="Ex : Salaire alternance"
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        <Field label="Catégorie">
          <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {INCOME_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Montant (€)">
          <input
            style={inputStyle}
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </Field>
        <Field label="Périodicité">
          <select style={inputStyle} value={form.periodicity} onChange={(e) => setForm({ ...form, periodicity: e.target.value })}>
            {INCOME_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>
      {form.category === "autre" && (
        <div style={{ marginTop: 10 }}>
          <Field label="Nom de la catégorie personnalisée">
            <input
              style={inputStyle}
              value={form.customCategory}
              placeholder="Ex : Remboursement CPAM"
              onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
            />
          </Field>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ fontSize: 13, color: C.slate }}>
          Équivalent mensuel : <b style={{ fontFamily: "IBM Plex Mono, monospace" }}>{fmt(monthly)}</b>
          {previewDelta != null && (
            <span style={{ marginLeft: 10, color: C.sage }}>
              → Nouveau reste à vivre simulé : <b style={{ fontFamily: "IBM Plex Mono, monospace" }}>{fmt(previewDelta + monthly)}</b>
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <GhostBtn onClick={onCancel}>Annuler</GhostBtn>
          <PrimaryBtn
            onClick={() => {
              if (!form.label.trim() || !form.amount) return;
              onSave({ ...form, id: form.id || uid(), amount: Number(form.amount) });
            }}
          >
            <Save size={14} /> Enregistrer
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Charge form                                                        */
/* ------------------------------------------------------------------ */
function ChargeForm({ initial, categories, onSave, onCancel, onNewCategory, previewDelta }) {
  const [form, setForm] = useState(
    initial || { label: "", category: categories[0]?.id || "autres", amount: "", periodicity: "mensuel", dueDay: "" }
  );
  const [newCatMode, setNewCatMode] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const monthly = toMonthly(form.amount, form.periodicity);

  return (
    <div style={{ background: C.sand, border: `1px solid ${C.sandLine}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 0.7fr 1fr 0.7fr", gap: 10 }}>
        <Field label="Libellé">
          <input
            style={inputStyle}
            value={form.label}
            placeholder="Ex : Loyer"
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </Field>
        <Field label="Catégorie">
          {!newCatMode ? (
            <select
              style={inputStyle}
              value={form.category}
              onChange={(e) => {
                if (e.target.value === "__new__") setNewCatMode(true);
                else setForm({ ...form, category: e.target.value });
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
              <option value="__new__">+ Nouvelle catégorie…</option>
            </select>
          ) : (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={inputStyle}
                autoFocus
                placeholder="Nom catégorie"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
              <IconBtn
                title="Valider"
                onClick={() => {
                  if (!newCatName.trim()) return;
                  const id = onNewCategory(newCatName.trim());
                  setForm({ ...form, category: id });
                  setNewCatMode(false);
                  setNewCatName("");
                }}
              >
                <CheckCircle2 size={16} />
              </IconBtn>
            </div>
          )}
        </Field>
        <Field label="Montant (€)">
          <input
            style={inputStyle}
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
        </Field>
        <Field label="Périodicité">
          <select style={inputStyle} value={form.periodicity} onChange={(e) => setForm({ ...form, periodicity: e.target.value })}>
            {CHARGE_PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Jour prélèv.">
          <input
            style={inputStyle}
            type="number"
            min="1"
            max="31"
            value={form.dueDay}
            onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ fontSize: 13, color: C.slate }}>
          Équivalent mensuel : <b style={{ fontFamily: "IBM Plex Mono, monospace" }}>{fmt(monthly)}</b>
          {previewDelta != null && (
            <span style={{ marginLeft: 10, color: previewDelta - monthly < 0 ? C.clay : C.sage }}>
              → Nouveau reste à vivre simulé : <b style={{ fontFamily: "IBM Plex Mono, monospace" }}>{fmt(previewDelta - monthly)}</b>
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <GhostBtn onClick={onCancel}>Annuler</GhostBtn>
          <PrimaryBtn
            onClick={() => {
              if (!form.label.trim() || !form.amount) return;
              onSave({ ...form, id: form.id || uid(), amount: Number(form.amount) });
            }}
          >
            <Save size={14} /> Enregistrer
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Échéance form                                                      */
/* ------------------------------------------------------------------ */
function EcheanceForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { title: "", category: "impots", date: "", montant: "", notes: "", done: false }
  );
  return (
    <div style={{ background: C.sand, border: `1px solid ${C.sandLine}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 0.8fr", gap: 10 }}>
        <Field label="Titre">
          <input
            style={inputStyle}
            value={form.title}
            placeholder="Ex : Déclaration d'impôts"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Catégorie">
          <select style={inputStyle} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {ECHEANCE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Date limite">
          <input style={inputStyle} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Montant estimé (€)">
          <input
            style={inputStyle}
            type="number"
            value={form.montant}
            onChange={(e) => setForm({ ...form, montant: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Notes / justificatifs à fournir">
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "Inter, sans-serif" }}
            value={form.notes}
            placeholder="Ex : avis d'imposition N-1, RIB, attestation employeur…"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <GhostBtn onClick={onCancel}>Annuler</GhostBtn>
        <PrimaryBtn
          onClick={() => {
            if (!form.title.trim() || !form.date) return;
            onSave({ ...form, id: form.id || uid(), montant: form.montant ? Number(form.montant) : null });
          }}
        >
          <Save size={14} /> Enregistrer
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  List row                                                           */
/* ------------------------------------------------------------------ */
function Row({ left, mid, right, onEdit, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 4px",
        borderBottom: `1px solid ${C.sandLine}`,
      }}
    >
      <div style={{ flex: 1 }}>{left}</div>
      <div style={{ width: 160, textAlign: "right" }}>{mid}</div>
      <div style={{ width: 130, display: "flex", justifyContent: "flex-end", gap: 2 }}>
        {right}
        <IconBtn title="Modifier" onClick={onEdit}><Pencil size={15} /></IconBtn>
        <IconBtn title="Supprimer" danger onClick={onDelete}><Trash2 size={15} /></IconBtn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Budget bar — signature dashboard element                           */
/* ------------------------------------------------------------------ */
function BudgetBar({ totalIncome, byCategory, reste }) {
  const overflow = reste < 0;
  const base = overflow ? totalIncome - reste : totalIncome; // scale to include deficit
  let acc = 0;
  return (
    <div>
      <div style={{ display: "flex", height: 34, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.sandLine}` }}>
        {byCategory.map((c) => {
          const pct = base > 0 ? (c.monthly / base) * 100 : 0;
          acc += pct;
          return (
            <div
              key={c.id}
              title={`${c.label} — ${fmt(c.monthly)}`}
              style={{ width: `${pct}%`, background: c.color, minWidth: pct > 0 ? 2 : 0 }}
            />
          );
        })}
        <div
          style={{
            width: `${Math.max(0, 100 - acc)}%`,
            background: overflow ? C.clay : C.sageBg,
            borderLeft: overflow ? "none" : `1px dashed ${C.sage}`,
          }}
        />
        {overflow && (
          <div style={{ width: `${(Math.abs(reste) / base) * 100}%`, background: "repeating-linear-gradient(45deg,#B0524F,#B0524F 6px,#95403D 6px,#95403D 12px)" }} />
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10, fontSize: 12.5, color: C.slate }}>
        {byCategory.filter((c) => c.monthly > 0).map((c) => (
          <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, display: "inline-block" }} />
            {c.label}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: overflow ? C.clay : C.sage, display: "inline-block" }} />
          {overflow ? "Déficit" : "Reste à vivre"}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Printable report (used for "Exporter en PDF")                      */
/* ------------------------------------------------------------------ */
function PrintReport({ state, allChargeCategories, totalIncome, totalCharges, reste, catLabel, incomeCatLabel }) {
  const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="print-only" style={{ padding: 24, fontFamily: "Inter, sans-serif", color: "#1C2541" }}>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 22, marginBottom: 2 }}>Bilan budgétaire — {dateStr}</h1>
      <p style={{ fontSize: 12, color: "#3A506B", marginTop: 0 }}>Généré depuis Mon Budget</p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18, fontSize: 13 }}>
        <tbody>
          <tr><td style={{ padding: "4px 0" }}>Total revenus mensuels</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(totalIncome)}</td></tr>
          <tr><td style={{ padding: "4px 0" }}>Total charges mensuelles</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(totalCharges)}</td></tr>
          <tr style={{ fontWeight: 700, borderTop: "1px solid #ccc" }}><td style={{ padding: "6px 0" }}>Reste à vivre</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(reste)}</td></tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>Revenus</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 18 }}>
        <thead><tr style={{ textAlign: "left", color: "#3A506B" }}><th>Libellé</th><th>Catégorie</th><th>Périodicité</th><th style={{ textAlign: "right" }}>Éq. mensuel</th></tr></thead>
        <tbody>
          {state.incomes.map((i) => (
            <tr key={i.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "3px 0" }}>{i.label}</td>
              <td>{incomeCatLabel(i)}</td>
              <td>{INCOME_PERIODS.find((p) => p.id === i.periodicity)?.label}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(toMonthly(i.amount, i.periodicity))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>Charges</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 18 }}>
        <thead><tr style={{ textAlign: "left", color: "#3A506B" }}><th>Libellé</th><th>Catégorie</th><th>Périodicité</th><th style={{ textAlign: "right" }}>Éq. mensuel</th></tr></thead>
        <tbody>
          {state.charges.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "3px 0" }}>{c.label}</td>
              <td>{catLabel(c.category)}</td>
              <td>{CHARGE_PERIODS.find((p) => p.id === c.periodicity)?.label}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(toMonthly(c.amount, c.periodicity))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 15, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>Échéances</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead><tr style={{ textAlign: "left", color: "#3A506B" }}><th>Titre</th><th>Catégorie</th><th>Date</th><th>Statut</th><th style={{ textAlign: "right" }}>Montant</th></tr></thead>
        <tbody>
          {state.echeances.map((e) => (
            <tr key={e.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={{ padding: "3px 0" }}>{e.title}</td>
              <td>{ECHEANCE_CATEGORIES.find((c) => c.id === e.category)?.label}</td>
              <td>{new Date(e.date).toLocaleDateString("fr-FR")}</td>
              <td>{e.done ? "Fait" : "À faire"}</td>
              <td style={{ textAlign: "right", fontFamily: "monospace" }}>{e.montant ? fmt(e.montant) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */
export default function App() {
  const [view, setView] = useState("dashboard");
  const [state, setState] = useState(emptyState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editingIncome, setEditingIncome] = useState(null); // 'new' | id | null
  const [editingCharge, setEditingCharge] = useState(null);
  const [editingEcheance, setEditingEcheance] = useState(null);

  const [driveConnected, setDriveConnected] = useState(Drive.isConnected());
  const [driveStatus, setDriveStatus] = useState("idle"); // idle | syncing | ok | error
  const [driveError, setDriveError] = useState("");

  const [draftIncome, setDraftIncome] = useState(null);
  const [draftEcheance, setDraftEcheance] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [csvTransactions, setCsvTransactions] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);

  // Charge d'abord le local (affichage instantané, jamais d'écran blanc),
  // puis réconcilie avec Google Drive en arrière-plan si un compte est connecté.
  useEffect(() => {
    (async () => {
      let localState = null;
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res?.value) {
          localState = { ...emptyState(), ...JSON.parse(res.value) };
          setState(localState);
        }
      } catch (e) {
        // pas de données locales pour l'instant
      } finally {
        setLoading(false);
      }

      if (Drive.isConnected()) {
        setDriveStatus("syncing");
        try {
          const json = await Drive.syncDown();
          if (json) {
            const driveState = { ...emptyState(), ...JSON.parse(json) };
            const driveTime = new Date(driveState.updatedAt || 0).getTime();
            const localTime = new Date(localState?.updatedAt || 0).getTime();
            // On ne prend la version Drive que si elle est réellement plus récente,
            // pour ne jamais écraser des modifications locales pas encore poussées.
            if (driveTime > localTime) {
              setState(driveState);
              await storage.set(STORAGE_KEY, json);
            }
          }
          setDriveStatus("ok");
        } catch (e) {
          // Échec silencieux (session expirée, cookies tiers bloqués…) : on reste
          // sur les données locales et on l'indique discrètement dans l'UI.
          setDriveStatus("error");
          setDriveError("Reconnexion Drive nécessaire pour resynchroniser (voir Paramètres).");
        }
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setSaving(true);
    try {
      const json = JSON.stringify(next);
      await storage.set(STORAGE_KEY, json);
      if (Drive.isConnected()) {
        setDriveStatus("syncing");
        Drive.syncUp(json)
          .then(() => setDriveStatus("ok"))
          .catch((e) => {
            setDriveStatus("error");
            setDriveError(e.message);
          });
      }
    } catch (e) {
      console.error("Erreur de sauvegarde locale", e);
    } finally {
      setSaving(false);
    }
  }, []);

  const update = (fn) => {
    setState((prev) => {
      const next = { ...fn(prev), updatedAt: new Date().toISOString() };
      persist(next);
      return next;
    });
  };

  const allChargeCategories = useMemo(
    () => [...CHARGE_CATEGORIES, ...state.customChargeCategories],
    [state.customChargeCategories]
  );

  const totalIncome = useMemo(
    () => state.incomes.reduce((s, i) => s + toMonthly(i.amount, i.periodicity), 0),
    [state.incomes]
  );
  const totalCharges = useMemo(
    () => state.charges.reduce((s, c) => s + toMonthly(c.amount, c.periodicity), 0),
    [state.charges]
  );
  const reste = totalIncome - totalCharges;

  const ratio = totalIncome > 0 ? reste / totalIncome : reste >= 0 ? 1 : -1;
  const status =
    reste < 0 ? "clay" : ratio < 0.15 ? "amber" : "sage";
  const statusBg = { sage: C.sageBg, amber: C.amberBg, clay: C.clayBg }[status];
  const statusColor = { sage: C.sage, amber: C.amber, clay: C.clay }[status];
  const statusLabel = { sage: "Situation confortable", amber: "Marge serrée", clay: "Déficit ce mois-ci" }[status];

  const byCategory = useMemo(() => {
    return allChargeCategories
      .map((cat) => ({
        ...cat,
        monthly: state.charges
          .filter((c) => c.category === cat.id)
          .reduce((s, c) => s + toMonthly(c.amount, c.periodicity), 0),
      }))
      .sort((a, b) => b.monthly - a.monthly);
  }, [state.charges, allChargeCategories]);

  const today = new Date();
  const upcoming = useMemo(() => {
    return [...state.echeances]
      .filter((e) => !e.done)
      .map((e) => ({ ...e, days: Math.ceil((new Date(e.date) - today) / 86400000) }))
      .sort((a, b) => a.days - b.days);
  }, [state.echeances]);

  const catLabel = (id) => allChargeCategories.find((c) => c.id === id)?.label || id;
  const incomeCatLabel = (income) =>
    income.category === "autre" && income.customCategory ? income.customCategory : INCOME_CATEGORIES.find((c) => c.id === income.category)?.label;

  const exportCSV = () => {
    const rows = [];
    rows.push(["=== REVENUS ==="]);
    rows.push(["Libellé", "Catégorie", "Montant", "Périodicité", "Équivalent mensuel"]);
    state.incomes.forEach((i) => rows.push([i.label, incomeCatLabel(i), i.amount, i.periodicity, toMonthly(i.amount, i.periodicity).toFixed(2)]));
    rows.push([]);
    rows.push(["=== CHARGES ==="]);
    rows.push(["Libellé", "Catégorie", "Montant", "Périodicité", "Jour prélèvement", "Équivalent mensuel"]);
    state.charges.forEach((c) => rows.push([c.label, catLabel(c.category), c.amount, c.periodicity, c.dueDay || "", toMonthly(c.amount, c.periodicity).toFixed(2)]));
    rows.push([]);
    rows.push(["=== ÉCHÉANCES ==="]);
    rows.push(["Titre", "Catégorie", "Date", "Montant estimé", "Statut", "Notes"]);
    state.echeances.forEach((e) => rows.push([e.title, ECHEANCE_CATEGORIES.find((c) => c.id === e.category)?.label, e.date, e.montant || "", e.done ? "Fait" : "À faire", e.notes || ""]));
    rows.push([]);
    rows.push(["=== SYNTHÈSE ==="]);
    rows.push(["Total revenus mensuels (€)", totalIncome.toFixed(2)]);
    rows.push(["Total charges mensuelles (€)", totalCharges.toFixed(2)]);
    rows.push(["Reste à vivre (€)", reste.toFixed(2)]);
    const csv = Papa.unparse(rows);
    downloadBlob(csv, `budget-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8;");
  };

  const exportPDF = () => window.print();

  // --- Sauvegarde manuelle (fonctionne toujours, sans Google Drive) ---
  const exportBackup = () => {
    downloadBlob(JSON.stringify(state, null, 2), `budget-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8;");
  };

  const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const next = { ...emptyState(), ...parsed };
        setState(next);
        persist(next);
      } catch (e) {
        alert("Ce fichier ne ressemble pas à une sauvegarde valide.");
      }
    };
    reader.readAsText(file);
  };

  // --- Google Drive ---
  const handleDriveConnect = async () => {
    setDriveStatus("syncing");
    setDriveError("");
    try {
      await Drive.connect();
      setDriveConnected(true);
      // Important : on regarde d'abord s'il existe déjà une sauvegarde sur ce Drive
      // (cas d'un nouvel appareil qu'on connecte) avant de pousser quoi que ce soit,
      // pour ne jamais écraser des données plus récentes avec un état local vide.
      const remoteJson = await Drive.syncDown();
      if (remoteJson) {
        const remoteState = { ...emptyState(), ...JSON.parse(remoteJson) };
        const remoteTime = new Date(remoteState.updatedAt || 0).getTime();
        const localTime = new Date(state.updatedAt || 0).getTime();
        if (remoteTime >= localTime) {
          setState(remoteState);
          await storage.set(STORAGE_KEY, remoteJson);
        } else {
          await Drive.syncUp(JSON.stringify(state));
        }
      } else {
        await Drive.syncUp(JSON.stringify(state));
      }
      setDriveStatus("ok");
    } catch (e) {
      setDriveStatus("error");
      setDriveError(e.message);
    }
  };

  const handleDriveDisconnect = () => {
    Drive.disconnect();
    setDriveConnected(false);
    setDriveStatus("idle");
  };

  const handleDriveRestore = async () => {
    setDriveStatus("syncing");
    setDriveError("");
    try {
      const json = await Drive.syncDown();
      if (!json) {
        setDriveStatus("error");
        setDriveError("Aucune sauvegarde trouvée sur ce Google Drive pour l'instant.");
        return;
      }
      const parsed = JSON.parse(json);
      const next = { ...emptyState(), ...parsed };
      setState(next);
      await storage.set(STORAGE_KEY, JSON.stringify(next));
      setDriveStatus("ok");
    } catch (e) {
      setDriveStatus("error");
      setDriveError(e.message);
    }
  };

  // --- Import de document par IA (Gemini) ---
  // L'IA ne fait QUE pré-remplir un formulaire existant : rien n'est jamais
  // écrit dans le budget sans un clic explicite sur "Enregistrer".
  const handleDocumentImport = async (file) => {
    setImporting(true);
    setImportError("");
    try {
      const result = await extractDocument(file);
      if (result.revenu) {
        setDraftIncome({
          label: result.revenu.libelle || "Salaire",
          category: "salaire",
          customCategory: "",
          amount: result.revenu.montant != null ? String(result.revenu.montant) : "",
          periodicity: result.revenu.periodicite || "mensuel",
        });
        setView("revenus");
        setEditingIncome("new");
      } else if (result.echeance) {
        setDraftEcheance({
          title: result.echeance.titre || "Échéance",
          category: result.echeance.categorie || "autre",
          date: result.echeance.date_limite || "",
          montant: result.echeance.montant != null ? String(result.echeance.montant) : "",
          notes: result.remarque || "",
          done: false,
        });
        setView("echeances");
        setEditingEcheance("new");
      } else {
        setImportError(
          result.remarque ||
            "Je n'ai pas réussi à identifier ce document. Vérifie qu'il s'agit bien d'une fiche de paye ou d'un document avec une échéance, ou saisis les infos à la main."
        );
      }
    } catch (e) {
      setImportError(e.message || "Erreur lors de l'analyse du document.");
    } finally {
      setImporting(false);
    }
  };

  // --- Import CSV Crédit Agricole ---
  // Format CA : ligne d'en-tête, puis Date;Libellé;Débit euros;Crédit euros
  // On skip les lignes d'en-tête (non-date) et on catégorise automatiquement.
  const categorizeTransaction = (libelle) => {
    const l = libelle.toLowerCase();
    if (l.includes("salaire") || l.includes("virement employeur") || l.includes("paie") || l.includes("alternance")) return { type: "revenu", category: "salaire" };
    if (l.includes("caf") || l.includes("allocations") || l.includes("apl")) return { type: "revenu", category: "caf" };
    if (l.includes("dgfip") || l.includes("impot") || l.includes("tresor public")) return { type: "revenu", category: "autre" };
    if (l.includes("audiens") || l.includes("mutuelle") || l.includes("prevoyance") || l.includes("malakoff") || l.includes("harmonie")) return { type: "charge", category: "sante" };
    if (l.includes("loyer") || l.includes("habitat") || l.includes("cdc") || l.includes("hlm") || l.includes("bailleur")) return { type: "charge", category: "logement" };
    if (l.includes("edf") || l.includes("engie") || l.includes("electricit") || l.includes("gaz") || l.includes("orange") || l.includes("sfr") || l.includes("free") || l.includes("bouygues") || l.includes("internet") || l.includes("box")) return { type: "charge", category: "energie" };
    if (l.includes("essence") || l.includes("carburant") || l.includes("total") || l.includes("bp ") || l.includes("station") || l.includes("assurance auto") || l.includes("maaf") || l.includes("allianz") || l.includes("axa")) return { type: "charge", category: "transport" };
    if (l.includes("leclerc") || l.includes("carrefour") || l.includes("lidl") || l.includes("aldi") || l.includes("intermarche") || l.includes("super") || l.includes("hyper") || l.includes("monoprix") || l.includes("courses")) return { type: "charge", category: "alimentation" };
    if (l.includes("cantine") || l.includes("periscolaire") || l.includes("enfant") || l.includes("creche") || l.includes("garde") || l.includes("pension alimentaire")) return { type: "charge", category: "enfants" };
    if (l.includes("netflix") || l.includes("spotify") || l.includes("amazon") || l.includes("disney") || l.includes("apple") || l.includes("abonnement")) return { type: "charge", category: "autres" };
    if (l.includes("uber") || l.includes("deliveroo") || l.includes("just eat") || l.includes("restaurant") || l.includes("mcdo") || l.includes("burger")) return { type: "charge", category: "alimentation" };
    if (l.includes("virement en votre faveur")) return { type: "revenu", category: "autre" };
    if (l.includes("prelevement") || l.includes("paiement par carte") || l.includes("retrait")) return { type: "charge", category: "autres" };
    return { type: "charge", category: "autres" };
  };

const handleCSVImport = (file) => {
    setCsvImporting(true);
    setImportError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const headerMatch = text.match(/Date;Libell[^;]*;/);
        if (!headerMatch) {
          setImportError("Format CSV non reconnu. Utilise bien l'export du Crédit Agricole.");
          setCsvImporting(false);
          return;
        }
        const dataText = text.slice(text.indexOf(headerMatch[0]) + headerMatch[0].length + 1);
        const datePattern = /(\d{2}\/\d{2}\/\d{4});([\s\S]*?)(?=\n\d{2}\/\d{2}\/\d{4};|$)/g;
        const transactions = [];
        let match;
        while ((match = datePattern.exec(dataText)) !== null) {
          const dateStr = match[1];
          const rest = match[2];
          const fields = [];
          let cur = "";
          let inQ = false;
          for (let i = 0; i < rest.length; i++) {
            const ch = rest[i];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ";" && !inQ) { fields.push(cur); cur = ""; }
            else { cur += ch; }
          }
          if (cur) fields.push(cur);
          const libelle = (fields[0] || "").replace(/"/g, "").replace(/\s+/g, " ").trim();
          const debitStr = (fields[1] || "").replace(/\s/g, "").replace(",", ".");
          const creditStr = (fields[2] || "").replace(/\s/g, "").replace(",", ".");
          const debit = parseFloat(debitStr) || 0;
          const credit = parseFloat(creditStr) || 0;
          const montant = credit > 0 ? credit : debit;
          const sens = credit > 0 ? "credit" : "debit";
          if (!libelle || montant === 0) continue;
          const cat = categorizeTransaction(libelle);
          const type = sens === "credit" ? "revenu" : cat.type;
          const category = cat.category;
          transactions.push({ id: uid(), date: dateStr, libelle, montant, sens, type, category, selected: true });
        }
        if (transactions.length === 0) {
          setImportError("Aucune transaction trouvée. Vérifie que le fichier est bien un export CSV du Crédit Agricole.");
          setCsvImporting(false);
          return;
        }
        setCsvTransactions(transactions);
      } catch (err) {
        setImportError("Erreur lors de la lecture du CSV : " + err.message);
      } finally {
        setCsvImporting(false);
      }
    };
    reader.readAsText(file, "windows-1252");
  };

  const handleCSVConfirm = () => {
    if (!csvTransactions) return;
    const selected = csvTransactions.filter((t) => t.selected);
    const newIncomes = [];
    const newCharges = [];
    selected.forEach((t) => {
      if (t.type === "revenu") {
        newIncomes.push({ id: uid(), label: t.libelle.slice(0, 60), category: t.category, customCategory: "", amount: t.montant, periodicity: "ponctuel" });
      } else {
        newCharges.push({ id: uid(), label: t.libelle.slice(0, 60), category: t.category, amount: t.montant, periodicity: "mensuel", dueDay: "" });
      }
    });
    update((s) => ({ ...s, incomes: [...s.incomes, ...newIncomes], charges: [...s.charges, ...newCharges] }));
    setCsvTransactions(null);
    setImportError("");
    alert(`✅ ${newIncomes.length} revenu(s) et ${newCharges.length} charge(s) ajoutés !`);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: C.slate, fontFamily: "Inter, sans-serif" }}>
        <Loader2 size={20} className="spin" style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />
        Chargement de votre budget…
      </div>
    );
  }

  const NAV = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "revenus", label: "Revenus", icon: Landmark },
    { id: "charges", label: "Charges", icon: Wallet },
    { id: "echeances", label: "Échéances", icon: ClipboardList },
    { id: "parametres", label: "Sauvegarde", icon: Settings },
  ];

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: C.paper, color: C.ink, minHeight: 600, display: "flex" }}>
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        select, input, textarea { font-family: inherit; }
        input:focus, select:focus, textarea:focus { border-color: ${C.slate} !important; }
        .nav-item:hover { background: ${C.sand}; }
        .export-btn { transition: background 0.15s ease, border-color 0.15s ease; }
        .export-btn:hover { background: ${C.sand} !important; }
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: #fff; }
        }
      `}</style>

      {/* Sidebar */}
      <div className="no-print" style={{ width: 210, background: "#fff", borderRight: `1px solid ${C.sandLine}`, padding: "22px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontFamily: "Fraunces, serif", fontWeight: 700, fontSize: 19, padding: "0 10px 20px", color: C.ink }}>
          Mon Budget
        </div>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button
              key={n.id}
              className="nav-item"
              onClick={() => setView(n.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                background: active ? C.sand : "transparent",
                color: active ? C.ink : C.slate,
                fontWeight: active ? 700 : 500,
                fontSize: 13.5,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <Icon size={16} /> {n.label}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", padding: "10px 12px", fontSize: 11.5, color: C.slateLight, display: "flex", alignItems: "center", gap: 6 }}>
          {saving ? (
            <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Sauvegarde…</>
          ) : driveConnected && driveStatus === "syncing" ? (
            <><Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Synchro Drive…</>
          ) : driveConnected && driveStatus === "error" ? (
            <><CloudOff size={12} color={C.clay} /> Drive à reconnecter</>
          ) : driveConnected ? (
            <><Cloud size={12} color={C.sage} /> Synchronisé</>
          ) : (
            "Données sauvegardées (local)"
          )}
        </div>
      </div>

      {/* Main */}
      <div className="no-print" style={{ flex: 1, padding: "28px 36px", maxWidth: 980 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
          <label
            className="export-btn"
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.sandLine}`,
              borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate,
              cursor: importing ? "wait" : "pointer", opacity: importing ? 0.65 : 1,
            }}
          >
            {importing ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={14} />}
            {importing ? "Analyse en cours…" : "Importer un document (IA)"}
            <input
              type="file"
              accept="image/*,application/pdf"
              disabled={importing}
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files[0]) handleDocumentImport(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label
              className="export-btn"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: csvImporting ? "wait" : "pointer", opacity: csvImporting ? 0.65 : 1 }}
            >
              {csvImporting ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <FileSpreadsheet size={14} />}
              {csvImporting ? "Lecture…" : "Importer relevé CSV"}
              <input type="file" accept=".csv,.txt" disabled={csvImporting} style={{ display: "none" }}
                onChange={(e) => { if (e.target.files[0]) handleCSVImport(e.target.files[0]); e.target.value = ""; }}
              />
            </label>
            <button className="export-btn" onClick={exportCSV}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
              <Download size={14} /> Exporter en CSV
            </button>
            <button className="export-btn" onClick={exportPDF}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
              <FileText size={14} /> Exporter en PDF
            </button>
          </div>
        </div>

        {importError && (
          <div style={{ background: C.clayBg, color: C.clay, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>{importError}</span>
            <button onClick={() => setImportError("")} style={{ background: "none", border: "none", cursor: "pointer", color: C.clay, flexShrink: 0, display: "flex" }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Modal révision transactions CSV */}
        {csvTransactions && (
          <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 16, boxShadow: "0 4px 24px rgba(28,37,65,0.12)", padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 20, margin: 0 }}>Relevé importé — {csvTransactions.length} transactions</h2>
                <p style={{ fontSize: 12.5, color: C.slateLight, margin: "4px 0 0" }}>Coche les transactions à ajouter à ton budget. Tu peux modifier la catégorie et le type avant de valider.</p>
              </div>
              <button onClick={() => setCsvTransactions(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={() => setCsvTransactions(csvTransactions.map((t) => ({ ...t, selected: true })))}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.sandLine}`, background: C.sand, cursor: "pointer", fontWeight: 600 }}>
                Tout sélectionner
              </button>
              <button onClick={() => setCsvTransactions(csvTransactions.map((t) => ({ ...t, selected: false })))}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.sandLine}`, background: C.sand, cursor: "pointer", fontWeight: 600 }}>
                Tout désélectionner
              </button>
              <span style={{ fontSize: 12, color: C.slateLight, alignSelf: "center" }}>
                {csvTransactions.filter((t) => t.selected).length} sélectionnée(s)
              </span>
            </div>

            <div style={{ maxHeight: 400, overflowY: "auto", border: `1px solid ${C.sandLine}`, borderRadius: 10 }}>
              {csvTransactions.map((t, i) => (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "32px 90px 1fr 110px 90px 80px", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: i < csvTransactions.length - 1 ? `1px solid ${C.sandLine}` : "none", background: t.selected ? "#fff" : C.paper }}>
                  <input type="checkbox" checked={t.selected} onChange={(e) => setCsvTransactions(csvTransactions.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))} style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: 11.5, color: C.slateLight }}>{t.date}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.libelle}>{t.libelle}</span>
                  <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 13, fontWeight: 700, color: t.sens === "credit" ? C.sage : C.clay, textAlign: "right" }}>
                    {t.sens === "credit" ? "+" : "-"}{t.montant.toFixed(2)} €
                  </span>
                  <select value={t.type} onChange={(e) => setCsvTransactions(csvTransactions.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                    style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: `1px solid ${C.sandLine}`, background: t.type === "revenu" ? C.sageBg : C.clayBg }}>
                    <option value="revenu">Revenu</option>
                    <option value="charge">Charge</option>
                  </select>
                  <select value={t.category} onChange={(e) => setCsvTransactions(csvTransactions.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                    style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: `1px solid ${C.sandLine}` }}>
                    {t.type === "revenu" ? (
                      INCOME_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)
                    ) : (
                      CHARGE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)
                    )}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button onClick={() => setCsvTransactions(null)}
                style={{ padding: "9px 18px", borderRadius: 8, border: `1px solid ${C.sandLine}`, background: "#fff", fontWeight: 600, fontSize: 13.5, cursor: "pointer", color: C.slate }}>
                Annuler
              </button>
              <button onClick={handleCSVConfirm}
                style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={15} /> Ajouter {csvTransactions.filter((t) => t.selected).length} transaction(s) au budget
              </button>
            </div>
          </div>
        )}

        {view === "dashboard" && (
          <div>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, margin: "0 0 20px" }}>Tableau de bord</h1>

            {/* Hero reste à vivre */}
            <div style={{ background: statusBg, borderRadius: 16, padding: 24, marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: statusColor, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    {statusLabel}
                  </div>
                  <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 42, fontWeight: 600, color: C.ink, lineHeight: 1.1 }}>
                    {fmt(reste)}
                  </div>
                  <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>reste à vivre ce mois-ci</div>
                </div>
                <div style={{ display: "flex", gap: 22 }}>
                  <div>
                    <div style={{ fontSize: 12, color: C.slate }}>Revenus</div>
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{fmt(totalIncome)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: C.slate }}>Charges</div>
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{fmt(totalCharges)}</div>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 20 }}>
                <BudgetBar totalIncome={totalIncome} byCategory={byCategory} reste={reste} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {/* Répartition */}
              <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: 18 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Répartition des charges</h3>
                {byCategory.filter((c) => c.monthly > 0).length === 0 && (
                  <p style={{ fontSize: 13, color: C.slateLight }}>Ajoutez une charge pour voir comment elle pèse dans votre budget.</p>
                )}
                {byCategory.filter((c) => c.monthly > 0).map((c) => {
                  const pct = totalCharges > 0 ? (c.monthly / totalCharges) * 100 : 0;
                  const Icon = c.icon || MoreHorizontal;
                  return (
                    <div key={c.id} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.slate }}>
                          <Icon size={13} /> {c.label}
                        </span>
                        <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{fmt(c.monthly)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div style={{ height: 6, background: C.sand, borderRadius: 4 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: c.color, borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Échéances proches */}
              <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: 18 }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Prochaines échéances</h3>
                {upcoming.length === 0 && <p style={{ fontSize: 13, color: C.slateLight }}>Rien en attente — tout est à jour.</p>}
                {upcoming.slice(0, 5).map((e) => {
                  const badge = e.days < 0 ? { bg: C.clayBg, color: C.clay, text: "En retard" } :
                    e.days <= 7 ? { bg: C.amberBg, color: C.amber, text: `J-${e.days}` } :
                    { bg: C.sand, color: C.slate, text: `${e.days} j` };
                  return (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.sandLine}` }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</div>
                        <div style={{ fontSize: 11.5, color: C.slateLight }}>{new Date(e.date).toLocaleDateString("fr-FR")}</div>
                      </div>
                      <span style={{ background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20 }}>
                        {badge.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === "revenus" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, margin: 0 }}>Revenus</h1>
              {editingIncome === null && (
                <PrimaryBtn onClick={() => setEditingIncome("new")}><Plus size={15} /> Ajouter un revenu</PrimaryBtn>
              )}
            </div>

            {editingIncome === "new" && (
              <>
                {draftIncome && (
                  <div style={{ background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 10, padding: "10px 14px", marginBottom: 10, fontSize: 12.5, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={14} color={C.amber} /> Champs pré-remplis automatiquement depuis ton document — vérifie le montant avant d'enregistrer.
                  </div>
                )}
                <IncomeForm
                  initial={draftIncome || undefined}
                  previewDelta={reste}
                  onCancel={() => { setEditingIncome(null); setDraftIncome(null); }}
                  onSave={(inc) => {
                    update((s) => ({ ...s, incomes: [...s.incomes, inc] }));
                    setEditingIncome(null);
                    setDraftIncome(null);
                  }}
                />
              </>
            )}

            <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: "4px 18px" }}>
              {state.incomes.length === 0 && editingIncome !== "new" && (
                <p style={{ fontSize: 13, color: C.slateLight, padding: "16px 0" }}>Ajoutez votre premier revenu pour calculer votre reste à vivre.</p>
              )}
              {state.incomes.map((inc) =>
                editingIncome === inc.id ? (
                  <IncomeForm
                    key={inc.id}
                    initial={inc}
                    previewDelta={reste - toMonthly(inc.amount, inc.periodicity)}
                    onCancel={() => setEditingIncome(null)}
                    onSave={(updated) => {
                      update((s) => ({ ...s, incomes: s.incomes.map((i) => (i.id === updated.id ? updated : i)) }));
                      setEditingIncome(null);
                    }}
                  />
                ) : (
                  <Row
                    key={inc.id}
                    left={
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{inc.label}</div>
                        <div style={{ fontSize: 12, color: C.slateLight }}>
                          {incomeCatLabel(inc)} · {INCOME_PERIODS.find((p) => p.id === inc.periodicity)?.label}
                        </div>
                      </div>
                    }
                    mid={<span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{fmt(toMonthly(inc.amount, inc.periodicity))}/mois</span>}
                    onEdit={() => setEditingIncome(inc.id)}
                    onDelete={() => update((s) => ({ ...s, incomes: s.incomes.filter((i) => i.id !== inc.id) }))}
                  />
                )
              )}
            </div>
          </div>
        )}

        {view === "charges" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, margin: 0 }}>Charges</h1>
              {editingCharge === null && (
                <PrimaryBtn onClick={() => setEditingCharge("new")}><Plus size={15} /> Ajouter une charge</PrimaryBtn>
              )}
            </div>

            {editingCharge === "new" && (
              <ChargeForm
                categories={allChargeCategories}
                previewDelta={reste}
                onCancel={() => setEditingCharge(null)}
                onNewCategory={(label) => {
                  const id = uid();
                  update((s) => ({ ...s, customChargeCategories: [...s.customChargeCategories, { id, label, icon: MoreHorizontal, color: "#8A8272" }] }));
                  return id;
                }}
                onSave={(c) => {
                  update((s) => ({ ...s, charges: [...s.charges, c] }));
                  setEditingCharge(null);
                }}
              />
            )}

            {allChargeCategories.map((cat) => {
              const items = state.charges.filter((c) => c.category === cat.id);
              if (items.length === 0 && editingCharge !== "new") return null;
              const Icon = cat.icon || MoreHorizontal;
              return (
                <div key={cat.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700, color: C.slate, margin: "0 0 6px 2px" }}>
                    <Icon size={14} /> {cat.label}
                  </div>
                  <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: "4px 18px" }}>
                    {items.length === 0 && <p style={{ fontSize: 12.5, color: C.slateLight, padding: "12px 0" }}>Aucune ligne dans cette catégorie.</p>}
                    {items.map((c) =>
                      editingCharge === c.id ? (
                        <ChargeForm
                          key={c.id}
                          initial={c}
                          categories={allChargeCategories}
                          previewDelta={reste + toMonthly(c.amount, c.periodicity)}
                          onCancel={() => setEditingCharge(null)}
                          onNewCategory={(label) => {
                            const id = uid();
                            update((s) => ({ ...s, customChargeCategories: [...s.customChargeCategories, { id, label, icon: MoreHorizontal, color: "#8A8272" }] }));
                            return id;
                          }}
                          onSave={(updated) => {
                            update((s) => ({ ...s, charges: s.charges.map((x) => (x.id === updated.id ? updated : x)) }));
                            setEditingCharge(null);
                          }}
                        />
                      ) : (
                        <Row
                          key={c.id}
                          left={
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</div>
                              <div style={{ fontSize: 12, color: C.slateLight }}>
                                {CHARGE_PERIODS.find((p) => p.id === c.periodicity)?.label}
                                {c.dueDay ? ` · prélevé le ${c.dueDay}` : ""}
                              </div>
                            </div>
                          }
                          mid={<span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{fmt(toMonthly(c.amount, c.periodicity))}/mois</span>}
                          onEdit={() => setEditingCharge(c.id)}
                          onDelete={() => update((s) => ({ ...s, charges: s.charges.filter((x) => x.id !== c.id) }))}
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "echeances" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, margin: 0 }}>Échéances & paperasse</h1>
              {editingEcheance === null && (
                <PrimaryBtn onClick={() => setEditingEcheance("new")}><Plus size={15} /> Ajouter une échéance</PrimaryBtn>
              )}
            </div>
            <p style={{ fontSize: 12.5, color: C.slateLight, margin: "0 0 16px" }}>
              Les échéances sont mises en évidence visuellement (en retard / J-7) à chaque ouverture de l'app. Les notifications push/email
              automatiques ne sont pas incluses dans cette V1 gratuite (elles demandent un petit service serveur) — à ajouter plus tard si besoin.
            </p>

            {editingEcheance === "new" && (
              <>
                {draftEcheance && (
                  <div style={{ background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 10, padding: "10px 14px", marginBottom: 10, fontSize: 12.5, color: C.slate, display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={14} color={C.amber} /> Champs pré-remplis automatiquement depuis ton document — vérifie la date et le montant avant d'enregistrer.
                  </div>
                )}
                <EcheanceForm
                  initial={draftEcheance || undefined}
                  onCancel={() => { setEditingEcheance(null); setDraftEcheance(null); }}
                  onSave={(e) => {
                    update((s) => ({ ...s, echeances: [...s.echeances, e] }));
                    setEditingEcheance(null);
                    setDraftEcheance(null);
                  }}
                />
              </>
            )}

            <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: "4px 18px" }}>
              {state.echeances.length === 0 && editingEcheance !== "new" && (
                <p style={{ fontSize: 13, color: C.slateLight, padding: "16px 0" }}>Ajoutez une échéance pour ne rien oublier (impôts, CAF, assurances…).</p>
              )}
              {[...state.echeances]
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map((e) => {
                  const days = Math.ceil((new Date(e.date) - today) / 86400000);
                  const badge = e.done
                    ? { bg: C.sageBg, color: C.sage, text: "Fait" }
                    : days < 0
                    ? { bg: C.clayBg, color: C.clay, text: "En retard" }
                    : days <= 7
                    ? { bg: C.amberBg, color: C.amber, text: `J-${days}` }
                    : { bg: C.sand, color: C.slate, text: `${days} j restants` };
                  return editingEcheance === e.id ? (
                    <EcheanceForm
                      key={e.id}
                      initial={e}
                      onCancel={() => setEditingEcheance(null)}
                      onSave={(updated) => {
                        update((s) => ({ ...s, echeances: s.echeances.map((x) => (x.id === updated.id ? updated : x)) }));
                        setEditingEcheance(null);
                      }}
                    />
                  ) : (
                    <Row
                      key={e.id}
                      left={
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, textDecoration: e.done ? "line-through" : "none", color: e.done ? C.slateLight : C.ink }}>
                            {e.title}
                          </div>
                          <div style={{ fontSize: 12, color: C.slateLight }}>
                            {ECHEANCE_CATEGORIES.find((c) => c.id === e.category)?.label} · {new Date(e.date).toLocaleDateString("fr-FR")}
                            {e.montant ? ` · ${fmt(e.montant)}` : ""}
                          </div>
                        </div>
                      }
                      mid={
                        <span style={{ background: badge.bg, color: badge.color, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20 }}>
                          {badge.text}
                        </span>
                      }
                      right={
                        <IconBtn
                          title={e.done ? "Marquer à faire" : "Marquer fait"}
                          onClick={() => update((s) => ({ ...s, echeances: s.echeances.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)) }))}
                        >
                          {e.done ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}
                        </IconBtn>
                      }
                      onEdit={() => setEditingEcheance(e.id)}
                      onDelete={() => update((s) => ({ ...s, echeances: s.echeances.filter((x) => x.id !== e.id) }))}
                    />
                  );
                })}
            </div>
          </div>
        )}

        {view === "parametres" && (
          <div style={{ maxWidth: 640 }}>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, margin: "0 0 6px" }}>Sauvegarde & Google Drive</h1>
            <p style={{ fontSize: 13.5, color: C.slate, marginBottom: 22 }}>
              Tes données vivent d'abord sur cet appareil (aucun écran blanc à l'ouverture), puis se réconcilient automatiquement avec ton
              Google Drive en arrière-plan si connecté — c'est ce qui permet d'ouvrir l'appli sur ton PC du travail et de retrouver les mêmes
              chiffres que sur ton PC perso, sans rien faire de plus.
            </p>

            {/* Google Drive */}
            <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: 20, marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                {driveConnected ? <Cloud size={18} color={C.sage} /> : <CloudOff size={18} color={C.slateLight} />}
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Google Drive — Synchronisation automatique</h3>
              </div>
              <p style={{ fontSize: 12.5, color: C.slateLight, margin: "0 0 14px" }}>
                Crée un dossier privé « Budget Perso » dans ton Drive et y sauvegarde tes données à chaque modification. Rien que toi (et cette
                app connectée à ton compte) ne peux y accéder.
              </p>

              {!driveConnected ? (
                <PrimaryBtn onClick={handleDriveConnect}><Cloud size={15} /> Se connecter à Google Drive</PrimaryBtn>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <GhostBtn onClick={handleDriveRestore}><Upload size={14} style={{ marginRight: 6 }} />Charger la sauvegarde Drive</GhostBtn>
                  <GhostBtn onClick={handleDriveDisconnect}>Déconnecter</GhostBtn>
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, color: driveStatus === "error" ? C.clay : C.slateLight }}>
                {driveStatus === "syncing" && "Synchronisation en cours…"}
                {driveStatus === "ok" && driveConnected && "✓ Synchronisé avec Google Drive"}
                {driveStatus === "error" && `Erreur : ${driveError}`}
              </div>

              <details style={{ marginTop: 14, fontSize: 12.5, color: C.slate }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>⚙️ Configuration de Google Drive (une seule fois)</summary>
                <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
                  <li>Va sur <b>console.cloud.google.com</b></li>
                  <li>Crée un nouveau projet, par exemple « Budget Perso »</li>
                  <li>Cherche « Google Drive API » → <b>Enable</b></li>
                  <li><b>Credentials</b> → <b>Create Credentials</b> → <b>OAuth 2.0 Client ID</b>
                    <ul style={{ paddingLeft: 18 }}>
                      <li>Type : <b>Web application</b></li>
                      <li>Authorized JavaScript origins : <code>http://localhost:5173</code></li>
                    </ul>
                  </li>
                  <li>Copie ton <b>Client ID</b></li>
                  <li>Crée un fichier <code>.env</code> à la racine du projet avec :<br /><code>VITE_GOOGLE_CLIENT_ID=ton_client_id.apps.googleusercontent.com</code></li>
                  <li>Relance <code>npm run dev</code>, puis clique sur « Se connecter à Google Drive » ci-dessus</li>
                </ol>
              </details>
            </div>

            {/* Sauvegarde manuelle */}
            <div style={{ background: "#fff", border: `1px solid ${C.sandLine}`, borderRadius: 14, boxShadow: "0 1px 2px rgba(28,37,65,0.05)", padding: 20, marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>⬇️ Sauvegarde manuelle (toujours disponible)</h3>
              <p style={{ fontSize: 12.5, color: C.slateLight, margin: "0 0 12px" }}>
                Marche sans Google Drive. Télécharge un fichier avec toutes tes données, dépose-le où tu veux (Drive, mail à toi-même, clé USB…).
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <GhostBtn onClick={exportBackup}><Download size={14} style={{ marginRight: 6 }} />Télécharger ma sauvegarde</GhostBtn>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${C.sandLine}`, borderRadius: 8, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
                  <Upload size={14} /> Charger un fichier de sauvegarde
                  <input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => e.target.files[0] && importBackup(e.target.files[0])} />
                </label>
              </div>
              <p style={{ fontSize: 11.5, color: C.slateLight, marginTop: 10 }}>Astuce : fais-le une fois par semaine, ou après une grosse mise à jour de ton budget.</p>
            </div>

            <div style={{ background: C.sand, border: `1px solid ${C.sandLine}`, borderRadius: 14, padding: 20 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <ShieldCheck size={16} /> Confidentialité
              </h3>
              <p style={{ fontSize: 12.5, color: C.slate, margin: 0 }}>
                Le stockage local reste sur cet appareil ; la synchronisation Drive utilise directement ton compte Google avec un accès
                limité au seul dossier créé par l'app (scope <code>drive.file</code>). Seule exception : quand tu utilises « Importer un
                document (IA) », le fichier que tu choisis d'envoyer transite, à ce moment précis seulement, par l'API Google Gemini pour en
                extraire les montants — rien d'autre n'est transmis, et rien ne part si tu n'utilises pas ce bouton.
              </p>
            </div>
          </div>
        )}
      </div>

      <PrintReport
        state={state}
        allChargeCategories={allChargeCategories}
        totalIncome={totalIncome}
        totalCharges={totalCharges}
        reste={reste}
        catLabel={catLabel}
        incomeCatLabel={incomeCatLabel}
      />
    </div>
  );
}
