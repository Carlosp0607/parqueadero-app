# Correcciones aplicadas — parqueadero-app

Fecha: 2026-08-26

---

## 0. ACCIÓN URGENTE DE SU PARTE

El repositorio tenía el archivo `.env` versionado y **fuera** de `.gitignore`.
Si el proyecto ya está en la nube (GitHub, servidor, etc.), estas credenciales están expuestas:

- `DB_USER=root` / `DB_PASSWORD=111`
- `JWT_SECRET=cualquier_texto_largo_y_aleatorio_123456` (el texto de ejemplo)

Con ese secreto cualquiera puede firmar un JWT y entrar como administrador de cualquier empresa.

**Haga esto hoy:**
1. Cambiar la contraseña de MySQL/MariaDB. Crear un usuario dedicado (no `root`) con permisos solo sobre la BD `parqueadero`.
2. Generar un nuevo secreto:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Borrar `.env` del historial de Git:
   `git rm --cached .env && git commit -m "Elimina .env del repositorio"`
   (si ya estaba publicado, además reescribir historial con `git filter-repo` o BFG).
4. Al cambiar el `JWT_SECRET` todas las sesiones activas se invalidan: los usuarios deberán volver a iniciar sesión. Es lo esperado.

Ya se agregó `.env` a `.gitignore`, se creó `.env.example` como plantilla y se generó un `JWT_SECRET` aleatorio nuevo en el `.env` local.

---

## 1. Errores que impedían que el servidor arrancara

| # | Problema | Solución |
|---|---|---|
| 1 | `src/routes/reportes.js` no era un router: era un controlador (`exports.obtenerCierreCaja`), pero `server.js` lo montaba con `app.use()`. Crash inmediato. | Se separó en `controllers/reportes.controller.js` + `routes/reportes.js` (router real). |
| 2 | `src/routes/tarifas.js` tenía el mismo problema: controlador montado como router. | Se separó en `controllers/tarifas.controller.js` + `routes/tarifas.js`. |
| 3 | `src/middleware/auth.js` exportaba un objeto `{verificarToken, esAdmin}`, pero 7 archivos de rutas lo importaban como función. Express lanzaba `requires a callback function but got [object Object]`. | `auth.js` ahora exporta una **función** que además expone `.verificarToken` y `.esAdmin`. Ambos estilos de import funcionan. |
| 4 | Ruta mal escrita: `require('../middlewares/auth')` (plural) contra la carpeta real `middleware/` (singular), en `movimientos.js`, `tarifas.routes.js` y `reportes.routes.js`. | Corregido. |
| 5 | `src/routes/movimientos.js` requería `../controllers/movimientos.controller`, que no existía en el backend (el único con ese nombre era código de navegador en `public/js/`). | Se implementó `src/controllers/movimientos.controller.js` completo. |
| 6 | `tarifas.routes.js` y `reportes.routes.js` requerían controladores inexistentes y duplicaban a `tarifas.js` / `reportes.js`. | Archivos duplicados eliminados. |

## 2. Funcionalidad rota aunque el servidor arrancara

| # | Problema | Solución |
|---|---|---|
| 7 | `server.js` montaba solo 6 de 12 routers. Faltaban `empresa`, `mensualidades`, `dashboard`, `pagos`, `tipos-vehiculos` y `turnos`. El frontend les hacía 42 llamadas → todas 404 (configuración, mensualidades, turnos de caja, tipos de vehículo y dashboard no funcionaban). | Los 12 routers quedan montados. |
| 8 | `requireAdmin.js` leía `req.user.rol` mientras `auth.js` escribía `req.usuario` → 403 permanente en todo lo administrativo. | `auth.js` ahora sincroniza `req.usuario` y `req.user` con la misma identidad, e incluye a la vez `id` e `id_usuario`. |
| 9 | `controllers/usuarios.controller.js` consultaba columnas que **no existen** en `schema.sql` (`usuarios.id`, `usuarios.password`, `usuarios.estado`) → error 500 en cada petición. | Reescrito contra el esquema real (`id_usuario`, `contraseña`, `activo`). |
| 10 | **Fuga entre empresas:** el mismo controlador no filtraba por `id_empresa`, así que un admin veía y editaba usuarios de todas las empresas. | Todas las consultas quedan aisladas por `id_empresa`. |
| 11 | `DELETE /api/usuarios/:id` habría fallado por claves foráneas desde `movimientos`/`pagos`/`turnos`. | Se implementó como baja lógica (`activo = FALSE`), con bloqueo de auto-eliminación. |
| 12 | `reportes` leía `req.usuario.id` cuando el JWT guarda `id_usuario`, y consultaba `total_pagar`, `usuario_salida_id`, `estado='FINALIZADO'` (nada de eso existe). | Corregido contra el esquema real (`total_a_pagar`, `id_usuario_salida`, `estado='finalizado'`). |
| 13 | Existían dos logins incompatibles: `routes/auth.js` (`{empresa, usuario, password}`) y `controllers/auth.controllers.js` (`{nit, usuario_login, password}`), este último nunca ejecutado y apuntando a un esquema inexistente. | Se eliminó el controlador huérfano. `routes/auth.js` es la única fuente de verdad. |

## 3. Endpoints que el frontend consumía y no existían

Implementados desde cero contra `schema.sql`:

**Movimientos** (`src/controllers/movimientos.controller.js`)
- `POST /api/movimientos/ingreso` (alias `/entrada`) — busca o crea el vehículo, valida tipo, bloquea doble ingreso activo, asigna tarifa vigente.
- `POST /api/movimientos/calcular-salida` (alias `/calcular`) — calcula el total **sin** finalizar el movimiento.
- `POST /api/movimientos/confirmar-salida` (alias `/confirmar`) — finaliza y registra pagos en una sola transacción, con `FOR UPDATE` para evitar doble cobro, y rechaza pagos insuficientes.
- `POST /api/movimientos/salida` — salida directa por placa con un único método de pago.
- `GET /api/movimientos/detalle/:id`, `GET /api/movimientos/factura/:id`, `GET /api/movimientos/activos`.

**Reportes** (`src/controllers/reportes.controller.js`)
- `GET /api/reportes/kpis` — ingresos, ingresos por movimientos, ingresos por mensualidades, tickets, ticket promedio y % de ocupación.
- `GET /api/reportes/ingresos-por-dia`, `/ingresos-por-metodo`, `/movimientos` (paginado), `/movimientos-ajustados`, `/top-placas`.
- `GET /api/reportes/export/xlsx` y `/turnos/export/xlsx` (ExcelJS).
- `GET /api/reportes/turnos`, `/cierre-caja`.

**Tarifas** (`src/controllers/tarifas.controller.js`)
- `GET /api/tarifas`, `GET /api/tarifas/current` (solo vigentes).
- `PUT|POST /api/tarifas` — upsert por tipo de vehículo, solo admin.
- `PUT /api/tarifas/:id/estado`.

**Nueva utilidad** `src/utils/tarifa.js` — cálculo de cobro con los modos `minuto | hora | dia | mixto`, escalones (`paso_minutos_a_horas`, `paso_horas_a_dias`) y redondeo, tal como los define `schema.sql`. El procedimiento almacenado `calcular_total_pagar` ignoraba estos campos; el cálculo ahora vive en la aplicación.

## 4. Seguridad adicional

- `server.js` aborta el arranque si falta `JWT_SECRET`, en lugar de aceptar tokens firmados con `undefined`.
- `GET /admin/:page` sanea el parámetro: se bloquea el path traversal (`/admin/../../etc/passwd`).
- El manejador de errores se movió al final (antes quedaba después del 404 de API, en posición inválida).
- El 404 de API pasó de `app.use('/api/*', ...)` a `app.use('/api', ...)`, compatible con Express 5.
- Se valida el rol (`admin` u `operador`) y la longitud mínima de contraseña al crear y editar usuarios.

## 5. Limpieza

- Eliminado el frontend duplicado en la raíz (`/index.html`, `/css/`, `/js/`) que competía con `/public/`.
- Eliminadas dependencias sin relación con el proyecto: `ytdl-core`, `youtubei.js`, `youtube-transcript`.
- Añadido `"test": "node --test tests/*.test.js"` y `engines: node >= 18`.
- `.env` ya no duplica `DB_PASS` y `DB_PASSWORD` (`config/db.js` solo lee la segunda).

---

## Estado verificado

- `node --check` limpio en los 24 archivos de `src/`.
- El servidor arranca: `ParkSystem corriendo en puerto 3000`.
- `GET /` → 200 · `GET /admin/dashboard` → 200 · `GET /api/nada` → 404 JSON · `GET /api/tarifas` sin token → 401 JSON.
- `npm test` → 2 pruebas en verde.

## Pendiente de probar con base de datos real

Las consultas SQL se escribieron contra `schema.sql`, pero no se pudieron ejecutar aquí porque no hay MariaDB en este entorno. Antes de subir a producción conviene correr un ciclo completo: login → ingreso → cálculo de salida → confirmación de pago → reportes.
