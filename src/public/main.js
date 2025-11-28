// src/public/main.js
import { auth } from "./firebaseClient.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

let ultimoResultado = null;

function formatMoney(value) {
  if (value == null || isNaN(value)) return "-";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || isNaN(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

// Limpia formato (puntos, guiones, espacios)
function normalizarDocumento(tipoDocumento, numero) {
  const soloDigitos = (numero || "").replace(/\D/g, "");
  const tipo = (tipoDocumento || "").toLowerCase();

  if (tipo === "dni") {
    // 7 u 8 dígitos
    if (soloDigitos.length < 7 || soloDigitos.length > 8) {
      return null;
    }
    return soloDigitos;
  }

  if (tipo === "cuit" || tipo === "cuil") {
    // CUIT/CUIL 11 dígitos
    if (soloDigitos.length !== 11) {
      return null;
    }
    return soloDigitos;
  }

  return soloDigitos;
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("consulta-form");
  const estado = document.getElementById("estado");
  const resultadoSection = document.getElementById("resultado");
  const resultadoNombre = document.getElementById("resultado-nombre");
  const btnBuscar = document.getElementById("buscar-btn");
  const btnPdf = document.getElementById("descargar-pdf-btn");

  const riesgoBadges = document.querySelectorAll(".riesgo-badge");
  const riesgoDetalle = document.getElementById("riesgo-detalle");
  const riesgoMotivos = document.getElementById("riesgo-motivos");

  const userEmailSpan = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");

  const tipoDocumentoSelect = document.getElementById("tipoDocumento");
  const numeroDocumentoInput = document.getElementById("numeroDocumento");
  const sexoSelect = document.getElementById("sexo");
  const sexoWrapper = document.getElementById("sexo-wrapper");

  // Mostrar/ocultar campo sexo según tipo de documento
  if (tipoDocumentoSelect && sexoWrapper) {
    const actualizarVisibilidadSexo = () => {
      const tipo = tipoDocumentoSelect.value.toLowerCase();
      if (tipo === "dni") {
        sexoWrapper.classList.remove("oculto");
      } else {
        sexoWrapper.classList.add("oculto");
      }
    };
    actualizarVisibilidadSexo();
    tipoDocumentoSelect.addEventListener("change", actualizarVisibilidadSexo);
  }

  // auth state
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "/login.html";
      return;
    }
    if (userEmailSpan) {
      userEmailSpan.textContent = user.email || "";
    }
  });

  // logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        await signOut(auth);
        window.location.href = "/login.html";
      } catch (err) {
        console.error("Error al cerrar sesión:", err);
        logoutBtn.disabled = false;
        alert("No se pudo cerrar sesión. Intentá de nuevo.");
      }
    });
  }

  // submit búsqueda
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipoDocumento = tipoDocumentoSelect.value;
    const numeroDocumentoRaw = numeroDocumentoInput.value.trim();
    const sexo = sexoSelect ? sexoSelect.value : "";

    if (!numeroDocumentoRaw) {
      estado.textContent = "Por favor, ingresá un número de documento.";
      estado.classList.add("error");
      return;
    }

    // Validación y normalización
    const numeroNormalizado = normalizarDocumento(
      tipoDocumento,
      numeroDocumentoRaw
    );
    if (!numeroNormalizado) {
      estado.textContent =
        "El formato del número no es válido para el tipo seleccionado.";
      estado.classList.add("error");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      estado.textContent = "La sesión expiró. Volvé a iniciar sesión.";
      estado.classList.add("error");
      return;
    }

    estado.textContent = "Consultando información...";
    estado.classList.remove("error");
    btnBuscar.disabled = true;
    btnPdf.disabled = true;
    resultadoSection.classList.add("oculto");

    riesgoDetalle.classList.add("oculto");
    riesgoMotivos.innerHTML = "";

    try {
      const idToken = await user.getIdToken();

      const bodyPayload = {
        tipoDocumento,
        numero: numeroNormalizado,
      };

      const resp = await fetch("/api/infoexperto", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(
          `Error del servidor (${resp.status}): ${errText || "Sin detalles"}`
        );
      }

      const data = await resp.json();

      // Guardamos todo + datos de contexto para el PDF
      ultimoResultado = {
        ...data,
        tipoDocumento,
        numeroDocumento: numeroNormalizado,
      };

      // Nombre
      const nombre =
        data.nombreCompleto ||
        data.nombre ||
        `${tipoDocumento.toUpperCase()} ${numeroNormalizado}`;
      resultadoNombre.textContent = nombre;

      const riesgoApi = (data.riesgo || "").toString().toUpperCase();

      // Pintar badges con los textos pedidos
      riesgoBadges.forEach((badge) => {
        const valor = badge.getAttribute("data-riesgo");
        let baseTexto = "";

        if (valor === "ALTO") baseTexto = "RIESGO ALTO – RECHAZAR";
        if (valor === "MEDIO") baseTexto = "RIESGO MEDIO – REVISAR";
        if (valor === "BAJO") baseTexto = "RIESGO BAJO – APROBAR";

        badge.textContent = baseTexto;

        if (valor === riesgoApi) {
          badge.classList.add("activo");
          badge.classList.remove("oculto");
        } else {
          badge.classList.remove("activo");
          badge.classList.add("oculto");
        }
      });

      // Detalle RIESGO MEDIO: métricas + motivos (sin mostrar score en el badge)
      if (
        riesgoApi === "MEDIO" &&
        data.riesgoInterno &&
        Array.isArray(data.riesgoInterno.motivos)
      ) {
        riesgoMotivos.innerHTML = "";

        const metricas = data.riesgoInterno.metricas || {};

        const bloquesMetricas = [];

        if (
          metricas.capacidadTotal != null ||
          metricas.compromisoMensual != null
        ) {
          bloquesMetricas.push(
            `Capacidad total estimada: ${formatMoney(
              metricas.capacidadTotal
            )}, Compromiso mensual estimado: ${formatMoney(
              metricas.compromisoMensual
            )}`
          );
        }

        if (metricas.ingresoMensualEstimado != null) {
          bloquesMetricas.push(
            `Ingreso mensual estimado AFIP: ${formatMoney(
              metricas.ingresoMensualEstimado
            )}`
          );
        }

        if (metricas.usoCapacidad != null) {
          bloquesMetricas.push(
            `Uso de capacidad crediticia: ${formatPercent(
              metricas.usoCapacidad
            )}`
          );
        }

        if (metricas.dti != null) {
          bloquesMetricas.push(
            `Relación cuota / ingreso (DTI): ${formatPercent(metricas.dti)}`
          );
        }

        if (metricas.antiguedadMeses != null) {
          bloquesMetricas.push(
            `Antigüedad formal estimada: ${metricas.antiguedadMeses} meses`
          );
        }

        if (metricas.situacionBcraPeor24m != null) {
          bloquesMetricas.push(
            `Peor situación BCRA últimos 24 meses: ${metricas.situacionBcraPeor24m}`
          );
        }

        if (metricas.tieneActividadFormal === false) {
          bloquesMetricas.push("No se detecta actividad formal registrable.");
        }

        if (metricas.tieneVehiculosRegistrados === true) {
          bloquesMetricas.push("Posee vehículos registrados a su nombre.");
        }

        if (metricas.tieneInmueblesRegistrados === true) {
          bloquesMetricas.push("Posee inmuebles registrados a su nombre.");
        }

        bloquesMetricas.forEach((txt) => {
          const li = document.createElement("li");
          li.textContent = txt;
          riesgoMotivos.appendChild(li);
        });

        data.riesgoInterno.motivos.forEach((motivo) => {
          const li = document.createElement("li");
          li.textContent = motivo;
          riesgoMotivos.appendChild(li);
        });

        riesgoDetalle.classList.remove("oculto");
      } else {
        riesgoDetalle.classList.add("oculto");
        riesgoMotivos.innerHTML = "";
      }

      estado.textContent = "Consulta realizada correctamente.";
      resultadoSection.classList.remove("oculto");
      btnPdf.disabled = false;
    } catch (error) {
      console.error(error);
      estado.textContent = "Ocurrió un error al consultar la información.";
      estado.classList.add("error");
    } finally {
      btnBuscar.disabled = false;
    }
  });

    // PDF (ahora más completo y cercano al layout de InfoExperto)
  if (btnPdf) {
    btnPdf.addEventListener("click", () => {
      if (!ultimoResultado) return;

      const globalJsPdf = window.jspdf;
      if (!globalJsPdf || !globalJsPdf.jsPDF) {
        console.error("jsPDF no está disponible:", globalJsPdf);
        alert(
          "Hubo un problema cargando el generador de PDF (jsPDF). Recargá la página e intentá de nuevo."
        );
        return;
      }

      const { jsPDF } = globalJsPdf;
      const doc = new jsPDF();

      const {
        nombreCompleto,
        cuit,
        numeroDocumento,
        tipoDocumento,
        riesgo,
        scoringApi,
        fechaInforme,
        riesgoInterno,
        informeOriginal,
        numero,
      } = ultimoResultado;

      const nombre =
        nombreCompleto || informeOriginal?.identidad?.nombre_completo || "N/D";

      const identificador =
        tipoDocumento && tipoDocumento.toLowerCase() === "dni"
          ? `DNI: ${numeroDocumento || numero || "N/D"}`
          : `CUIT/CUIL: ${cuit || numero || "N/D"}`;

      const fechaGenerado = new Date().toLocaleString("es-AR");

      // Helpers para maquetar el PDF de forma más ordenada
      let y = 52;
      const MAX_Y = 280;
      const LINE_H = 4;

      function ensureSpace(extraLines = 1) {
        if (y + extraLines * LINE_H > MAX_Y) {
          doc.addPage();
          y = 20;
        }
      }

      function sectionTitle(rawKeyOrTitle) {
        // Si viene un título “humano” lo usamos, si no, transformamos la key
        const t = rawKeyOrTitle
          .replace(/_/g, " ")
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\s+/g, " ")
          .trim();
        return t.charAt(0).toUpperCase() + t.slice(1);
      }

      function printSectionHeader(title) {
        ensureSpace(2);
        doc.setFontSize(11);
        doc.text(title, 10, y);
        y += 5;
        doc.setFontSize(9);
      }

      function printLine(text, indent = 0) {
        if (!text) return;
        ensureSpace(1);
        doc.text(text, 10 + indent, y);
        y += LINE_H;
      }

      // Imprime de forma genérica objetos/arrays para cubrir TODA la info
      function printGenericBlockFromValue(value, indent = 0, labelPrefix = "") {
        if (value == null) return;

        if (Array.isArray(value)) {
          if (value.length === 0) return;
          value.slice(0, 20).forEach((item, idx) => {
            if (typeof item === "object" && item !== null) {
              printLine(
                `${labelPrefix ? labelPrefix + " " : ""}#${idx + 1}:`,
                indent
              );
              Object.entries(item).forEach(([k, v]) => {
                if (
                  v === null ||
                  v === undefined ||
                  v === "" ||
                  (typeof v === "number" && Number.isNaN(v))
                ) {
                  return;
                }
                const text = `${sectionTitle(k)}: ${String(v)}`;
                printLine(`- ${text}`, indent + 4);
              });
            } else {
              printLine(
                `${labelPrefix ? labelPrefix + ": " : ""}${String(item)}`,
                indent
              );
            }
          });
        } else if (typeof value === "object") {
          Object.entries(value).forEach(([k, v]) => {
            if (
              v === null ||
              v === undefined ||
              v === "" ||
              (typeof v === "number" && Number.isNaN(v))
            ) {
              return;
            }
            if (typeof v === "object") {
              printLine(`${sectionTitle(k)}:`, indent);
              printGenericBlockFromValue(v, indent + 4);
            } else {
              printLine(`${sectionTitle(k)}: ${String(v)}`, indent);
            }
          });
        } else {
          printLine(
            `${labelPrefix ? labelPrefix + ": " : ""}${String(value)}`,
            indent
          );
        }
      }

      // CABECERA (similar a InfoExperto)
      doc.setFontSize(14);
      doc.text("Informe comercial InfoExperto", 10, 15);

      doc.setFontSize(10);
      doc.text(`Generado por la app: ${fechaGenerado}`, 10, 22);
      if (fechaInforme) {
        doc.text(`Fecha informe InfoExperto: ${fechaInforme}`, 10, 27);
      }

      doc.text(`Nombre: ${nombre}`, 10, 34);
      doc.text(identificador, 10, 39);

      const riesgoApi = (riesgo || "").toString().toUpperCase();
      let lineaRiesgo = `Riesgo general (API): ${riesgoApi}`;
      if (scoringApi != null) {
        lineaRiesgo += ` | Scoring InfoExperto: ${scoringApi}`;
      }
      if (riesgoInterno && riesgoInterno.estado) {
        lineaRiesgo += ` | Evaluación interna: ${riesgoInterno.estado} (score: ${riesgoInterno.scoreInterno})`;
      }
      doc.text(lineaRiesgo, 10, 45);

      // ==========================
      // BLOQUES “CLÁSICOS” (igual que antes)
      // ==========================

      // IDENTIDAD
      if (informeOriginal && informeOriginal.identidad) {
        const id = informeOriginal.identidad;
        printSectionHeader("Identidad / Datos básicos");

        const lineasIdentidad = [
          `Nombre completo: ${id.nombre_completo || "-"}`,
          `CUIT: ${id.cuit || "-"}`,
          `Documento: ${id.tipo_documento || "-"} ${
            id.numero_documento || "-"
          }`,
          `Sexo: ${id.sexo || "-"}`,
          `Localidad: ${id.localidad || "-"} (${id.provincia || "-"})`,
          `Actividad AFIP: ${id.actividad || "-"}`,
          `Años de inscripción: ${id.anios_inscripcion || "-"}`,
        ];

        lineasIdentidad.forEach((txt) => printLine(txt));
        y += 2;
      }

      // SCORING INFOEXPERTO (cuadro propio parecido al PDF)
      const scoringInf = informeOriginal?.scoringInforme;
      if (scoringInf) {
        printSectionHeader("Scoring InfoExperto");

        const camposScoringPrincipales = [
          ["Scoring", scoringInf.scoring],
          ["Descripción", scoringInf.descripcion || scoringInf.leyenda],
          ["Línea de crédito estimada", scoringInf.credito],
          ["Deuda total estimada", scoringInf.deuda],
        ];

        camposScoringPrincipales.forEach(([label, val]) => {
          if (val !== undefined && val !== null && val !== "") {
            printLine(`${label}: ${String(val)}`);
          }
        });

        // Si hay más campos en scoringInforme los volcamos genéricamente
        const { scoring, descripcion, leyenda, credito, deuda, ...resto } =
          scoringInf;
        printGenericBlockFromValue(resto, 4);
        y += 2;
      }

      // CONDICIÓN TRIBUTARIA
      if (informeOriginal && informeOriginal.condicionTributaria) {
        const c = informeOriginal.condicionTributaria;
        printSectionHeader("Condición tributaria (AFIP)");

        const lineasTrib = [
          `Fecha: ${c.fecha || "-"}`,
          `Impuesto Ganancias: ${c.impuestos_ganancias || "-"}`,
          `Impuesto IVA: ${c.impuestos_iva || "-"}`,
          `Categoría monotributo: ${
            c.categoria_monotributo || c.categoria || "-"
          }`,
          `Actividad: ${c.actividad || "-"}`,
          `Monto anual declarado: ${
            typeof c.monto_anual === "number"
              ? formatMoney(c.monto_anual)
              : "-"
          }`,
        ];
        lineasTrib.forEach((txt) => printLine(txt));
        y += 2;
      }

      // BCRA
      const bcra = informeOriginal?.bcra;
      if (bcra && (bcra.resumen_historico || bcra.datos)) {
        printSectionHeader("Resumen BCRA últimos períodos");

        const resumen = bcra.resumen_historico || {};
        const clavesOrdenadas = Object.keys(resumen).sort();
        clavesOrdenadas.forEach((k) => {
          const r = resumen[k];
          const linea = `${r.periodo}: peor situación ${
            r.peor_situacion
          }, deuda total ${r.deuda_total}, entidades: ${
            r.cantidad_entidades
          }`;
          printLine(linea);
        });
        y += 2;

        if (bcra.datos && bcra.datos.length > 0) {
          printLine("Principales entidades y deudas:");
          bcra.datos.slice(0, 5).forEach((ent) => {
            const nombreEnt = ent.nombre || "Entidad";
            printLine(`- ${nombreEnt}`, 4);
            (ent.deudas || []).slice(0, 4).forEach((d) => {
              const linea = `${d.periodo}: situación ${d.situacion}, monto ${d.monto}`;
              printLine(linea, 8);
            });
          });
          y += 2;
        }
      }

      // RODADOS
      const rodados = informeOriginal?.rodados;
      if (Array.isArray(rodados) && rodados.length > 0) {
        printSectionHeader("Rodados registrados");
        rodados.slice(0, 10).forEach((r) => {
          const linea = `${r.dominio || "-"} – ${r.marca || ""} ${
            r.version || ""
          } (${r.modelo || "-"}) ${r.porcentaje || ""}% – Fecha: ${
            r.fecha_transaccion || "-"
          }`;
          printLine(linea);
        });
        y += 2;
      }

      // INMUEBLES
      const inmuebles = informeOriginal?.inmuebles;
      if (Array.isArray(inmuebles) && inmuebles.length > 0) {
        printSectionHeader("Inmuebles / catastros");
        inmuebles.slice(0, 10).forEach((i) => {
          const linea1 = `${i.direccion || "-"} (${i.provincia || "-"}) – CP ${
            i.cp || "-"
          }`;
          const linea2 = `Catastro: ${i.numero_catastro || "-"}, m2: ${
            i.metros_cuadrados || "-"
          }, alta: ${i.fecha_alta || "-"}`;
          printLine(linea1);
          printLine(linea2, 4);
        });
        y += 2;
      }

      // NIVEL SOCIOECONÓMICO
      const nse = informeOriginal?.nivelSocioeconomico;
      if (nse && nse.nse_personal) {
        printSectionHeader("Nivel socioeconómico estimado");
        const codigo = nse.nse_personal;
        const detalle =
          (nse.nse_detalle && nse.nse_detalle[codigo]) || "Sin detalle.";
        printLine(`Categoría personal: ${codigo}`);
        printLine(detalle, 4);
        y += 2;
      }

      // CONTACTO
      const mails = informeOriginal?.mails;
      const telDeclarados = informeOriginal?.telefonosDeclaradosValidados;
      const celulares = informeOriginal?.celulares;

      if (
        (Array.isArray(mails) && mails.length > 0) ||
        (Array.isArray(telDeclarados) && telDeclarados.length > 0) ||
        (Array.isArray(celulares) && celulares.length > 0)
      ) {
        printSectionHeader("Datos de contacto");

        if (Array.isArray(mails) && mails.length > 0) {
          printLine("Emails:");
          mails.slice(0, 10).forEach((m) => {
            printLine(`- ${m.mail || m.direccion || "-"}`, 4);
          });
        }

        if (Array.isArray(telDeclarados) && telDeclarados.length > 0) {
          printLine("Teléfonos declarados:");
          telDeclarados.slice(0, 10).forEach((t) => {
            const linea = `${t.telefono} (WhatsApp: ${t.whatsapp}, ENACOM: ${t.enacom})`;
            printLine(`- ${linea}`, 4);
          });
        }

        if (Array.isArray(celulares) && celulares.length > 0) {
          printLine("Celulares (otras fuentes):");
          celulares.slice(0, 10).forEach((c) => {
            printLine(`- ${c.numero || ""}`, 4);
          });
        }
        y += 2;
      }

      // ====================================
      // SECCIONES ADICIONALES GENÉRICAS
      // (para volcar TODO lo demás que traiga la API)
      // ====================================
      const handledKeys = new Set([
        "identidad",
        "scoringInforme",
        "condicionTributaria",
        "bcra",
        "rodados",
        "inmuebles",
        "nivelSocioeconomico",
        "mails",
        "telefonosDeclaradosValidados",
        "celulares",
      ]);

      const otrosKeys = Object.keys(informeOriginal || {}).filter(
        (k) => !handledKeys.has(k)
      );

      otrosKeys.forEach((k) => {
        const val = informeOriginal[k];
        if (val == null) return;
        printSectionHeader(sectionTitle(k));
        printGenericBlockFromValue(val, 0);
        y += 2;
      });

      const nombreArchivo = `informe-infoexperto-${
        ultimoResultado.numero || numeroDocumento || "sin-numero"
      }.pdf`;
      doc.save(nombreArchivo);
    });
  }
});
