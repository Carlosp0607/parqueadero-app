const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuarios.controller');
const { verificarToken, esAdmin } = require('../middleware/auth');
const { sanitizeIdParam } = require('../utils/sanitize');

// Todas las rutas requieren JWT y rol admin
router.use(verificarToken);
router.use(esAdmin);

router.get('/', usuariosController.obtenerUsuarios);
router.post('/', usuariosController.crearUsuario);
router.put('/:id/estado', sanitizeIdParam('id'), usuariosController.cambiarEstado);
router.put('/:id', sanitizeIdParam('id'), usuariosController.actualizarUsuario);
router.delete('/:id', sanitizeIdParam('id'), usuariosController.eliminarUsuario);

module.exports = router;
