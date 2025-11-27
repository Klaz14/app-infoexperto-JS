// src/public/main.js
import { auth } from "./firebaseClient.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

let ultimoResultado = null;

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

  // NUEVO: referencias para mostrar email y botón de logout
  const userEmailSpan = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");

  // Si no hay usuario logueado, mandamos al login
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      // si estamos en la página principal sin user, redirigimos
      window.location.href = "/login.html";
      return;
    }

    // Si hay usuario, mostramos el email
    if (userEmailSpan) {
      userEmailSpan.textContent = user.email || "";
    }
  });

  // NUEVO: handler de logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        await signOut(auth);
        // al desloguear, nos vamos al login
        window.location.href = "/login.html";
      } catch (err) {
        console.error("Error al cerrar sesión:", err);
        logoutBtn.disabled = false;
        alert("No se pudo cerrar sesión. Intentá de nuevo.");
      }
    });
  }

  // ... resto de tu código de submit y PDF se queda igual ...
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const tipoDocumento = document.getElementById("tipoDocumento").value;
    const numeroDocumento = document
      .getElementById("numeroDocumento")
      .value.trim();

    if (!numeroDocumento) {
      estado.textContent = "Por favor, ingresá un número de documento.";
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

      const resp = await fetch("/api/infoexperto", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tipoDocumento,
          numero: numeroDocumento,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(
          `Error del servidor (${resp.status}): ${errText || "Sin detalles"}`
        );
      }

      const data = await resp.json();
      ultimoResultado = data;

      const nombre =
        data.nombreCompleto ||
        data.nombre ||
        `${tipoDocumento.toUpperCase()} ${numeroDocumento}`;
      resultadoNombre.textContent = nombre;

      const riesgoApi = (data.riesgo || "").toString().toUpperCase();

      let sufijoRiesgoMedio = "";
      if (
        riesgoApi === "MEDIO" &&
        data.riesgoInterno &&
        data.riesgoInterno.estado
      ) {
        const estadoInterno = data.riesgoInterno.estado.toUpperCase();
        if (estadoInterno === "APROBADO") {
          sufijoRiesgoMedio = " – APROBADO";
        } else if (estadoInterno === "REVISION") {
          sufijoRiesgoMedio =
            " – REVISIÓN MANUAL / CONDICIONES ESPECIALES";
        } else if (estadoInterno === "RECHAZADO") {
          sufijoRiesgoMedio = " – RECHAZADO";
        }
      }

      riesgoBadges.forEach((badge) => {
        const valor = badge.getAttribute("data-riesgo");
        if (valor === "ALTO") badge.textContent = "RIESGO ALTO";
        if (valor === "MEDIO") badge.textContent = "RIESGO MEDIO";
        if (valor === "BAJO") badge.textContent = "RIESGO BAJO";

        if (valor === riesgoApi) {
          badge.classList.add("activo");
          badge.classList.remove("oculto");

          if (valor === "MEDIO" && sufijoRiesgoMedio) {
            badge.textContent = "RIESGO MEDIO" + sufijoRiesgoMedio;
          }
        } else {
          badge.classList.remove("activo");
          badge.classList.add("oculto");
        }
      });

      if (
        riesgoApi === "MEDIO" &&
        data.riesgoInterno &&
        Array.isArray(data.riesgoInterno.motivos) &&
        data.riesgoInterno.motivos.length > 0
      ) {
        riesgoMotivos.innerHTML = "";
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

  btnPdf.addEventListener("click", () => {
    if (!ultimoResultado) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const titulo = "Informe Infoexperto (demo)";
    doc.setFontSize(16);
    doc.text(titulo, 10, 15);

    doc.setFontSize(11);
    const fecha = new Date().toLocaleString("es-AR");
    doc.text(`Generado: ${fecha}`, 10, 25);

    const nombre =
      ultimoResultado.nombreCompleto ||
      ultimoResultado.nombre ||
      "Sin nombre";

    const riesgoApi = (ultimoResultado.riesgo || "")
      .toString()
      .toUpperCase();
    let textoRiesgo = `Riesgo (API): ${riesgoApi}`;

    if (
      riesgoApi === "MEDIO" &&
      ultimoResultado.riesgoInterno &&
      ultimoResultado.riesgoInterno.estado
    ) {
      textoRiesgo += ` / Interno: ${ultimoResultado.riesgoInterno.estado} (${ultimoResultado.riesgoInterno.scoreInterno})`;
    }

    doc.setFontSize(12);
    doc.text(`Nombre: ${nombre}`, 10, 40);
    doc.text(textoRiesgo, 10, 48);

    doc.save(
      `informe-infoexperto-${ultimoResultado.numero || "sin-numero"}.pdf`
    );
  });
});
