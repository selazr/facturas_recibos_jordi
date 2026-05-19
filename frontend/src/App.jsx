import { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [backendStatus, setBackendStatus] = useState("Comprobando...");
  const [gmailStatus, setGmailStatus] = useState("No conectado");
  const [facturas, setFacturas] = useState([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    comprobarBackend();
    comprobarGmail();
  }, []);

  const comprobarBackend = () => {
    axios
      .get("http://localhost:4000/health")
      .then(() => {
        setBackendStatus("Backend conectado");
      })
      .catch(() => {
        setBackendStatus("No se puede conectar con el backend");
      });
  };

  const comprobarGmail = () => {
    axios
      .get("http://localhost:4000/gmail/status")
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
    window.location.href = "http://localhost:4000/auth/google";
  };

  const cargarCorreos = () => {
    setCargando(true);

    axios
      .get("http://localhost:4000/gmail/messages")
      .then((response) => {
        const mensajes = response.data.messages.map((mensaje) => ({
          id: mensaje.id,
          fecha: mensaje.fecha || "-",
          proveedor: mensaje.proveedor || "-",
          total: mensaje.total || "-",
          moneda: mensaje.moneda || "-",
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

  return (
    <main className="container">
      <h1>Extractor de facturas y recibos</h1>

      <section className="card">
        <h2>Estado</h2>
        <p>{backendStatus}</p>
        <p>{gmailStatus}</p>
      </section>

      <section className="card">
        <h2>Gmail</h2>

        <p>
          Conecta Gmail para buscar correos con PDFs adjuntos, detectar facturas
          o recibos y extraer los PDFs.
        </p>

        <div className="button-row">
          <button onClick={conectarGmail}>
            Conectar Gmail
          </button>

          <button onClick={cargarCorreos} disabled={cargando}>
            {cargando ? "Buscando..." : "Buscar PDFs en Gmail"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Facturas encontradas</h2>

        {facturas.length === 0 ? (
          <p>Aún no hay facturas procesadas.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Total</th>
                <th>Moneda</th>
                <th>Asunto</th>
                <th>PDF</th>
              </tr>
            </thead>

            <tbody>
              {facturas.map((factura, index) => (
                <tr key={factura.id || index}>
                  <td>{factura.fecha}</td>
                  <td>{factura.proveedor}</td>
                  <td>{factura.total}</td>
                  <td>{factura.moneda}</td>
                  <td>{factura.asunto}</td>
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
        )}
      </section>
    </main>
  );
}

export default App;