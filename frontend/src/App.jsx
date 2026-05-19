import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "";
const SESSION_STORAGE_KEY = "facturas_session_id";

function getOrCreateSessionId() {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const newSession = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(SESSION_STORAGE_KEY, newSession);
  return newSession;
}

function App() {
  const [backendStatus, setBackendStatus] = useState("Comprobando...");
  const [gmailStatus, setGmailStatus] = useState("No conectado");
  const [facturas, setFacturas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [sessionId] = useState(() => getOrCreateSessionId());

  useEffect(() => {
    comprobarBackend();
    comprobarGmail();
  }, []);

  const estadoBackendOk = backendStatus === "Backend conectado";
  const estadoGmailOk = gmailStatus === "Gmail conectado";

  const resumen = useMemo(() => {
    const total = facturas.length;

    const monedas = [
      ...new Set(
        facturas
          .map((factura) => factura.moneda)
          .filter((moneda) => moneda && moneda !== "-")
      )
    ].join(", ");

    return {
      total,
      monedas: monedas || "Sin moneda detectada"
    };
  }, [facturas]);

  const comprobarBackend = () => {
    axios
      .get(`${API_URL}/health`)
      .then(() => {
        setBackendStatus("Backend conectado");
      })
      .catch(() => {
        setBackendStatus("No se puede conectar con el backend");
      });
  };

  const comprobarGmail = () => {
    axios
      .get(`${API_URL}/gmail/status`, {
        headers: { "x-session-id": sessionId }
      })
      .then((response) => {
        if (response.data.connected) {
          setGmailStatus("Gmail conectado");
        } else {
          setGmailStatus("Gmail no conectado");
        }
      })
      .catch(() => {
        setGmailStatus("No se pudo comprobar Gmail");
      });
  };

  const conectarGmail = () => {
    window.location.href = `${API_URL}/auth/google?sessionId=${encodeURIComponent(sessionId)}`;
  };

  const cargarCorreos = () => {
    setCargando(true);

    axios
      .get(`${API_URL}/gmail/messages`, {
        headers: { "x-session-id": sessionId }
      })
      .then((response) => {
        const mensajes = response.data.messages.map((mensaje) => ({
          id: mensaje.id,
          fecha: mensaje.fecha || "-",
          proveedor: mensaje.proveedor || "-",
          total: mensaje.total ?? "-",
          moneda: mensaje.moneda || "-",
          impuestos: mensaje.impuestos ?? "-",
          numeroDocumento: mensaje.numeroDocumento || "-",
          tipoDocumento: mensaje.tipoDocumento || "-",
          confianza:
            typeof mensaje.confianza === "number"
              ? `${Math.round(mensaje.confianza * 100)}%`
              : "-",
          motivo: mensaje.motivo || "-",
          idioma: mensaje.idioma || "-",
          pdf: mensaje.archivo || "-",
          asunto: mensaje.asunto || "-",
          pdfUrl: mensaje.pdfUrl || ""
        }));

        setFacturas(mensajes);
        setGmailStatus("Gmail conectado");
      })
      .catch((error) => {
        console.error(error);

        if (error.response?.status === 401) {
          alert("Primero tienes que conectar Gmail.");
          setGmailStatus("Gmail no conectado");
        } else {
          alert("No se pudieron cargar los correos.");
        }
      })
      .finally(() => {
        setCargando(false);
      });
  };

  const descargarExcel = async () => {
    try {
      const response = await axios.get(`${API_URL}/exports/excel`, {
        headers: { "x-session-id": sessionId },
        responseType: "blob"
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "facturas_recibos.xlsx");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("No se pudo descargar el Excel.");
    }
  };

  const descargarPdfs = async () => {
    try {
      const response = await axios.get(`${API_URL}/exports/pdfs`, {
        headers: { "x-session-id": sessionId },
        responseType: "blob"
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "Facturas-Recibos.zip");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("No se pudo descargar el ZIP de PDFs.");
    }
  };

  return (
    <main className="container">
      <section className="hero card">
        <p className="eyebrow">Gestión inteligente</p>

        <h1>Extractor de facturas y recibos</h1>

        <p className="hero-description">
          Conecta Gmail, analiza los PDFs con IA y revisa tus facturas en un
          panel claro.
        </p>
      </section>

      <section className="status-grid">
        <article className="status-card card">
          <h2>Backend</h2>
          <p className={`badge ${estadoBackendOk ? "ok" : "error"}`}>
            {backendStatus}
          </p>
        </article>

        <article className="status-card card">
          <h2>Gmail</h2>
          <p className={`badge ${estadoGmailOk ? "ok" : "warning"}`}>
            {gmailStatus}
          </p>
        </article>

        <article className="status-card card">
          <h2>Total de facturas</h2>
          <p className="metric">{resumen.total}</p>
          <small>{resumen.monedas}</small>
        </article>
      </section>

      <section className="card">
        <h2>Acciones</h2>

        <div className="button-row">
          <button onClick={conectarGmail}>Conectar Gmail</button>

          <button onClick={cargarCorreos} disabled={cargando}>
            {cargando ? "Buscando..." : "Buscar PDFs en Gmail"}
          </button>

          <button onClick={descargarExcel} disabled={facturas.length === 0}>
            Descargar Excel
          </button>

          <button onClick={descargarPdfs} disabled={facturas.length === 0}>
            Descargar PDFs
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-title-row">
          <h2>Facturas encontradas</h2>
          <span className="counter">{facturas.length}</span>
        </div>

        {facturas.length === 0 ? (
          <p className="empty-state">
            Aún no hay facturas procesadas. Pulsa en “Buscar PDFs en Gmail”.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Tipo</th>
                  <th>Total</th>
                  <th>Moneda</th>
                  <th>Confianza IA</th>
                  <th>Motivo</th>
                  <th>PDF</th>
                </tr>
              </thead>

              <tbody>
                {facturas.map((factura, index) => (
                  <tr key={factura.id || index}>
                    <td>{factura.fecha}</td>
                    <td>{factura.proveedor}</td>
                    <td>{factura.tipoDocumento}</td>
                    <td>{factura.total}</td>
                    <td>{factura.moneda}</td>
                    <td>{factura.confianza}</td>
                    <td>{factura.motivo}</td>
                    <td>
                      {factura.pdfUrl ? (
                        <a
                          href={factura.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {factura.pdf}
                        </a>
                      ) : (
                        factura.pdf
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
