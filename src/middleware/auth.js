// Middleware de autenticación JWT
// FIX: antes exportaba un objeto { verificarToken, esAdmin }, pero 7 archivos de rutas
// lo importaban como función (`const verifyToken = require('../middleware/auth')`).
// Ahora exporta una FUNCIÓN que además expone .verificarToken y .esAdmin,
// de modo que ambos estilos de import funcionan.
// FIX: normaliza la identidad en req.usuario Y req.user (el código usaba ambos indistintamente)
// e incluye a la vez `id` e `id_usuario` para no romper consultas existentes.
const jwt = require('jsonwebtoken');

// Modo demostración: el rol invitado solo puede leer.
const METODOS_ESCRITURA = ['POST', 'PUT', 'PATCH', 'DELETE'];

function verificarToken(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Acceso denegado: Token no proporcionado' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const identidad = {
            id: decoded.id_usuario ?? decoded.id,
            id_usuario: decoded.id_usuario ?? decoded.id,
            id_empresa: decoded.id_empresa,
            rol: decoded.rol,
            nombre: decoded.nombre
        };

        if (!identidad.id || !identidad.id_empresa) {
            return res.status(401).json({ success: false, message: 'Token incompleto: vuelva a iniciar sesión' });
        }

        // El invitado del demo no escribe. Cubre los 12 routers de una vez,
        // porque todos importan este middleware.
        if (identidad.rol === 'invitado' && METODOS_ESCRITURA.includes(req.method)) {
            return res.status(403).json({
                success: false,
                message: 'Modo demostración: solo lectura.'
            });
        }

        req.usuario = identidad;
        req.user = identidad; // alias de compatibilidad
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
    }
}

function esAdmin(req, res, next) {
    const rol = (req.usuario || req.user || {}).rol;
    if (rol !== 'admin') {
        return res.status(403).json({ success: false, message: 'Acceso denegado: requiere rol de Administrador' });
    }
    next();
}

module.exports = verificarToken;
module.exports.verificarToken = verificarToken;
module.exports.esAdmin = esAdmin;