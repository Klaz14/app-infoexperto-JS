// src/public/login.js
import { auth } from "./firebaseClient.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const estado = document.getElementById("login-estado");
  const btnLogin = document.getElementById("login-btn");

  // Botón para mostrar/ocultar contraseña
  const togglePasswordBtn = document.getElementById("toggle-password");

  // Si ya está logueado, lo mando directo a la app principal
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.href = "/";
    }
  });

  // Toggle mostrar/ocultar contraseña
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener("click", () => {
      const isHidden = passwordInput.type === "password";

      // Cambiamos el tipo del input
      passwordInput.type = isHidden ? "text" : "password";

      // Cambiamos iconito y estado aria
      togglePasswordBtn.textContent = isHidden ? "🙈" : "👁";
      togglePasswordBtn.setAttribute("aria-pressed", String(isHidden));
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      estado.textContent = "Completá email y contraseña.";
      estado.classList.add("error");
      return;
    }

    estado.textContent = "Iniciando sesión...";
    estado.classList.remove("error");
    btnLogin.disabled = true;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged también redirige, pero por las dudas:
      window.location.href = "/";
    } catch (err) {
      console.error(err);
      estado.textContent = traducirCodigoError(err.code);
      estado.classList.add("error");
    } finally {
      btnLogin.disabled = false;
    }
  });
});

function traducirCodigoError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "El correo no es válido.";
    case "auth/user-disabled":
      return "Este usuario está deshabilitado.";
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Email o contraseña incorrectos.";
    default:
      return "No se pudo iniciar sesión. Intentalo de nuevo.";
  }
}
