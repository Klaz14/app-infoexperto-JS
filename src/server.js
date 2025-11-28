// src/server.js
const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Node 18+ tiene fetch / FormData global
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const authMiddleware = require("./authMiddleware");

// --- Middlewares globales de seguridad ---
// Configuramos CSP para permitir Firebase y jsPDF desde CDN
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        // JS que se pueden cargar en el navegador
        scriptSrc: [
          "'self'",
          "https://www.gstatic.com",     // Firebase CDN
          "https://cdnjs.cloudflare.com" // jsPDF CDN
        ],

        // Desde dónde se pueden hacer conexiones XHR/fetch desde el navegador
        connectSrc: [
          "'self'",
          "https://identitytoolkit.googleapis.com", // Firebase Auth
          "https://securetoken.googleapis.com",     // Tokens Firebase
          "https://servicio.infoexperto.com.ar"     // Si en algún momento llamás directo desde front
        ],

        // Estilos (permitimos inline porque estás usando CSS propio y quizá algún inline en el futuro)
        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ],

        // Imágenes (incluye data: por si algo viene embebido)
        imgSrc: ["'self'", "data:"],

        // Fonts, si en algún momento usás externas
        fontSrc: ["'self'", "https://fonts.gstatic.com"],

        // Objetos tipo <iframe>, <embed> (muy restrictivo)
        objectSrc: ["'none'"]
      }
    }
  })
);


app.use(express.json());

// Servir estáticos (index.html, main.js, styles.css, login.html, etc.)
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Limitar la cantidad de consultas a InfoExperto por IP
const infoexpertoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10, // máx 10 requests/minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Demasiadas consultas a InfoExperto desde esta IP. Intentá de nuevo más tarde.",
  },
});

function validarEntradaInfoexperto(req, res, next) {
  const { tipoDocumento, numero } = req.body || {};
  const tipo = (tipoDocumento || "").toLowerCase();
  const limpio = (numero || "").toString().replace(/\D/g, "");

  if (!tipo || !numero) {
    return res.status(400).json({
      error: "Campos requeridos: tipoDocumento y numero",
    });
  }

  if (tipo === "dni") {
    if (limpio.length < 7 || limpio.length > 8) {
      return res.status(400).json({
        error: "Formato de DNI inválido. Debe tener 7 u 8 dígitos.",
      });
    }
  } else if (tipo === "cuit" || tipo === "cuil") {
    if (limpio.length !== 11) {
      return res.status(400).json({
        error: "Formato de CUIT/CUIL inválido. Debe tener 11 dígitos.",
      });
    }
  } else {
    return res.status(400).json({
      error: "tipoDocumento debe ser 'dni' o 'cuit'",
    });
  }

  // Guardamos el número limpio para que lo use la ruta
  req.numeroLimpio = limpio;
  req.tipoLower = tipo;

  next();
}

/**
 * Inferimos el riesgo ALTO / MEDIO / BAJO a partir del scoring.
 */
function inferirRiesgoDesdeScoring(informe) {
  const scoringObj = informe?.scoringInforme;
  const scoring =
    typeof scoringObj?.scoring === "number"
      ? scoringObj.scoring
      : Number(scoringObj?.scoring);

  if (Number.isFinite(scoring)) {
    if (scoring <= 2) return "ALTO";
    if (scoring <= 4) return "MEDIO";
    return "BAJO";
  }

  // Sin scoring -> lo dejamos en MEDIO (forzar revisión)
  return "MEDIO";
}

/**
 * Peor situación BCRA 24 meses (bcra.resumen_historico)
 */
function obtenerPeorSituacionBcra24m(informe) {
  const resumen = informe?.bcra?.resumen_historico;
  if (!resumen || typeof resumen !== "object") return null;

  let peor = null;
  for (const key of Object.keys(resumen)) {
    const entry = resumen[key];
    const sit = Number(entry?.peor_situacion);
    if (!Number.isNaN(sit)) {
      if (peor === null || sit > peor) peor = sit;
    }
  }
  return peor;
}

/**
 * Mapeo del JSON de InfoExperto a datos internos.
 */
function mapearInfoexpertoADatosInternos(informe) {
  const identidad = informe?.identidad || {};
  const scoring = informe?.scoringInforme || {};
  const condicionTributaria = informe?.condicionTributaria || {};
  const actividadScoring = scoring?.actividad || {};

  const nombreCompleto =
    identidad.nombre_completo ||
    informe?.soaAfipA4Online?.nombreCompleto ||
    condicionTributaria?.nombre ||
    "Sin nombre";

  const riesgoApi = inferirRiesgoDesdeScoring(informe);

  // Ingreso mensual estimado AFIP
  let ingresoMensualEstimado = 0;
  if (typeof condicionTributaria.monto_anual === "number") {
    ingresoMensualEstimado = condicionTributaria.monto_anual / 12;
  }

  // Capacidad / compromiso (aprox desde scoringInforme)
  let capacidadTotal = 0;
  let compromisoMensual = 0;
  const credito = scoring?.credito ? Number(scoring.credito) : NaN;
  const deuda = scoring?.deuda ? Number(scoring.deuda) : NaN;

  if (Number.isFinite(credito) && credito > 0) {
    capacidadTotal = credito;
  }
  if (Number.isFinite(deuda) && deuda > 0) {
    compromisoMensual = deuda / 12;
  }

  // Antigüedad laboral (meses)
  let antiguedadLaboralMeses = 0;
  const aniosIns = Number(identidad?.anios_inscripcion);
  if (Number.isFinite(aniosIns) && aniosIns > 0) {
    antiguedadLaboralMeses = aniosIns * 12;
  }

  const situacionBcraPeor24m = obtenerPeorSituacionBcra24m(informe);

  let tieneActividadFormal = false;
  if (actividadScoring) {
    if (
      actividadScoring.empleado === "SI" ||
      actividadScoring.monotributista === "SI" ||
      actividadScoring.autonomo === "SI" ||
      actividadScoring.empleador === "SI"
    ) {
      tieneActividadFormal = true;
    }
  }

  const tieneVehiculosRegistrados =
    Array.isArray(informe.rodados) && informe.rodados.length > 0;

  const tieneInmueblesRegistrados =
    Array.isArray(informe.inmuebles) && informe.inmuebles.length > 0;

  return {
    nombreCompleto,
    riesgoApi,
    capacidadTotal,
    compromisoMensual,
    ingresoMensualEstimado,
    antiguedadLaboralMeses,
    situacionBcraPeor24m,
    tieneActividadFormal,
    tieneVehiculosRegistrados,
    tieneInmueblesRegistrados,
  };
}

/**
 * Evaluación para RIESGO MEDIO
 */
function evaluarRiesgoMedio(datos) {
  let score = 50;
  const motivos = [];

  const {
    capacidadTotal,
    compromisoMensual,
    ingresoMensualEstimado,
    antiguedadLaboralMeses,
    situacionBcraPeor24m,
    tieneActividadFormal,
    tieneVehiculosRegistrados,
    tieneInmueblesRegistrados,
  } = datos;

  // 1) BCRA
  if (situacionBcraPeor24m != null) {
    if (situacionBcraPeor24m >= 3) {
      score -= 30;
      motivos.push(
        "Registro de situación BCRA 3 o superior en los últimos 24 meses."
      );
    } else if (situacionBcraPeor24m === 2) {
      score += 5;
      motivos.push("Alguna situación 2 regularizada en BCRA.");
    } else if (situacionBcraPeor24m === 1) {
      score += 15;
      motivos.push("Historial BCRA en situación 1 (normal) últimos 24 meses.");
    }
  } else {
    motivos.push("Sin información clara de situación BCRA (neutro).");
  }

  // 2) Actividad y antigüedad
  if (!tieneActividadFormal) {
    score -= 30;
    motivos.push("No se detecta actividad formal registrable.");
  } else {
    if (antiguedadLaboralMeses >= 36) {
      score += 15;
      motivos.push("Actividad formal con antigüedad ≥ 36 meses.");
    } else if (antiguedadLaboralMeses >= 12) {
      score += 5;
      motivos.push("Actividad formal con antigüedad entre 12 y 36 meses.");
    } else {
      motivos.push("Actividad formal con antigüedad < 12 meses.");
    }
  }

  // 3) Uso de capacidad
  let usoCapacidad = null;
  if (capacidadTotal > 0) {
    usoCapacidad = compromisoMensual / capacidadTotal;
    if (usoCapacidad <= 0.3) {
      score += 15;
      motivos.push(
        `Uso de capacidad crediticia bajo (${(usoCapacidad * 100).toFixed(
          1
        )}%).`
      );
    } else if (usoCapacidad <= 0.5) {
      score += 5;
      motivos.push(
        `Uso de capacidad crediticia moderado (${(usoCapacidad * 100).toFixed(
          1
        )}%).`
      );
    } else if (usoCapacidad <= 0.8) {
      score -= 10;
      motivos.push(
        `Uso de capacidad crediticia alto (${(usoCapacidad * 100).toFixed(
          1
        )}%).`
      );
    } else {
      score -= 20;
      motivos.push(
        `Uso de capacidad crediticia crítico (${(usoCapacidad * 100).toFixed(
          1
        )}%).`
      );
    }
  } else if (compromisoMensual > 0) {
    score -= 25;
    motivos.push(
      "Compromiso mensual con capacidad crediticia total nula o no informada."
    );
  } else {
    motivos.push("Sin deudas registradas y sin capacidad informada (neutro).");
  }

  // 4) DTI
  let dti = null;
  if (ingresoMensualEstimado > 0) {
    dti = compromisoMensual / ingresoMensualEstimado;
    if (dti <= 0.3) {
      score += 15;
      motivos.push(
        `Relación cuota/ingreso cómoda (${(dti * 100).toFixed(1)}% del ingreso).`
      );
    } else if (dti <= 0.4) {
      score += 5;
      motivos.push(
        `Relación cuota/ingreso moderada (${(dti * 100).toFixed(
          1
        )}% del ingreso).`
      );
    } else if (dti <= 0.5) {
      score -= 10;
      motivos.push(
        `Relación cuota/ingreso elevada (${(dti * 100).toFixed(
          1
        )}% del ingreso).`
      );
    } else {
      score -= 20;
      motivos.push(
        `Relación cuota/ingreso crítica (${(dti * 100).toFixed(
          1
        )}% del ingreso).`
      );
    }
  } else {
    motivos.push("Sin información de ingresos estimados (neutro).");
  }

  // 5) Activos
  if (tieneVehiculosRegistrados) {
    score += 5;
    motivos.push("Posee vehículos registrados a su nombre.");
  }
  if (tieneInmueblesRegistrados) {
    score += 10;
    motivos.push("Posee inmuebles/domicilios registrados a su nombre.");
  }

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  let estado;
  if (score >= 70) estado = "APROBADO";
  else if (score >= 55) estado = "REVISION";
  else estado = "RECHAZADO";

  return {
    estado,
    scoreInterno: score,
    motivos,
    metricas: {
      capacidadTotal,
      compromisoMensual,
      ingresoMensualEstimado,
      antiguedadMeses: antiguedadLaboralMeses,
      situacionBcraPeor24m,
      tieneActividadFormal,
      tieneVehiculosRegistrados,
      tieneInmueblesRegistrados,
      usoCapacidad,
      dti,
    },
  };
}

// Endpoint principal
app.post(
  "/api/infoexperto",
  authMiddleware, // 1) Debe estar logueado (Firebase)
  infoexpertoLimiter, // 2) Límite de requests por IP
  validarEntradaInfoexperto, // 3) Validación de input
  async (req, res) => {
    try {
      const tipoLower = req.tipoLower;
      const numeroLimpio = req.numeroLimpio;

      const apiKey = process.env.INFOEXPERTO_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: "Falta INFOEXPERTO_API_KEY en el archivo .env",
        });
      }

      const formData = new FormData();
      formData.append("apiKey", apiKey);
      formData.append("tipo", "normal");

      let url = "";

      if (tipoLower === "cuit" || tipoLower === "cuil") {
        url =
          "https://servicio.infoexperto.com.ar/api/informeApi/obtenerInforme";
        formData.append("cuit", numeroLimpio);
      } else if (tipoLower === "dni") {
        url =
          "https://servicio.infoexperto.com.ar/api/informeApi/obtenerInformeDni";
        formData.append("dni", numeroLimpio);
        // ya no mandamos sexo
      }

      const resp = await fetch(url, {
        method: "POST",
        body: formData,
        redirect: "follow",
      });

      if (!resp.ok) {
        const textoError = await resp.text();
        console.error("Error desde InfoExperto:", textoError);
        return res.status(resp.status).json({
          error: "Error desde API InfoExperto",
          detalle: textoError,
        });
      }

      const apiJson = await resp.json();

      const informe = apiJson?.data?.informe;
      if (!informe) {
        console.error("Respuesta sin data.informe:", apiJson);
        return res.status(400).json({
          error: apiJson.message || "No se pudo obtener el informe",
          codigo: apiJson.metadata?.codigo ?? null,
        });
      }

      const internos = mapearInfoexpertoADatosInternos(informe);
      const riesgo = internos.riesgoApi;
      const scoringApi = Number(informe?.scoringInforme?.scoring) || null;

      let riesgoInterno = null;
      if (riesgo === "MEDIO") {
        riesgoInterno = evaluarRiesgoMedio(internos);
      }

      return res.json({
        nombreCompleto: internos.nombreCompleto,
        numero: numeroLimpio,
        tipoDocumento: tipoLower,
        riesgo,
        scoringApi,
        fechaInforme: apiJson?.data?.fecha || null,
        riesgoInterno,
        informeOriginal: informe,
      });
    } catch (err) {
      console.error("Error en /api/infoexperto:", err);
      return res.status(500).json({
        error: "Error interno del servidor",
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
