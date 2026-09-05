'use strict';

const METODOS_ESCRITURA = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Bloquea toda operación de escritura cuando el token es de rol invitado.
 * Se monta global sobre /api/*, después de auth y antes de los routers.
 */
module.exports = function readOnly(req, res, next) {
  const rol = req.user && req.user.rol;

  if (rol !== 'invitado') return next();

  if (METODOS_ESCRITURA.includes(req.method)) {
    return res.status(403).json({
      success: false,
      message: 'Modo demostración: solo lectura.'
    });
  }

  return next();
};
