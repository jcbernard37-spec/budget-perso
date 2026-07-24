// Stockage 100% local — rien n'est envoyé vers un serveur.
// Même interface simple que window.storage pour ne pas changer App.jsx.

const PREFIX = "budget-perso:data:";

export const storage = {
  async get(key) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) throw new Error("not-found");
    return { key, value: raw };
  },
  async set(key, value) {
    localStorage.setItem(PREFIX + key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(PREFIX + key);
    return { key, deleted: true };
  },
};
