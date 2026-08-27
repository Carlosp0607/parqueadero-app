// Controlador de usuarios
// FIX CRÍTICO: la versión anterior consultaba columnas que NO existen en schema.sql
// (usuarios.id, usuarios.password, usuarios.estado) -> error 500 en cada petición,
// y además NO filtraba por id_empresa -> fuga de datos entre empresas (multi-tenant roto).
// Reescrito contra el esquema real y aislado por empresa.
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

exports.obtenerUsuarios = async (req, res) => {
    try {
        const [usuarios] = await pool.query(
            `SELECT id_usuario AS id, id_usuario, nombre, usuario_login, rol, activo,
                    fecha_creacion, ultimo_acceso
             FROM usuarios WHERE id_empresa = ? ORDER BY nombre ASC`,
            [req.usuario.id_empresa]
        );
        return res.json({ success: true, data: usuarios, usuarios });
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        return res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

exports.crearUsuario = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { nombre, usuario_login, password, rol } = req.body;

    if (!nombre || !usuario_login || !password || !rol) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
    }
    if (!['admin', 'operador'].includes(rol)) {
        return res.status(400).json({ success: false, message: 'Rol inválido (admin u operador)' });
    }
    if (String(password).length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const [existe] = await pool.query(
            'SELECT id_usuario FROM usuarios WHERE usuario_login = ? AND id_empresa = ?',
            [usuario_login.trim(), id_empresa]
        );
        if (existe.length > 0) {
            return res.status(409).json({ success: false, message: 'El nombre de usuario ya está registrado' });
        }

        const hash = await bcrypt.hash(password, 10);
        const [r] = await pool.query(
            'INSERT INTO usuarios (id_empresa, nombre, usuario_login, `contraseña`, rol, activo) VALUES (?, ?, ?, ?, ?, TRUE)',
            [id_empresa, nombre.trim(), usuario_login.trim(), hash, rol]
        );

        return res.status(201).json({ success: true, message: 'Usuario creado exitosamente', usuario_id: r.insertId });
    } catch (error) {
        console.error('Error al crear usuario:', error);
        return res.status(500).json({ success: false, message: 'Error al registrar usuario' });
    }
};

exports.actualizarUsuario = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { nombre, usuario_login, password, rol } = req.body;

    try {
        const campos = [];
        const valores = [];

        if (nombre) { campos.push('nombre = ?'); valores.push(nombre.trim()); }
        if (usuario_login) { campos.push('usuario_login = ?'); valores.push(usuario_login.trim()); }
        if (rol) {
            if (!['admin', 'operador'].includes(rol)) {
                return res.status(400).json({ success: false, message: 'Rol inválido' });
            }
            campos.push('rol = ?'); valores.push(rol);
        }
        if (password) {
            if (String(password).length < 6) {
                return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
            }
            campos.push('`contraseña` = ?'); valores.push(await bcrypt.hash(password, 10));
        }
        if (campos.length === 0) {
            return res.status(400).json({ success: false, message: 'No hay datos para actualizar' });
        }

        valores.push(req.params.id, id_empresa);
        const [r] = await pool.query(
            `UPDATE usuarios SET ${campos.join(', ')} WHERE id_usuario = ? AND id_empresa = ?`,
            valores
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        return res.json({ success: true, message: 'Usuario actualizado' });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        return res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
    }
};

exports.cambiarEstado = async (req, res) => {
    const { id_empresa, id } = req.usuario;
    const activo = req.body.activo !== undefined
        ? Boolean(req.body.activo)
        : String(req.body.estado || '').toUpperCase() === 'ACTIVO';

    if (Number(req.params.id) === Number(id) && !activo) {
        return res.status(400).json({ success: false, message: 'No puede desactivar su propio usuario' });
    }

    try {
        const [r] = await pool.query(
            'UPDATE usuarios SET activo = ? WHERE id_usuario = ? AND id_empresa = ?',
            [activo, req.params.id, id_empresa]
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        return res.json({ success: true, message: 'Estado del usuario actualizado' });
    } catch (error) {
        console.error('Error al actualizar estado:', error);
        return res.status(500).json({ success: false, message: 'Error al actualizar estado' });
    }
};

// Baja lógica: nunca DELETE físico (hay claves foráneas desde movimientos/pagos/turnos)
exports.eliminarUsuario = async (req, res) => {
    const { id_empresa, id } = req.usuario;

    if (Number(req.params.id) === Number(id)) {
        return res.status(400).json({ success: false, message: 'No puede eliminar su propio usuario' });
    }

    try {
        const [r] = await pool.query(
            'UPDATE usuarios SET activo = FALSE WHERE id_usuario = ? AND id_empresa = ?',
            [req.params.id, id_empresa]
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        return res.json({ success: true, message: 'Usuario desactivado' });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        return res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
    }
};
