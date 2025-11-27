// src/firebaseAdmin.js
const admin = require("firebase-admin");

// Cambiá el nombre del archivo según el tuyo real:
const serviceAccount = require("../app-infoexperto-firebase-ad.json");
// Ejemplo: "../app-infoexperto-firebase-adminsdk-fbsvc.json"

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = admin;
