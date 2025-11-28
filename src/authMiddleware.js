// src/authMiddleware.js
require("./firebaseAdmin"); // asegura que admin esté inicializado
const { getAuth } = require("firebase-admin/auth");

/**
 * Middleware de autenticación con Firebase.
 * Espera un header: Authorization: Bearer <ID_TOKEN>
 */
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || req.headers.Authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res
        .status(401)
        .json({ error: "No se encontró token de autenticación." });
    }

    const idToken = match[1].trim();

    if (!idToken) {
      return res
        .status(401)
        .json({ error: "Token de autenticación vacío o inválido." });
    }

    const decodedToken = await getAuth().verifyIdToken(idToken);

    // Podés usar estos datos en otros endpoints
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      // dejamos el resto por si después lo necesitás
      ...decodedToken,
    };

    return next();
  } catch (err) {
    console.error("Error verificando token Firebase en authMiddleware:", err);
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

module.exports = authMiddleware;
