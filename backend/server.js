const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const pdfParse = require("pdf-parse");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, "downloads");

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

app.use("/downloads", express.static(downloadsDir));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

let userTokens = null;

const palabrasFactura = [
  "factura",
  "invoice",
  "receipt",
  "recibo",
  "bill",
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
  "fattura",
  "ricevuta",
  "nota fiscal",
  "pagamento"
];

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

function pareceFactura(text, subject) {
  const contenido = `${subject} ${text}`.toLowerCase();

  return palabrasFactura.some((palabra) => contenido.includes(palabra));
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Backend facturas/recibos funcionando"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES
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

    userTokens = tokens;
    oauth2Client.setCredentials(tokens);

    console.log("Gmail conectado correctamente");

    res.redirect(`${process.env.FRONTEND_URL}?gmail=connected`);
  } catch (error) {
    console.error("Error conectando Gmail:", error);
    res.status(500).send("Error conectando Gmail");
  }
});

app.get("/gmail/status", (req, res) => {
  res.json({
    connected: Boolean(userTokens)
  });
});

app.get("/gmail/messages", async (req, res) => {
  try {
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

        const esFactura = pareceFactura(pdfText, subject);

        if (esFactura) {
          facturas.push({
            id: message.id,
            fecha: date,
            proveedor: from,
            asunto: subject,
            archivo: pdfPart.filename,
            total: extractTotal(pdfText),
            moneda: extractCurrency(pdfText),
            pdfUrl: `http://localhost:4000/downloads/${safeFilename}`
          });
        }
      }
    }

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

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Backend escuchando en http://localhost:${PORT}`);
});