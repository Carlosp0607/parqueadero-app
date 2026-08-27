const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// FIX: fallar rápido si falta el secreto en lugar de aceptar tokens con `undefined`
if (!process.env.JWT_SECRET) {
    console.error('ERROR: falta JWT_SECRET en el archivo .env. El servidor no puede iniciar.');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 2. Archivos estáticos
app.use(express.static(path.join(__dirname, '../public')));

// 3. Rutas de la API
// FIX: antes solo se montaban 6 de 12 routers. empresa, mensualidades, dashboard,
// pagos, tipos-vehiculos y turnos existían pero nunca se registraban -> 404 en el frontend.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/empresa', require('./routes/empresa'));
app.use('/api/vehiculos', require('./routes/vehiculos'));
app.use('/api/tipos-vehiculos', require('./routes/tipos-vehiculos'));
app.use('/api/movimientos', require('./routes/movimientos'));
app.use('/api/tarifas', require('./routes/tarifas'));
app.use('/api/pagos', require('./routes/pagos'));
app.use('/api/mensualidades', require('./routes/mensualidades'));
app.use('/api/turnos', require('./routes/turnos'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reportes', require('./routes/reportes'));

// 4. 404 de API (debe ir DESPUÉS de las rutas y ANTES de las vistas)
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint no encontrado' });
});

// 5. Vistas HTML
app.get('/admin/:page', (req, res) => {
    // FIX: sanear el parámetro para evitar path traversal (../../ en la URL)
    const page = path.basename(String(req.params.page)).replace(/\.html$/i, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(page)) {
        return res.status(404).sendFile(path.join(__dirname, '../public', '404.html'));
    }
    const filePath = path.join(__dirname, '../public', 'admin', `${page}.html`);

    res.sendFile(filePath, (err) => {
        if (err) {
            res.status(404).sendFile(path.join(__dirname, '../public', '404.html'), (err404) => {
                if (err404) res.status(404).send('Página no encontrada');
            });
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// 6. Manejador de errores (4 argumentos: debe ser el último)
app.use((err, req, res, next) => {
    console.error('Error no controlado:', err.stack || err);
    if (res.headersSent) return next(err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

app.listen(PORT, () => {
    console.log(`ParkSystem corriendo en puerto ${PORT}`);
});
