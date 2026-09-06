const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const validateLoginData = require('../middleware/validateLogin');

// Middleware para registrar intentos de inicio de sesión
const logLoginAttempt = async (id_empresa, usuario, exitoso, ip) => {
    try {
        const query = `
            INSERT INTO login_attempts (id_empresa, usuario_login, exitoso, ip_address, fecha_intento)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `;
        await pool.query(query, [id_empresa, usuario, exitoso, ip]);
    } catch (error) {
        console.error('Error al registrar intento de login:', error);
    }
};

// Verificar intentos fallidos
const checkFailedAttempts = async (id_empresa, usuario, ip) => {
    try {
        const [attempts] = await pool.query(
            `SELECT COUNT(*) as count 
             FROM login_attempts 
             WHERE id_empresa = ?
             AND (usuario_login = ? OR ip_address = ?) 
             AND exitoso = false 
             AND fecha_intento > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
            [id_empresa, usuario, ip]
        );
        return attempts[0].count;
    } catch (error) {
        console.error('Error al verificar intentos fallidos:', error);
        return 0;
    }
};

// ---------------------------------------------------------------------------
// Estado de la suscripcion
//
// La columna empresas.fecha_vencimiento existia desde el principio y el codigo
// NUNCA la consultaba: un parqueadero que dejaba de pagar seguia entrando,
// para siempre, sin forma de sacarlo salvo apagando la empresa a mano en la
// base de datos.
//
// Reglas:
//   - fecha_vencimiento NULL  ->  sin vencimiento. No se corta nada.
//   - vencida hace 0 a 5 dias ->  entra igual, pero se le avisa. Nadie deja a
//                                 un parqueadero sin cobrar por olvidar una
//                                 transferencia de un dia.
//   - vencida hace mas de 5   ->  no entra.
//
// Si la columna no existe todavia, se responde como si no hubiera vencimiento.
// Es preferible dejar entrar a tumbar el login de todos por una migracion.
// ---------------------------------------------------------------------------
const DIAS_DE_GRACIA = 5;

async function estadoSuscripcion(id_empresa) {
    let fila;
    try {
        const [rows] = await pool.query(
            `SELECT fecha_vencimiento,
                    DATEDIFF(CURDATE(), fecha_vencimiento) AS dias_vencida
             FROM empresas WHERE id_empresa = ?`,
            [id_empresa]
        );
        fila = rows[0];
    } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
            return { bloquear: false, avisar: false };
        }
        throw e;
    }

    if (!fila || fila.fecha_vencimiento == null) {
        return { bloquear: false, avisar: false };
    }

    const dias = Number(fila.dias_vencida);

    // Todavia al dia. Se avisa cuando faltan 5 dias o menos.
    if (dias < 0) {
        const faltan = Math.abs(dias);
        return {
            bloquear: false,
            avisar: faltan <= 5,
            mensaje: faltan === 0
                ? 'Tu plan vence hoy.'
                : 'Tu plan vence en ' + faltan + (faltan === 1 ? ' día.' : ' días.')
        };
    }

    // Vencida, pero dentro de la gracia.
    if (dias <= DIAS_DE_GRACIA) {
        const quedan = DIAS_DE_GRACIA - dias;
        return {
            bloquear: false,
            avisar: true,
            mensaje: 'Tu plan está vencido. Tienes ' + quedan +
                     (quedan === 1 ? ' día' : ' días') +
                     ' para ponerte al día antes de que se suspenda el acceso.'
        };
    }

    // Vencida y sin gracia.
    return {
        bloquear: true,
        mensaje: 'El plan de este parqueadero está vencido y el acceso quedó ' +
                 'suspendido. Comunícate para reactivarlo.'
    };
}

// ---------------------------------------------------------------------------
// Credenciales del demo publico.
//
// Se exponen a proposito: el boton "Entrar como invitado" del login las
// necesita para hacer el POST /login, y el usuario invitado es de SOLO LECTURA
// (lo bloquea src/middleware/auth.js) sobre una empresa con datos ficticios.
//
// Si las variables DEMO_* no estan definidas en el entorno, responde 404 y el
// boton nunca aparece en el login. Asi el demo se apaga sin tocar codigo.
// ---------------------------------------------------------------------------
router.get('/demo', (req, res) => {
    const { DEMO_NIT, DEMO_USER, DEMO_PASS } = process.env;

    if (!DEMO_NIT || !DEMO_USER || !DEMO_PASS) {
        return res.status(404).json({ success: false, message: 'Demo no disponible' });
    }

    res.json({
        success: true,
        data: { empresa: DEMO_NIT, usuario: DEMO_USER, password: DEMO_PASS }
    });
});

router.post('/login', validateLoginData, async (req, res) => {
    // Normalización de entradas para evitar problemas de espacios/caso
    const empresa = typeof req.body.empresa === 'string' ? req.body.empresa.trim() : req.body.empresa;
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : req.body.usuario;
    const password = req.body.password;
    const ip = req.ip || req.connection.remoteAddress;

    try {
        // Buscar la empresa
        const [empresas] = await pool.query(
            'SELECT id_empresa FROM empresas WHERE nit = ? AND activa = true',
            [empresa]
        );

        if (empresas.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Empresa no encontrada o inactiva'
            });
        }

        const id_empresa = empresas[0].id_empresa;

        // Verificar intentos fallidos
        const failedAttempts = await checkFailedAttempts(id_empresa, usuario, ip);
        if (failedAttempts >= 5) {
            await logLoginAttempt(id_empresa, usuario, false, ip);
            return res.status(429).json({
                success: false,
                message: 'Demasiados intentos fallidos. Por favor, intente más tarde.'
            });
        }

        // Buscar usuario en la base de datos
        const [users] = await pool.query(
            'SELECT * FROM usuarios WHERE usuario_login = ? AND id_empresa = ? AND activo = true',
            [usuario, id_empresa]
        );

        if (users.length === 0) {
            await logLoginAttempt(id_empresa, usuario, false, ip);
            return res.status(401).json({
                success: false,
                message: 'Usuario o contraseña incorrectos'
            });
        }

        const user = users[0];

        // Verificar contraseña
        const validPassword = await bcrypt.compare(password, user.contraseña);
        if (!validPassword) {
            await logLoginAttempt(id_empresa, usuario, false, ip);
            return res.status(401).json({
                success: false,
                message: 'Usuario o contraseña incorrectos'
            });
        }

        // Corte por falta de pago. Se revisa DESPUES de validar la contraseña
        // para no revelarle a un extraño el estado de pago de un parqueadero
        // ajeno solo con probar NITs.
        let suscripcion = { bloquear: false, avisar: false };
        try {
            suscripcion = await estadoSuscripcion(id_empresa);
        } catch (e) {
            console.error('[auth] No se pudo verificar el vencimiento:', e.message);
        }

        if (suscripcion.bloquear) {
            await logLoginAttempt(id_empresa, usuario, false, ip);
            console.warn(`[auth] Acceso bloqueado por vencimiento. Empresa ${id_empresa}.`);
            return res.status(402).json({
                success: false,
                message: suscripcion.mensaje,
                codigo: 'PLAN_VENCIDO'
            });
        }

        // Obtener configuración de la empresa
        const [config] = await pool.query(
            'SELECT * FROM configuracion_empresa WHERE id_empresa = ?',
            [id_empresa]
        );

        // Generar token JWT
        const token = jwt.sign(
            { 
                id: user.id_usuario,
                nombre: user.nombre,
                rol: user.rol,
                id_empresa: user.id_empresa,
                empresa: empresas[0]
            },
            process.env.JWT_SECRET || 'tu_secreto_jwt',
            { expiresIn: '8h' }
        );

        // Actualizar último acceso
        await pool.query(
            'UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id_usuario = ?',
            [user.id_usuario]
        );

        // Registrar inicio de sesión exitoso
        await logLoginAttempt(id_empresa, usuario, true, ip);

        // Cookie httpOnly para que el SERVIDOR pueda validar la sesión al entregar
        // las páginas de /admin. El token en localStorage no cambia: lo sigue usando
        // el navegador para llamar a la API.
        res.cookie('ps_session', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 8 * 60 * 60 * 1000
        });

        // Enviar respuesta exitosa
        res.json({
            success: true,
            data: {
                id: user.id_usuario,
                nombre: user.nombre,
                rol: user.rol,
                id_empresa: user.id_empresa,
                empresa: empresas[0],
                config: config[0],
                token,
                // El frontend muestra este aviso si viene. No bloquea nada.
                aviso_plan: suscripcion.avisar ? suscripcion.mensaje : null
            },
            message: 'Inicio de sesión exitoso'
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: 'Error en el servidor'
        });
    }
});

// Cierre de sesión: borra la cookie del servidor.
// El localStorage lo limpia el navegador por su lado.
router.post('/logout', (req, res) => {
    res.clearCookie('ps_session');
    res.json({ success: true, message: 'Sesión cerrada' });
});

module.exports = router;