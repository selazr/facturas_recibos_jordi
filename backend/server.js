const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const { google } = require("googleapis");
const pdfParse = require("pdf-parse");
const ExcelJS = require("exceljs");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, "downloads");
const frontendDist = path.join(__dirname, "../frontend/dist");

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

app.use("/downloads", express.static(downloadsDir));

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

let userTokens = null;
let activeSessionId = null;
let cachedFacturas = [];

const palabrasFactura = [
  "factura",
  "facturas",
  "invoice",
  "invoices",
  "receipt",
  "receipts",
  "recibo",
  "recibos",
  "bill",
  "billing",
  "payment",
  "paid",
  "total",
  "amount",
  "importe",
  "iva",
  "vat",
  "tax",
  "rechnung",
  "facture",
  "reçu",
  "recu",
  "fattura",
  "fatture",
  "ricevuta",
  "ricevute",
  "nota fiscal",
  "pagamento",
  "pagado",
  "quittance",
  "beleg",
  "zahlung",
  "zahlungsbeleg",
  "kunderekening",
  "betalingsbewijs",
  "faktura",
  "faktury",
  "rachunek",
  "paragon",
  "plata",
  "platare",
  "apmaksa"
];

const patronesFactura = [
  /\bfactur\w*/i,
  /\binvoic\w*/i,
  /\brecei?pt\w*/i,
  /\brecib\w*/i,
  /\brechn\w*/i,
  /\brecu\w*/i,
  /\bfattur\w*/i,
  /\bricevut\w*/i,
  /\bfaktur\w*/i,
  /\brachun\w*/i,
  /\bparag\w*/i,
  /\bquittanc\w*/i,
  /\bzahlung\w*/i,
  /\bbetal\w*/i,
  /\bapmaks\w*/i,
  /\bnota\s+fiscal\b/i,
  /\bvat\b/i,
  /\biva\b/i,
  /\btax\b/i,
  /\bamount\s+due\b/i,
  /\bimporte\s+total\b/i,
  /\bgrand\s+total\b/i
];

function normalizeText(text = "") {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getHeader(headers, name) {
  const found = headers.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  );

  return found ? found.value : "";
}

function findPdfParts(payload, results = []) {
  if (!payload) return results;

  if (
    payload.filename &&
    payload.filename.toLowerCase().endsWith(".pdf") &&
    payload.body &&
    payload.body.attachmentId
  ) {
    results.push({
      filename: payload.filename,
      attachmentId: payload.body.attachmentId,
      mimeType: payload.mimeType
    });
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      findPdfParts(part, results);
    }
  }

  return results;
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function parseDateToMonthKey(rawDate = "") {
  const parsed = new Date(rawDate);

  if (Number.isNaN(parsed.getTime())) {
    return "sin-fecha";
  }

  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = parsed.getUTCFullYear();

  return `${year}-${month}`;
}


function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";

  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex === -1) return acc;

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();

      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getRequestSessionId(req) {
  const cookies = parseCookies(req);

  return req.header("x-session-id") || req.query.sessionId || cookies.sessionId || null;
}

function createSessionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistSessionCookie(res, sessionId) {
  res.cookie("sessionId", sessionId, {
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}
function ensureSession(req, res) {
  const sessionId = getRequestSessionId(req);

  if (!sessionId || !activeSessionId || sessionId !== activeSessionId) {
    res.status(401).json({
      error: "Sesión inválida o reemplazada por otro dispositivo"
    });

    return null;
  }

  return sessionId;
}

function decodeBase64Url(data = "") {
  if (!data) return "";

  return Buffer.from(
    data.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf-8");
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyText(payload) {
  if (!payload) return "";

  const content = [];

  if (payload.body && payload.body.data) {
    content.push(decodeBase64Url(payload.body.data));
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const isReadableText =
        part.mimeType === "text/plain" || part.mimeType === "text/html";

      if (isReadableText && part.body && part.body.data) {
        const decoded = decodeBase64Url(part.body.data);

        if (part.mimeType === "text/html") {
          content.push(stripHtml(decoded));
        } else {
          content.push(decoded);
        }
      }

      if (part.parts && Array.isArray(part.parts)) {
        content.push(extractBodyText(part));
      }
    }
  }

  return content.join(" ");
}

function extractTotal(text) {
  const patterns = [
    /total\s*(?:eur|€)?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /importe\s*total\s*(?:eur|€)?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /amount\s*due\s*(?:eur|€|\$)?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /grand\s*total\s*(?:eur|€|\$)?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /([0-9]+(?:[.,][0-9]{2})?)\s*(eur|€)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return match[1].replace(",", ".");
    }
  }

  return "-";
}

function extractCurrency(text) {
  if (text.includes("€") || /\bEUR\b/i.test(text)) return "EUR";
  if (text.includes("$") || /\bUSD\b/i.test(text)) return "USD";
  if (text.includes("£") || /\bGBP\b/i.test(text)) return "GBP";

  return "-";
}

function pareceFactura({ pdfText = "", subject = "", bodyText = "", filename = "" }) {
  const contenido = normalizeText(`${subject} ${bodyText} ${filename} ${pdfText}`);

  const tienePalabraClave = palabrasFactura.some((palabra) =>
    contenido.includes(normalizeText(palabra))
  );

  if (tienePalabraClave) return true;

  return patronesFactura.some((pattern) => pattern.test(contenido));
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.get("/auth/google", (req, res) => {
  const sessionId = getRequestSessionId(req) || createSessionId();

  persistSessionCookie(res, sessionId);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: sessionId
  });

  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Falta el código de autorización");
    }

    const { tokens } = await oauth2Client.getToken(code);
    const sessionId = req.query.state || getRequestSessionId(req);

    if (!sessionId) {
      return res.status(400).send("Falta state de sesión");
    }

    persistSessionCookie(res, sessionId);

    userTokens = tokens;
    activeSessionId = sessionId;
    cachedFacturas = [];
    oauth2Client.setCredentials(tokens);

    console.log("Gmail conectado correctamente");

    res.redirect(`${FRONTEND_URL}?gmail=connected`);
  } catch (error) {
    console.error("Error conectando Gmail:", error);
    res.status(500).send("Error conectando Gmail");
  }
});

app.get("/gmail/status", (req, res) => {
  const sessionId = getRequestSessionId(req);

  res.json({
    connected: Boolean(userTokens) && Boolean(sessionId) && sessionId === activeSessionId
  });
});

app.get("/gmail/messages", async (req, res) => {
  try {
    const sessionId = ensureSession(req, res);

    if (!sessionId) return;

    if (!userTokens) {
      return res.status(401).json({
        error: "Gmail no conectado"
      });
    }

    oauth2Client.setCredentials(userTokens);

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client
    });

    const response = await gmail.users.messages.list({
      userId: "me",
      q: "has:attachment filename:pdf newer_than:365d",
      maxResults: 20
    });

    const messages = response.data.messages || [];
    const facturas = [];

    for (const message of messages) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full"
      });

      const headers = detail.data.payload.headers || [];

      const subject = getHeader(headers, "Subject");
      const from = getHeader(headers, "From");
      const date = getHeader(headers, "Date");
      const bodyText = extractBodyText(detail.data.payload);

      const pdfParts = findPdfParts(detail.data.payload);

      for (const pdfPart of pdfParts) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: message.id,
          id: pdfPart.attachmentId
        });

        const buffer = Buffer.from(
          attachment.data.data.replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        );

        const safeFilename = `${message.id}_${sanitizeFilename(pdfPart.filename)}`;
        const filePath = path.join(downloadsDir, safeFilename);

        fs.writeFileSync(filePath, buffer);

        let pdfText = "";

        try {
          const parsedPdf = await pdfParse(buffer);
          pdfText = parsedPdf.text || "";
        } catch (error) {
          console.error("No se pudo leer el PDF:", pdfPart.filename);
        }

        const esFactura = pareceFactura({
          pdfText,
          subject,
          bodyText,
          filename: pdfPart.filename
        });

        if (esFactura) {
          facturas.push({
            id: message.id,
            fecha: date,
            proveedor: from,
            asunto: subject,
            archivo: pdfPart.filename,
            total: extractTotal(pdfText),
            moneda: extractCurrency(pdfText),
            monthKey: parseDateToMonthKey(date),
            localPath: filePath,
            pdfUrl: `${PUBLIC_URL}/downloads/${safeFilename}`
          });
        }
      }
    }

    cachedFacturas = facturas;

    res.json({
      count: facturas.length,
      messages: facturas
    });
  } catch (error) {
    console.error("Error procesando Gmail:", error);
    res.status(500).json({
      error: "Error procesando Gmail"
    });
  }
});

app.get("/exports/excel", async (req, res) => {
  const sessionId = ensureSession(req, res);

  if (!sessionId) return;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Facturas");

  worksheet.columns = [
    { header: "Fecha", key: "fecha", width: 28 },
    { header: "Proveedor", key: "proveedor", width: 45 },
    { header: "Asunto", key: "asunto", width: 45 },
    { header: "Archivo PDF", key: "archivo", width: 36 },
    { header: "Total", key: "total", width: 14 },
    { header: "Moneda", key: "moneda", width: 12 },
    { header: "Mes", key: "monthKey", width: 12 }
  ];

  cachedFacturas.forEach((factura) => worksheet.addRow(factura));

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="facturas_recibos.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

app.get("/exports/pdfs", (req, res) => {
  const sessionId = ensureSession(req, res);

  if (!sessionId) return;

  if (!cachedFacturas.length) {
    return res.status(400).json({ error: "No hay facturas cargadas para exportar" });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "facturas-recibos-"));
  const baseDir = path.join(tempRoot, "Facturas-Recibos");
  fs.mkdirSync(baseDir, { recursive: true });

  cachedFacturas.forEach((factura) => {
    if (!factura.localPath || !fs.existsSync(factura.localPath)) return;
    const monthDir = path.join(baseDir, factura.monthKey || "sin-fecha");
    fs.mkdirSync(monthDir, { recursive: true });
    const dest = path.join(monthDir, sanitizeFilename(factura.archivo || "documento.pdf"));
    fs.copyFileSync(factura.localPath, dest);
  });

  const zipPath = path.join(tempRoot, "Facturas-Recibos.zip");

  try {
    execFileSync("zip", ["-r", zipPath, "Facturas-Recibos"], { cwd: tempRoot });
    res.download(zipPath, "Facturas-Recibos.zip", () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    res.status(500).json({ error: "No se pudo generar el ZIP de PDFs" });
  }
});

if (fs.existsSync(frontendDist)) {
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.json({
      ok: true,
      message: "Backend facturas/recibos funcionando"
    });
  });
}

app.listen(PORT, () => {
  console.log(`Backend escuchando en puerto ${PORT}`);
});
