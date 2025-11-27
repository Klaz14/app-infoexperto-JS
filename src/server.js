// src/server.js
const express = require("express");
const path = require("path");
const cors = require("cors");
const dotenv = require("dotenv");

// IMPORTANTE: en Node 18+ fetch y FormData son globales.
// Vos estás en Node 25, así que no hace falta require extra.
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const authMiddleware = require("./authMiddleware");

// Middlewares
app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde /public
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

/**
 * Inferimos el riesgo ALTO / MEDIO / BAJO a partir del scoring de InfoExperto.
 *
 * Según lo que vimos en los informes:
 *  - scoring 1–2  => Riesgo ALTO
 *  - scoring 3–4  => Riesgo MEDIO
 *  - scoring 5    => Riesgo BAJO (EXCELENTE)
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

  // Fallback: si no tenemos scoring, lo dejamos en MEDIO para forzar revisión
  return "MEDIO";
}

/**
 * Calcula la peor situación BCRA de los últimos 24 meses
 * a partir de informe.bcra.resumen_historico
 */
function obtenerPeorSituacionBcra24m(informe) {
  const resumen = informe?.bcra?.resumen_historico;
  if (!resumen || typeof resumen !== "object") return null;

  let peor = null; // mayor número = peor situación
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
 * Convierte el JSON de InfoExperto (data.informe) en un formato interno
 * que usa nuestra función evaluarRiesgoMedio.
 */
function mapearInfoexpertoADatosInternos(informe) {
  const identidad = informe?.identidad || {};
  const scoring = informe?.scoringInforme || {};
  const condicionTributaria = informe?.condicionTributaria || {};
  const actividadScoring = scoring?.actividad || {};

  // Nombre completo
  const nombreCompleto =
    identidad.nombre_completo ||
    informe?.soaAfipA4Online?.nombreCompleto ||
    condicionTributaria?.nombre ||
    "Sin nombre";

  // Riesgo API (ALTO / MEDIO / BAJO) derivado del scoring
  const riesgoApi = inferirRiesgoDesdeScoring(informe);

  // Ingreso mensual estimado desde monto_anual AFIP
  let ingresoMensualEstimado = 0;
  if (typeof condicionTributaria.monto_anual === "number") {
    ingresoMensualEstimado = condicionTributaria.monto_anual / 12;
  }

  // Capacidad y compromiso: usamos scoringInforme.credito/deuda como aproximación
  let capacidadTotal = 0;
  let compromisoMensual = 0;
  const credito = scoring?.credito ? Number(scoring.credito) : NaN;
  const deuda = scoring?.deuda ? Number(scoring.deuda) : NaN;

  if (Number.isFinite(credito) && credito > 0) {
    capacidadTotal = credito;
  }
  if (Number.isFinite(deuda) && deuda > 0) {
    // Lo distribuimos en 12 meses como aproximación simple
    compromisoMensual = deuda / 12;
  }

  // Antigüedad laboral desde anios_inscripcion (identidad)
  let antiguedadLaboralMeses = 0;
  const aniosIns = Number(identidad?.anios_inscripcion);
  if (Number.isFinite(aniosIns) && aniosIns > 0) {
    antiguedadLaboralMeses = aniosIns * 12;
  }

  // Peor situación BCRA últimos 24 meses
  const situacionBcraPeor24m = obtenerPeorSituacionBcra24m(informe);

  // Actividad formal: empleado / monotributista / autónomo / empleador = "SI"
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

  // Vehículos / inmuebles
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
 * Evalúa un caso de RIESGO MEDIO y devuelve:
 *  - estado: "APROBADO" | "REVISION" | "RECHAZADO"
 *  - scoreInterno: 0–100
 *  - motivos: array de strings
 */
function evaluarRiesgoMedio(datos) {
  let score = 50; // base para riesgo MEDIO
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

  // 1) Historial BCRA
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

  // 2) Actividad formal y antigüedad
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

  // 3) Relación compromiso/capacidad
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

  // 4) Afectación sobre ingreso mensual (DTI)
  if (ingresoMensualEstimado > 0) {
    const dti = compromisoMensual / ingresoMensualEstimado;
    if (dti <= 0.3) {
      score += 15;
      motivos.push(
        `Relación cuota/ingreso cómoda (${(dti * 100).toFixed(
          1
        )}% del ingreso).`
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

  // 5) Activos registrables: vehículos / inmuebles
  if (tieneVehiculosRegistrados) {
    score += 5;
    motivos.push("Posee vehículos registrados a su nombre.");
  }
  if (tieneInmueblesRegistrados) {
    score += 10;
    motivos.push("Posee inmuebles/domicilios registrados a su nombre.");
  }
  if (!tieneVehiculosRegistrados && !tieneInmueblesRegistrados) {
    motivos.push("No se detectan vehículos ni inmuebles registrados (neutro).");
  }

  // Normalizamos score 0–100
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  let estado;
  if (score >= 70) {
    estado = "APROBADO";
  } else if (score >= 55) {
    estado = "REVISION"; // revisión manual / condiciones especiales
  } else {
    estado = "RECHAZADO";
  }

  return {
    estado,
    scoreInterno: score,
    motivos,
  };
}

/**
 * Endpoint principal: el front nos manda:
 *  - tipoDocumento: "cuit" | "dni"
 *  - numero: string (DNI o CUIT/CUIL)
 *  - sexo: "M" | "F" (solo si tipoDocumento = "dni", opcional en el front)
 *
 * Internamente replicamos los cURL oficiales:
 *
 * CUIT/CUIL:
 *   curl --location 'https://servicio.infoexperto.com.ar/api/informeApi/obtenerInforme' \
 *   --form 'apiKey="XXXXX-XXXXX-XXXXX-XXXXX"' \
 *   --form 'cuit="30123456789"' \
 *   --form 'tipo="normal"'
 *
 * DNI:
 *   curl --location 'https://servicio.infoexperto.com.ar/api/informeApi/obtenerInformeDni' \
 *   --form 'apiKey="XXXXX-XXXXX-XXXXX-XXXXX"' \
 *   --form 'dni="12345678"' \
 *   --form 'tipo="normal"' \
 *   --form 'sexo="M o F"'
 */
app.post("/api/infoexperto", authMiddleware, async (req, res) => {
  try {
    const { tipoDocumento, numero, sexo } = req.body || {};

    if (!tipoDocumento || !numero) {
      return res.status(400).json({
        error: "Campos requeridos: tipoDocumento y numero",
      });
    }

    const apiKey = process.env.INFOEXPERTO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Falta INFOEXPERTO_API_KEY en el archivo .env",
      });
    }

    // Armamos FormData tal cual el cURL (multipart/form-data)
    const formData = new FormData();
    formData.append("apiKey", apiKey);
    formData.append("tipo", "normal");

    let url = "";
    const tipoLower = tipoDocumento.toLowerCase();

    if (tipoLower === "cuit" || tipoLower === "cuil") {
      url =
        "https://servicio.infoexperto.com.ar/api/informeApi/obtenerInforme";
      // cURL: --form 'cuit="30123456789"'
      // Nosotros mandamos el número tal cual (sin comillas extra)
      formData.append("cuit", numero);
    } else if (tipoLower === "dni") {
      url =
        "https://servicio.infoexperto.com.ar/api/informeApi/obtenerInformeDni";
      formData.append("dni", numero);

      // cURL: --form 'sexo="M o F"'
      // Si el front no manda sexo, usamos "M" por defecto (como antes)
      const sexoNormalizado =
        sexo && (sexo === "M" || sexo === "F") ? sexo : "M";
      formData.append("sexo", sexoNormalizado);
    } else {
      return res.status(400).json({
        error: "tipoDocumento debe ser 'cuit' o 'dni'",
      });
    }

    // Llamado HTTP equivalente al cURL
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

    // Estructura esperada:
    // {
    //   status: "success",
    //   message: "Informe pedido",
    //   data: { id, fecha, informe: { ... } }
    // }
    const informe = apiJson?.data?.informe;
    if (!informe) {
      console.error("Respuesta sin data.informe:", apiJson);
      return res.status(500).json({
        error: "La respuesta de InfoExperto no contiene data.informe",
      });
    }

    // Mapeo interno para nuestra lógica
    const internos = mapearInfoexpertoADatosInternos(informe);
    const riesgo = internos.riesgoApi;

    let riesgoInterno = null;
    if (riesgo === "MEDIO") {
      riesgoInterno = evaluarRiesgoMedio(internos);
    }

    // Respuesta simplificada para el FRONT
    return res.json({
      nombreCompleto: internos.nombreCompleto,
      numero,
      tipoDocumento,
      riesgo,
      riesgoInterno,
    });
  } catch (err) {
    console.error("Error en /api/infoexperto:", err);
    return res.status(500).json({
      error: "Error interno del servidor",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
