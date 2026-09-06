# Sistema de Parqueadero (Multi-empresa)

Aplicación web para administrar parqueaderos. Registra entradas y salidas de vehículos, calcula el cobro según la tarifa, controla los turnos de caja y genera reportes de ingresos.

Está pensada para atender varias empresas desde una sola instalación: cada empresa ve únicamente su propia información.

## Tecnologías

- **Node.js + Express** — servidor y API
- **MySQL** — base de datos (en producción, alojada en Aiven)
- **JWT** — inicio de sesión y control de acceso
- **HTML, CSS y JavaScript** — interfaz, servida desde `public/`

## Qué hace

- **Ingreso y salida de vehículos.** Al registrar la salida calcula el total según el tiempo y la tarifa vigente.
- **Tarifas configurables.** Por minuto, hora, día o mixto, con tarifa distinta para carro, moto y bicicleta.
- **Pagos.** Efectivo, tarjeta o QR.
- **Turnos de caja.** El operador abre turno con una base inicial y al cerrar el sistema muestra los totales por método de pago y la diferencia.
- **Mensualidades.** Suscripciones por vehículo con su propio registro de pagos.
- **Reportes.** Ingresos por día y por método, tablas filtrables y exportación a Excel.
- **Usuarios y roles.** Administrador y operador, con permisos distintos.
- **Multi-empresa.** Toda consulta está filtrada por empresa; ninguna empresa ve datos de otra.
- **Seguridad.** Control de intentos de login y consultas parametrizadas contra inyección SQL.

## Requisitos

- Node.js 18 o superior
- MySQL 8 o superior

## Instalación

1. Clonar el repositorio e instalar dependencias:

```
npm install
```

2. Crear un archivo `.env` en la raíz:

```
PORT=3000
JWT_SECRET=tu_secreto_jwt

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=parqueadero
```

3. Ejecutar `schema.sql` en su cliente de MySQL. El script crea la base de datos, las tablas y datos de ejemplo: una empresa, un usuario administrador y las tarifas base.

> **Importante:** las credenciales del script son solo para desarrollo local.
> Cambie la contraseña del administrador antes de exponer la app a internet.

Si va a desplegar en un servicio en la nube como Aiven, use `schema-cloud.sql` en su lugar: ese archivo asume que la base ya existe.

## Ejecución

```
npm run dev     # desarrollo, con recarga automática
npm start       # producción
```

La aplicación queda en `http://localhost:3000`.

## Cómo se usa

1. Iniciar sesión con el NIT de la empresa, usuario y contraseña.
2. Configurar las tarifas de cada tipo de vehículo.
3. Abrir turno de caja.
4. Registrar ingresos y salidas de vehículos durante la jornada.
5. Cerrar turno y revisar los totales.
6. Consultar reportes y exportarlos a Excel.

## Estructura

```
src/
  server.js       Arranque del servidor
  config/         Conexión a la base de datos
  middleware/     Validación del token y de permisos
  routes/         Endpoints de la API
  utils/          Funciones de apoyo y validación de datos
public/
  index.html      Pantalla de inicio de sesión
  admin/          Vistas de administración y operación
  js/, css/       Recursos de la interfaz
schema.sql        Base de datos: tablas, vistas y datos iniciales
```

## API

Todos los endpoints van bajo `/api` y requieren el token en el header `Authorization: Bearer <token>`, salvo el login.

| Recurso | Para qué sirve |
|---|---|
| `/api/auth` | Inicio de sesión |
| `/api/vehiculos` | Registro y consulta de vehículos |
| `/api/movimientos` | Ingresos, salidas y facturas |
| `/api/tarifas` | Consulta y actualización de tarifas |
| `/api/turnos` | Apertura y cierre de caja |
| `/api/reportes` | Reportes y exportación a Excel |
| `/api/dashboard` | Estadísticas del tablero |
| `/api/empresa` | Datos, configuración y logo de la empresa |

## Notas

- Configure un `JWT_SECRET` propio antes de desplegar.
- Cambie la contraseña del administrador inicial.
- El logo de la empresa se guarda en la base de datos, no en disco.

## Licencia

ISC © Ciscode
