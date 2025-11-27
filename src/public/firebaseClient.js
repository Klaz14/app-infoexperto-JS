// src/public/firebaseClient.js

// Importamos desde la CDN de Firebase (SDK modular)
// Versión 12.x, que es compatible con el código que venimos usando
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

// Config de tu app web (la que te dio Firebase)
const firebaseConfig = {
  apiKey: "AIzaSyDpTX1TESk0LicNHUoJdoZemI-i3IppV6g",
  authDomain: "app-infoexperto.firebaseapp.com",
  projectId: "app-infoexperto",
  storageBucket: "app-infoexperto.firebasestorage.app",
  messagingSenderId: "867325370810",
  appId: "1:867325370810:web:3fdd0123a406b161fd7d83",
};

// Inicializamos Firebase en el front
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };
