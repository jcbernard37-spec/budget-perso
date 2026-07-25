// Prépare le fichier (photo ou PDF) et l'envoie à /api/parse-document.
// Les photos sont redimensionnées côté navigateur avant l'envoi : plus rapide,
// moins de tokens consommés côté Gemini, et on reste large sous les limites de
// taille de requête.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      resolve({ mimeType: "image/jpeg", data: dataUrl.split(",")[1] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire cette image."));
    };
    img.src = url;
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ mimeType: file.type, data: reader.result.split(",")[1] });
    reader.onerror = () => reject(new Error("Impossible de lire ce fichier."));
    reader.readAsDataURL(file);
  });
}

const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 Mo, marge confortable sous les limites de payload

export async function extractDocument(file) {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) {
      throw new Error("Ce PDF est trop volumineux (>8 Mo). Essaie une photo à la place, ou un PDF plus léger.");
    }
  } else if (!file.type.startsWith("image/")) {
    throw new Error("Format non supporté — utilise une photo (JPG/PNG) ou un PDF.");
  }

  const payload = file.type === "application/pdf" ? await fileToBase64(file) : await resizeImageToBase64(file);

  const res = await fetch("/api/parse-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Erreur serveur (${res.status}).`);
  }
  return json;
}
