// Middleware: valida que el usuario tenga rol administrador
// FIX: leía req.user.rol mientras que auth.js escribía req.usuario -> 403 permanente.
// Ahora acepta ambos (auth.js ya los sincroniza).
module.exports = function requireAdmin(req, res, next) {
    const rol = (req.usuario || req.user || {}).rol;
    if (rol !== 'admin') {
        return res.status(403).json({ success: false, message: 'Requiere rol administrador' });
    }
    next();
};
