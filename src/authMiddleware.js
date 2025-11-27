// src/authMiddleware.js
require("./firebaseAdmin"); // asegura que admin esté inicializado
const { getAuth } = require("firebase-admin/auth");

/**
 * Middleware de autenticación con Firebase.
 * Espera un header: Authorization: Bearer <ID_TOKEN>
 */
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/);

    if (!match) {
      return res
        .status(401)
        .json({ error: "No se encontró token de autenticación." });
    }

    const idToken = match[1];

    const decodedToken = await getAuth().verifyIdToken(idToken);
    // Podés usar estos datos en otros endpoints
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      ...decodedToken,
    };

    return next();
  } catch (err) {
    console.error("Error verificando token Firebase:", err);
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

module.exports = authMiddleware;
