
// Protege las páginas HTML del panel. Cierra el punto 5 de la revisión:
// hasta ahora GET /admin/cualquier-cosa devolvía el HTML completo a cualquiera,
// sin usuario y sin contraseña.
//
// El token de sesión viaja ahora en dos lugares, y cada uno tiene su razón:
//   - localStorage      -> lo usa el JavaScript del navegador para llamar a la API.
//                          No cambia nada de lo que ya existe.
//   - cookie ps_session -> el navegador la manda sola en cada navegación. Es la
//                          única que el servidor puede leer al momento de servir
//                          una página HTML, porque en ese instante todavía no se
//                          ha ejecutado ningún JavaScript.
//
// No se usa cookie-parser a propósito: leer una cookie son seis líneas y así no
// se agrega una dependencia nueva al package.json.

const jwt = require('jsonwebtoken');

function leerCookie(req, nombre) {
    const crudas = req.headers.cookie;
    if (!crudas) return null;

    for (const parte of crudas.split(';')) {
        const corte = parte.indexOf('=');
        if (corte === -1) continue;
        if (parte.slice(0, corte).trim() === nombre) {
            return decodeURIComponent(parte.slice(corte + 1).trim());
        }
    }
    return null;
}

function pageGuard(req, res, next) {
    const token = leerCookie(req, 'ps_session');

    if (!token) {
        return res.redirect('/');
    }

    try {
        const datos = jwt.verify(token, process.env.JWT_SECRET || 'tu_secreto_jwt');

        if (!datos.id_empresa) {
            res.clearCookie('ps_session');
            return res.redirect('/');
        }

        req.usuario = {
            id: datos.id_usuario ?? datos.id,
            id_usuario: datos.id_usuario ?? datos.id,
            id_empresa: datos.id_empresa,
            rol: datos.rol,
            nombre: datos.nombre
        };

        return next();
    } catch (error) {
        // Token vencido, alterado o firmado con otro secreto.
        res.clearCookie('ps_session');
        return res.redirect('/');
    }
}

module.exports = pageGuard;
module.exports.leerCookie = leerCookie;
