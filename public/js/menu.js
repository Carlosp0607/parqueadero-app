/* ============================================================
   public/js/menu.js
   Menu lateral unico de ParkSystem.
   Reescribe el sidebar de la pagina donde se cargue.
   Para cambiar el menu del sistema entero, se edita SOLO este archivo.

   Uso: agregar antes de </body> en cada pagina del panel:
     <script src="../js/menu.js"></script>
   ============================================================ */
(function () {
  'use strict';

  var ITEMS = [
    { href: 'dashboard.html',       icono: 'fa-tachometer-alt',    texto: 'Dashboard' },
    { href: 'operacion.html',       icono: 'fa-right-left',        texto: 'Operación' },
    { href: 'vehiculos.html',       icono: 'fa-car',               texto: 'Vehículos' },
    { href: 'mensualidades.html',   icono: 'fa-calendar-check',    texto: 'Mensualidades' },
    { href: 'configuracion.html',   icono: 'fa-gear',              texto: 'Configuración',      admin: true },
    { href: 'tipos-vehiculos.html', icono: 'fa-tags',              texto: 'Tipos de Vehículos', admin: true },
    { href: 'tarifas.html',         icono: 'fa-money-bill-wave',   texto: 'Tarifas',            admin: true },
    { href: 'usuarios.html',        icono: 'fa-users',             texto: 'Usuarios',           admin: true },
    { href: 'reportes.html',        icono: 'fa-chart-bar',         texto: 'Reportes',           admin: true }
  ];

  var RUTA_LOGOUT = '/api/auth/logout';

  function paginaActual() {
    var p = window.location.pathname.split('/').pop() || 'dashboard.html';
    return p.toLowerCase();
  }

  function htmlSidebar() {
    var actual = paginaActual();
    var li = ITEMS.map(function (it) {
      var activo = (it.href.toLowerCase() === actual) ? ' active' : '';
      var clase  = it.admin ? 'nav-item admin-only' : 'nav-item';
      return '<li class="' + clase + '">' +
               '<a href="' + it.href + '" class="nav-link' + activo + '">' +
                 '<i class="fas ' + it.icono + '"></i><span>' + it.texto + '</span>' +
               '</a>' +
             '</li>';
    }).join('');

    return '' +
      '<div class="sidebar-header">' +
        '<div class="logo-container">' +
          '<div class="logo-circle"><span class="logo-text">PS</span></div>' +
        '</div>' +
        '<h5 class="mt-3 text-white">ParkSystem</h5>' +
      '</div>' +
      '<nav class="sidebar-nav"><ul class="nav flex-column">' + li + '</ul></nav>' +
      '<div class="sidebar-footer">' +
        '<a href="#" class="nav-link" id="btnLogout">' +
          '<i class="fas fa-sign-out-alt"></i><span>Cerrar Sesión</span>' +
        '</a>' +
      '</div>';
  }

  function montar() {
    var side = document.querySelector('.sidebar');

    // Si la pagina no trae sidebar, se crea al inicio del body.
    if (!side) {
      side = document.createElement('div');
      side.className = 'sidebar';
      document.body.insertBefore(side, document.body.firstChild);
    }
    side.innerHTML = htmlSidebar();

    // Toggle para pantallas pequenas.
    var toggle = document.querySelector('.sidebar-toggle');
    if (toggle && !toggle.dataset.menuJs) {
      toggle.dataset.menuJs = '1';
      toggle.addEventListener('click', function () {
        side.classList.toggle('active');
        var main = document.querySelector('.main-content');
        if (main) main.classList.toggle('active');
      });
    }

    // Cerrar sesion.
    var salir = document.getElementById('btnLogout');
    if (salir) {
      salir.addEventListener('click', function (e) {
        e.preventDefault();
        var headers = { 'Content-Type': 'application/json' };
        var tok = localStorage.getItem('token') || localStorage.getItem('ps_token');
        if (tok) headers['Authorization'] = 'Bearer ' + tok;

        fetch(RUTA_LOGOUT, {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: '{}'
        })
        .catch(function () { /* la cookie igual se descarta al salir */ })
        .then(function () {
          localStorage.removeItem('token');
          localStorage.removeItem('ps_token');
          localStorage.removeItem('usuario');
          localStorage.removeItem('user');
          window.location.href = '/';
        });
      });
    }

    // Nombre del usuario en la barra superior, si la pagina lo tiene.
    var span = document.getElementById('userName');
    if (span) {
      try {
        var u = JSON.parse(localStorage.getItem('usuario') || localStorage.getItem('user') || 'null');
        var n = u && (u.nombre || u.usuario || u.username || u.nombre_usuario);
        if (n) span.textContent = n;
      } catch (e) { /* sin datos de usuario en localStorage */ }
    }

    // Oculta las opciones de admin si el rol es operador.
    try {
      var raw = localStorage.getItem('usuario') || localStorage.getItem('user');
      var user = raw ? JSON.parse(raw) : null;
      var rol = user && String(user.rol || user.role || '').toLowerCase();
      if (rol === 'operador') {
        side.querySelectorAll('.admin-only').forEach(function (el) {
          el.style.display = 'none';
        });
      }
    } catch (e) { /* sin rol: se deja el menu completo */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
