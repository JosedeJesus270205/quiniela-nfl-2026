/**
 * La pantalla del jugador.
 *
 * Importante: aqui los candados solo se DIBUJAN. Quien decide de verdad es el
 * servidor, que vuelve a revisar cada regla antes de guardar. Si alguien mueve
 * el reloj de su computadora, aqui vera otra cuenta regresiva pero el servidor
 * lo va a rechazar igual.
 */

'use strict';

(function () {

  // ------------------------------------------------------------------ base --
  var LLAVE = 'quiniela.token';
  var token = localStorage.getItem(LLAVE) || '';
  var estado = null;       // respuesta de /api/estado
  var semanaActual = null; // numero de semana en pantalla
  var datosSemana = null;  // respuesta de /api/semana
  var desfase = 0;         // reloj del servidor menos el del navegador
  var cronometro = null;

  var $ = function (id) { return document.getElementById(id); };

  function api(ruta, opciones) {
    opciones = opciones || {};
    var cabeceras = { 'Content-Type': 'application/json' };
    if (token) cabeceras.Authorization = 'Bearer ' + token;

    return fetch(ruta, {
      method: opciones.cuerpo ? 'POST' : 'GET',
      headers: cabeceras,
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (datos) {
        if (!r.ok) {
          var e = new Error(datos.error || 'Algo salio mal.');
          e.estado = r.status;
          e.motivo = datos.motivo;
          throw e;
        }
        return datos;
      });
    });
  }

  /** El reloj bueno: el del navegador corregido con el del servidor. */
  function ahora() { return Date.now() + desfase; }

  function sincronizar(iso) {
    if (iso) desfase = Date.parse(iso) - Date.now();
  }

  function brindis(mensaje, tipo) {
    var caja = document.createElement('div');
    caja.className = 'brindis ' + (tipo || '');
    caja.textContent = mensaje;
    $('brindis').appendChild(caja);
    setTimeout(function () {
      caja.style.transition = 'opacity .3s';
      caja.style.opacity = '0';
      setTimeout(function () { caja.remove(); }, 320);
    }, tipo === 'mal' ? 5200 : 3200);
  }

  // ------------------------------------------------------------------ iconos --
  // Dibujados a mano en lugar de emoji: los emoji cambian de forma en cada
  // sistema y le dan a todo cara de plantilla.
  var TRAZOS = {
    candado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    billete: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    pluma: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    palomita: '<path d="M20 6 9 17l-5-5"/>',
    trofeo: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
    luna: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    avion: '<path d="M21 15.5 3 10V7l3 1 2-2 13 6.5v3Z"/><path d="M7 20h9"/>',
    estrella: '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9Z"/>'
  };

  function ico(nombre, tam) {
    return '<svg class="ico" viewBox="0 0 24 24"' + (tam ? ' style="width:' + tam + ';height:' + tam + '"' : '') +
           '>' + TRAZOS[nombre] + '</svg>';
  }

  // ----------------------------------------------------------------- fechas --
  var ZONA = 'America/Mexico_City';

  var fmtLargo = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  var fmtDia = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'short'
  });
  var fmtCorto = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, day: '2-digit', month: 'short'
  });

  function limpiar(t) {
    return t.replace(/\./g, '').replace(/\s?a\s?m\b/i, ' AM').replace(/\s?p\s?m\b/i, ' PM');
  }

  var fmtHora = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true
  });
  var fmtDiaCorto = new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short'
  });

  function cuando(iso) { return limpiar(fmtLargo.format(new Date(iso))); }
  function horaCorta(iso) { return limpiar(fmtHora.format(new Date(iso))); }
  function diaCorto(iso) { return limpiar(fmtDiaCorto.format(new Date(iso))); }
  function dia(iso) { return limpiar(fmtDia.format(new Date(iso))); }
  function fecha(iso) { return fmtCorto.format(new Date(iso)).replace('.', ''); }

  /**
   * La hora de un partido. Cuando la NFL todavia no la define, ESPN manda
   * medianoche de relleno: en ese caso se dice el dia y se avisa, en lugar de
   * enseñar una hora inventada.
   */
  function horaDePartido(p) {
    if (p.horaConfirmada) return cuando(p.inicio);
    return dia(p.inicio) + ' <span class="porDefinir">· horario por definir</span>';
  }

  /** Cuenta regresiva legible: 2 d 04:31:07 */
  function faltante(ms) {
    if (ms <= 0) return null;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var dosDigitos = function (n) { return String(n).padStart(2, '0'); };
    return (d ? d + ' d ' : '') + dosDigitos(h) + ':' + dosDigitos(m) + ':' + dosDigitos(s);
  }

  function pesos(n) {
    return '$' + Number(n).toLocaleString('es-MX');
  }

  /**
   * Cuando el servidor corre en modo ensayo, se pinta una cinta que no deja
   * lugar a dudas: esto no es la quiniela de verdad.
   */
  function pintarCintaEnsayo(d) {
    var cinta = $('cinta-ensayo');
    if (!cinta || !d.ensayo) return;
    var f = new Intl.DateTimeFormat('es-MX', {
      timeZone: ZONA, weekday: 'long', day: 'numeric',
      month: 'long', hour: 'numeric', minute: '2-digit'
    }).format(new Date(d.ahora));
    cinta.innerHTML = 'Modo ensayo · el sistema cree que hoy es <b>' + f + '</b> · datos de mentiras';
    cinta.hidden = false;
    marcarPestana(d.ahora, 'Quiniela NFL');
  }

  /**
   * La pestaña del navegador también lo dice. Es lo primero que uno mira
   * cuando tiene la quiniela de verdad y un ensayo abiertos al mismo tiempo,
   * y en pantalla las dos se ven iguales.
   */
  function marcarPestana(iso, nombre) {
    var corto = new Intl.DateTimeFormat('es-MX', {
      timeZone: ZONA, day: 'numeric', month: 'short'
    }).format(new Date(iso));
    document.title = 'ENSAYO ' + corto + ' · ' + nombre;
  }


  // Lo primero de todo, antes de cualquier sesion: saber si esto es un ensayo.
  // Es justo en la pantalla de acceso donde uno se confunde de servidor.
  fetch('/api/ambiente')
    .then(function (r) { return r.json(); })
    .then(pintarCintaEnsayo)
    .catch(function () {});

  // ================================================================= ACCESO ==

  document.querySelectorAll('[data-pestana]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      var cual = boton.dataset.pestana;
      document.querySelectorAll('[data-pestana]').forEach(function (b) {
        b.setAttribute('aria-selected', String(b === boton));
      });
      $('form-entrar').hidden = cual !== 'entrar';
      $('form-registro').hidden = cual !== 'registro';
      $('error-acceso').hidden = true;
    });
  });

  function errorAcceso(mensaje) {
    var caja = $('error-acceso');
    caja.textContent = mensaje;
    caja.hidden = false;
  }

  $('form-entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('error-acceso').hidden = true;
    api('/api/entrar', { cuerpo: { correo: $('e-correo').value, contrasena: $('e-clave').value } })
      .then(entro)
      .catch(function (e) { errorAcceso(e.message); });
  });

  $('form-registro').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('error-acceso').hidden = true;
    api('/api/registro', {
      cuerpo: {
        nombre: $('r-nombre').value,
        correo: $('r-correo').value,
        telefono: $('r-tel').value,
        contrasena: $('r-clave').value
      }
    }).then(function (r) {
      entro(r);
      brindis('Cuenta creada. Avisale al administrador para que registre tu deposito.', 'bien');
    }).catch(function (e) { errorAcceso(e.message); });
  });

  function entro(respuesta) {
    token = respuesta.token;
    localStorage.setItem(LLAVE, token);
    arrancar();
  }

  $('salir').addEventListener('click', function () {
    api('/api/salir', { cuerpo: {} }).catch(function () {});
    localStorage.removeItem(LLAVE);
    location.reload();
  });

  // ============================================================= NAVEGACION ==

  document.querySelectorAll('[data-vista]').forEach(function (boton) {
    boton.addEventListener('click', function () {
      var cual = boton.dataset.vista;
      document.querySelectorAll('[data-vista]').forEach(function (b) {
        if (b === boton) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      ['partidos', 'tabla', 'cuenta'].forEach(function (v) {
        $('vista-' + v).hidden = v !== cual;
      });
      $('cupon-movil').hidden = cual !== 'partidos' || !pendientes().length;
      if (cual === 'tabla') cargarTabla();
      if (cual === 'cuenta') pintarCuenta();
    });
  });

  // ============================================================== ARRANQUE ==

  function arrancar() {
    api('/api/estado').then(function (datos) {
      estado = datos;
      sincronizar(datos.ahora);

      $('acceso').hidden = true;
      $('barra').hidden = false;
      $('app').hidden = false;
      pintarCintaEnsayo(datos);
      $('mi-nombre').textContent = datos.usuario.nombre.split(' ')[0];

      // Contrasena puesta por el administrador: se cambia antes de nada mas.
      if (datos.usuario.claveTemporal) exigirClavePropia();
      $('marca-temporada').textContent = 'TEMPORADA ' + (datos.temporada || '2026');

      pintarCintaPago();
      pintarListaJornadas();
      abrirSemana(semanaActual || datos.semanaSugerida);
    }).catch(function (e) {
      if (e.estado === 401) {
        localStorage.removeItem(LLAVE);
        token = '';
        $('acceso').hidden = false;
        $('barra').hidden = true;
        $('app').hidden = true;
      } else {
        brindis(e.message, 'mal');
      }
    });
  }

  // --------------------------------------------------------- cinta de pago --

  function pintarCintaPago() {
    var p = estado.pagos;
    var c = estado.config;
    var avance = Math.min(100, (p.total / c.totalTemporada) * 100);
    var debe = p.falta > 0;

    $('cinta-pago').className = 'cinta-pago' + (debe ? ' debe' : '');
    $('cinta-pago').innerHTML =
      '<div class="fila"><span class="etiqueta">Depositado</span>' +
        '<b>' + pesos(p.total) + '</b></div>' +
      '<div class="barra-progreso"><span style="width:' + avance.toFixed(1) + '%"></span></div>' +
      '<div class="pie">' +
        (debe
          ? 'Te faltan <b style="font-size:13px;color:var(--ambar)">' + pesos(p.falta) + '</b> · ' +
            Math.min(p.semanasCubiertas, c.semanasDePago) + ' de ' + c.semanasDePago + ' jornadas abiertas'
          : 'Temporada completa · las ' + c.semanasDePago + ' jornadas abiertas') +
      '</div>';
  }

  // ------------------------------------------------------ lista de jornadas --

  function pintarListaJornadas() {
    var caja = $('lista-jornadas');
    caja.innerHTML = '<div class="rubro etiqueta">Jornadas</div>' +
      estado.semanas.map(function (s) {
        var clase = s.cerrada ? 'pasada' : (s.pagada ? 'libre' : 'bloqueada');
        var marca = s.cerrada
          ? (s.confirmados ? s.confirmados + ' pks' : 'cerrada')
          : (s.pagada ? s.confirmados + '/' + s.partidos : 'pagar');
        return '<button data-semana="' + s.semana + '" class="' + clase + '"' +
               ' aria-pressed="' + (s.semana === semanaActual) + '">' +
               '<span class="n">' + s.semana + '</span>' +
               '<span>Semana ' + s.semana + '</span>' +
               '<span class="marca-estado">' + marca + '</span>' +
               '</button>';
      }).join('');

    caja.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { abrirSemana(Number(b.dataset.semana)); });
    });
  }

  // ================================================================= TABLERO ==

  function abrirSemana(n) {
    semanaActual = n;
    pintarListaJornadas();
    $('partidos').innerHTML = '<div class="cargando">Cargando jornada ' + n + '…</div>';

    api('/api/semana?n=' + n).then(function (datos) {
      datosSemana = datos;
      sincronizar(datos.ahora);
      pintarCabecera();
      pintarDestacado();
      pintarAvisos();
      pintarRenglones();
      latir();
    }).catch(function (e) { brindis(e.message, 'mal'); });
  }

  function pintarCabecera() {
    var d = datosSemana;
    var primero = d.partidos[0];
    var ultimo = d.partidos[d.partidos.length - 1];
    var rango = primero.horaConfirmada || ultimo.horaConfirmada
      ? dia(primero.inicio) + ' — ' + dia(ultimo.inicio)
      : 'Horarios por definir';

    $('cabecera-jornada').innerHTML =
      '<div class="cabecera-jornada">' +
        '<div>' +
          '<h3>Semana ' + d.semana + '</h3>' +
          '<div class="rango">' + rango + ' · ' + d.partidos.length + ' partidos</div>' +
        '</div>' +
        '<div class="cuenta" id="cuenta-regresiva"></div>' +
      '</div>';
  }

  /**
   * El partido 1 de la jornada, con la foto de su estadio. Es el unico que se
   * saca del renglon: paga mas que ninguno y se cierra a ciegas.
   */
  function pintarDestacado() {
    var p = datosSemana.partidos[0];
    if (!p) { $('destacado').innerHTML = ''; return; }

    var fondo = p.sedeId
      ? 'background-image:url(img/estadios/' + p.sedeId + '.jpg)'
      : 'background-image:linear-gradient(115deg,' + p.visitante.color + ' 0%,' +
        p.visitante.color + ' 42%,' + p.local.color + ' 58%,' + p.local.color + ' 100%)';

    $('destacado').innerHTML =
      '<div class="destacado' + (p.sedeId ? '' : ' sin-foto') + '" style="' + fondo + '">' +
        '<span class="marbete">' + ico('estrella') + ' Partido 1 · paga ' + p.puntos + '</span>' +
        '<h4>' + p.visitante.corto + ' <span style="color:var(--tenue)">en</span> ' + p.local.corto + '</h4>' +
        '<div class="sub">' + horaDePartido(p) +
          (p.sede ? ' · ' + p.sede : '') + (p.ciudad ? ', ' + p.ciudad : '') + '</div>' +
      '</div>';
  }

  /** Un solo cronometro para toda la pantalla. */
  function latir() {
    if (cronometro) clearInterval(cronometro);
    tic();
    cronometro = setInterval(tic, 1000);
  }

  function tic() {
    var caja = $('cuenta-regresiva');
    if (!caja || !datosSemana) return;

    var restante = datosSemana.cierre ? Date.parse(datosSemana.cierre) - ahora() : -1;
    var texto = faltante(restante);

    if (!texto) {
      caja.className = 'cuenta muerta';
      caja.innerHTML = ico('candado') + ' Jornada cerrada';
      if (!datosSemana.cerrada) { datosSemana.cerrada = true; abrirSemana(semanaActual); }
      return;
    }

    var urgente = restante < 60 * 60 * 1000;
    caja.className = 'cuenta' + (urgente ? ' urgente' : '');
    caja.innerHTML = ico('reloj') + ' ' + (datosSemana.cierraPartido || 'El siguiente') +
                     ' cierra en <b>' + texto + '</b>';

    // Si a algun partido se le paso su propia hora estando en pantalla, se
    // vuelve a pedir la jornada para que el candado baje solo.
    var alguienCambio = datosSemana.partidos.some(function (p) {
      return p.estado === 'abierto' && Date.parse(p.cierre) <= ahora();
    });
    if (alguienCambio) abrirSemana(semanaActual);
  }

  function pintarAvisos() {
    var d = datosSemana;
    var avisos = [];

    if (!d.pagada && d.requierePago) {
      avisos.push({
        clase: 'ambar', icono: 'billete',
        titulo: 'Esta jornada está bloqueada por pago',
        texto: 'Te faltan <b>' + pesos(d.falta) + '</b> para abrir la semana ' + d.semana +
               '. En cuanto el administrador registre tu depósito, se libera sola.'
      });
    } else if (!d.pagada && !d.requierePago) {
      avisos.push({
        clase: 'rojo', icono: 'candado',
        titulo: 'Semana ' + d.semana + ': solo para quien completó los ' + pesos(estado.config.totalTemporada),
        texto: 'De la semana ' + (estado.config.semanasDePago + 1) + ' en adelante ya no se deposita, ' +
               'pero se necesita la temporada pagada completa. Te faltan <b>' + pesos(d.falta) + '</b>.'
      });
    }

    if (d.cerrada && d.pagada) {
      avisos.push({
        clase: 'rojo', icono: 'candado',
        titulo: 'La jornada ' + d.semana + ' ya cerró',
        texto: 'Cerró 30 minutos antes de su primer partido. Aquí solo puedes ver lo que quedó registrado.'
      });
    }

    $('avisos-semana').innerHTML = avisos.map(function (a) {
      return '<div class="aviso ' + a.clase + '"><span class="icono">' + ico(a.icono) + '</span>' +
             '<div><b class="titulo">' + a.titulo + '</b>' + a.texto + '</div></div>';
    }).join('');
  }

  // ---------------------------------------------------------- los renglones --

  var MOTIVOS = {
    iniciado: 'Ya inició',
    cerrado: 'Cerrado',
    sin_pago: 'Sin pago'
  };

  /** Una de las tres opciones del renglon. */
  function opcion(p, cual, rotulo, valor) {
    var elegido = p.pick && p.pick.eleccion === cual;
    return '<button class="opcion" data-partido="' + p.id + '" data-eleccion="' + cual + '"' +
           ' aria-pressed="' + elegido + '"' + (p.editable ? '' : ' disabled') + '>' +
           '<span class="rotulo">' + rotulo + '</span>' +
           '<span class="valor">' + valor + '</span>' +
           '</button>';
  }

  function ladoEquipo(p, cual) {
    var e = p[cual];
    var m = p.resultado ? p.resultado[cual] : null;
    var clase = '';
    if (p.resultado) {
      clase = p.resultado.ganador === cual ? ' gano'
            : (p.resultado.ganador === 'empate' ? '' : ' perdio');
    }
    // El de casa lleva una marca chiquita. Quien no distingue local de
    // visitante ya no la necesita para elegir, pero al que le interesa ahi esta.
    var casa = cual === 'local' && !p.neutral
      ? '<span class="encasa" title="Juega en su casa">casa</span>' : '';

    return '<span class="equipo-linea' + clase + '">' +
             '<img src="img/equipos/' + e.abbr + '.png" alt="" loading="lazy">' +
             '<span class="nombre">' + e.corto + '</span>' + casa +
             (m !== null ? '<span class="marcador">' + m + '</span>' : '') +
           '</span>';
  }

  function renglon(p, indice) {
    var clases = ['renglon'];
    if (!p.editable) clases.push('bloqueado');
    if (p.pick && p.pick.confirmado) clases.push('firmado');
    if (p.ganados > 0) clases.push('acierto');

    var estadoCelda;
    if (p.pick && p.pick.confirmado) {
      estadoCelda = p.resultado
        ? (p.ganados > 0
            ? '<span class="sello gano">+' + p.ganados + '</span>'
            : '<span class="sello perdio">0 pts</span>')
        : '<span class="sello firmado">' + ico('palomita') + ' Firmado</span>';
    } else if (!p.editable) {
      estadoCelda = '<span class="sello candado">' + ico('candado') + ' ' +
                    (MOTIVOS[p.bloqueo] || 'Cerrado') + '</span>' +
                    (p.pick ? ' <span class="sello pendiente">0 pts</span>' : '');
    } else if (p.pick) {
      estadoCelda = '<span class="sello pendiente">Sin firmar</span>';
    } else {
      estadoCelda = '<span class="sello neutro">—</span>';
    }

    var hora = p.horaConfirmada
      ? '<b>' + horaCorta(p.inicio) + '</b>' + diaCorto(p.inicio)
      : '<b>' + diaCorto(p.inicio) + '</b><span class="pordef">por definir</span>';

    // Cada partido tiene su propia hora limite. Cuando ya falta poco se avisa
    // en el renglon, que es donde el jugador esta mirando.
    var faltaCierre = Date.parse(p.cierre) - ahora();
    if (p.editable && faltaCierre > 0 && faltaCierre < 6 * 60 * 60 * 1000) {
      hora += '<span class="urge">cierra en ' + faltante(faltaCierre) + '</span>';
    }

    return '<div class="' + clases.join(' ') + '">' +
      '<span class="cuando">' + hora + '</span>' +
      '<span class="enfrentamiento">' +
        ladoEquipo(p, 'visitante') + ladoEquipo(p, 'local') +
      '</span>' +
      opcion(p, 'visitante', p.visitante.corto, p.puntos) +
      opcion(p, 'empate', 'Empate', p.puntosEmpate) +
      opcion(p, 'local', p.local.corto, p.puntos) +
      '<span class="estado-celda">' + estadoCelda + '</span>' +
    '</div>';
  }

  function pintarRenglones() {
    $('partidos').innerHTML =
      '<div class="encabezado-columnas">' +
        '<span>Hora</span><span>Partido</span>' +
        '<span class="centrado abarca">¿Quién gana?</span>' +
        '<span class="centrado">Estado</span>' +
      '</div>' +
      datosSemana.partidos.map(renglon).join('');

    $('partidos').querySelectorAll('[data-eleccion]').forEach(function (b) {
      b.addEventListener('click', function () { elegir(b.dataset.partido, b.dataset.eleccion); });
    });

    pintarCupon();
  }

  // ==================================================================== CUPON ==

  /** Lo que el jugador lleva elegido en esta jornada, firmado o no. */
  function seleccionados() {
    if (!datosSemana) return [];
    return datosSemana.partidos.filter(function (p) { return p.pick; });
  }

  function pendientes() {
    return seleccionados().filter(function (p) { return p.editable && !p.pick.confirmado; });
  }

  function nombreDeEleccion(p) {
    if (p.pick.eleccion === 'empate') return 'Empate';
    return p[p.pick.eleccion].corto;
  }

  function puntosDelPick(p) {
    return p.pick.eleccion === 'empate' ? p.puntosEmpate : p.puntos;
  }

  function pintarCupon() {
    var elegidos = seleccionados();
    var porFirmar = pendientes();
    var suma = porFirmar.reduce(function (t, p) { return t + puntosDelPick(p); }, 0);

    var cuerpo;
    if (!elegidos.length) {
      cuerpo = '<div class="vacia">Todavía no eliges nada.<br>' +
               'Pica una opción de cualquier partido y se te va juntando aquí.</div>';
    } else {
      cuerpo = '<div class="lista">' + elegidos.map(function (p) {
        var firmado = p.pick.confirmado;
        return '<div class="apunte' + (firmado ? ' firmado' : '') + '">' +
          '<div class="cuerpo">' +
            '<div class="juego">' + p.visitante.abbr + ' @ ' + p.local.abbr + '</div>' +
            '<div class="eleccion">' + nombreDeEleccion(p) +
              (firmado ? ' <span class="sello firmado" style="padding:1px 5px;font-size:10px">Firmado</span>' : '') +
            '</div>' +
          '</div>' +
          '<span class="pts">' + puntosDelPick(p) + '</span>' +
          (p.editable && !firmado
            ? '<button class="quitar" data-quitar="' + p.id + '" title="Quitar">×</button>'
            : '') +
        '</div>';
      }).join('') + '</div>';
    }

    $('cupon').innerHTML =
      '<div class="titulo-cupon">' +
        '<h3>Mi cupón</h3>' +
        '<span class="conteo' + (porFirmar.length ? '' : ' vacio') + '">' + porFirmar.length + '</span>' +
      '</div>' +
      cuerpo +
      '<div class="cierre">' +
        '<div class="suma"><span>Si le atinas a todo</span><b>' + suma + '</b></div>' +
        '<button class="confirmar" id="firmar-cupon"' + (porFirmar.length ? '' : ' disabled') + '>' +
          (porFirmar.length
            ? 'Firmar ' + porFirmar.length + (porFirmar.length === 1 ? ' partido' : ' partidos')
            : 'Nada por firmar') +
        '</button>' +
      '</div>';

    $('cupon').querySelectorAll('[data-quitar]').forEach(function (b) {
      b.addEventListener('click', function () { quitar(b.dataset.quitar); });
    });
    var boton = $('firmar-cupon');
    if (boton) boton.addEventListener('click', firmarTodo);

    // La barra de abajo para pantallas angostas.
    var movil = $('cupon-movil');
    movil.hidden = !porFirmar.length || $('vista-partidos').hidden;
    $('movil-texto').textContent = porFirmar.length === 1
      ? '1 partido sin firmar' : porFirmar.length + ' partidos sin firmar';
    $('movil-puntos').textContent = suma + ' pts en juego';
    $('confirmar-movil').textContent = 'Firmar ' + porFirmar.length;
  }

  $('confirmar-movil').addEventListener('click', function () { firmarTodo(); });

  // -------------------------------------------------------------- acciones --

  function reemplazar(partido) {
    var i = datosSemana.partidos.findIndex(function (p) { return p.id === partido.id; });
    if (i !== -1) datosSemana.partidos[i] = partido;
    pintarRenglones();
    pintarAvisos();
  }

  function elegir(partidoId, eleccion) {
    var actual = datosSemana.partidos.find(function (p) { return p.id === partidoId; });
    // Volver a picar la misma opcion la quita.
    var quitarla = actual.pick && actual.pick.eleccion === eleccion;
    var ruta = quitarla ? '/api/pick-quitar' : '/api/pick';

    api(ruta, { cuerpo: { partidoId: partidoId, eleccion: eleccion } })
      .then(function (r) { reemplazar(r.partido); })
      .catch(function (e) {
        brindis(e.message, 'mal');
        if (e.estado === 403) abrirSemana(semanaActual);
      });
  }

  function quitar(partidoId) {
    api('/api/pick-quitar', { cuerpo: { partidoId: partidoId } })
      .then(function (r) { reemplazar(r.partido); })
      .catch(function (e) { brindis(e.message, 'mal'); });
  }

  /** Firmar todo el cupon de un golpe. Es irreversible. */
  function firmarTodo() {
    var porFirmar = pendientes();
    if (!porFirmar.length) return;

    var lista = porFirmar.map(function (p) {
      return p.visitante.abbr + ' @ ' + p.local.abbr + ' → ' + nombreDeEleccion(p) +
             ' (' + puntosDelPick(p) + ')';
    }).join('\n');
    var suma = porFirmar.reduce(function (t, p) { return t + puntosDelPick(p); }, 0);

    Dialogo.preguntar({
      titulo: 'Firmar ' + porFirmar.length + (porFirmar.length === 1 ? ' partido' : ' partidos'),
      texto: lista + '\n\nSon <b>' + suma + ' puntos</b> si le atinas a todo.\n' +
             'Después de firmar ya no se puede cambiar nada.',
      ok: 'Sí, firmar'
    }).then(function (si) {
      if (!si) return;
      api('/api/confirmar', { cuerpo: { semana: semanaActual } })
        .then(function (r) {
          datosSemana.partidos = r.partidos;
          pintarRenglones();
          pintarAvisos();
          brindis(r.confirmados + (r.confirmados === 1 ? ' partido firmado.' : ' partidos firmados.'), 'bien');
          if (r.saltados) brindis(r.saltados + ' se quedaron fuera: ya habían cerrado.', 'mal');
        })
        .catch(function (e) { brindis(e.message, 'mal'); });
    });
  }

  // ================================================================= TABLA ==

  function cargarTabla() {
    $('tabla-general').className = 'cargando';
    $('tabla-general').textContent = 'Cargando…';

    api('/api/tabla').then(function (d) {
      $('tabla-actualizada').textContent = d.actualizado
        ? 'Resultados al ' + cuando(d.actualizado)
        : 'Aún no se cargan resultados';

      if (!d.tabla.length) {
        $('tabla-general').innerHTML = '<div class="cargando">Todavía no hay jugadores.</div>';
        return;
      }

      $('tabla-general').className = '';
      $('tabla-general').innerHTML =
        '<table class="tabla"><thead><tr>' +
        '<th></th><th>Jugador</th><th class="num">Puntos</th><th class="num">Aciertos</th>' +
        '<th class="num">Empates</th><th class="num">Jornadas</th></tr></thead><tbody>' +
        d.tabla.map(function (f) {
          return '<tr' + (f.id === estado.usuario.id ? ' class="yo"' : '') + '>' +
            '<td class="lugar">' + f.lugar + '</td>' +
            '<td>' + f.nombre + '</td>' +
            '<td class="num" style="font-size:16px">' + f.puntos + '</td>' +
            '<td class="num">' + f.aciertos + ' / ' + f.jugados + '</td>' +
            '<td class="num">' + f.empates + '</td>' +
            '<td class="num">' + (f.semanasGanadas
              ? '<span style="color:var(--lima)">' + f.semanasGanadas + '</span>'
              : '<span style="color:var(--tenue)">—</span>') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>';

      pintarJornadas(d.semanas);
    }).catch(function (e) { brindis(e.message, 'mal'); });
  }

  /**
   * Quien gano cada jornada. Se pintan de la mas reciente hacia atras, y cada
   * una se abre para ver la tabla de esa semana sola.
   */
  function pintarJornadas(semanas) {
    var caja = $('ganadores-semana');
    if (!semanas || !semanas.length) {
      caja.innerHTML = '<div class="aviso azul"><span class="icono">' + ico('trofeo') + '</span>' +
        '<div><b class="titulo">Todavía no hay jornadas terminadas</b>' +
        'En cuanto se jueguen los primeros partidos y se carguen los marcadores, ' +
        'aquí aparece el ganador de cada semana.</div></div>';
      return;
    }

    caja.innerHTML = semanas.map(function (s) {
      var gane = s.ganadores.some(function (g) { return g.id === estado.usuario.id; });
      var repartida = s.ganadores.length > 1;

      var nombres = s.ganadores.length
        ? s.ganadores.map(function (g) { return g.nombre; }).join(' · ')
        : 'Nadie sumó puntos';

      return '<article class="jornada' + (gane ? ' gane' : '') + '" data-abierta="false">' +
        '<button class="encabezado" data-jornada="' + s.semana + '">' +
          '<span class="numero">' + s.semana + '</span>' +
          '<span class="quien-gano">' +
            '<span class="etiqueta">' + (repartida ? 'Empatados en primero' : 'Ganador de la jornada') + '</span>' +
            '<b>' + nombres + '</b>' +
            (repartida ? ' <span class="repartida">se reparten la semana</span>' : '') +
          '</span>' +
          '<span class="marcador-jornada">' +
            (s.completa ? '' : '<span class="incompleta">' + s.terminados + ' de ' + s.partidos + '</span>') +
            (s.ganadores.length ? '<span class="pts">' + s.ganadores[0].puntos + '</span>' : '') +
            '<span class="flecha">▶</span>' +
          '</span>' +
        '</button>' +
        '<div class="detalle" hidden>' +
          '<table class="tabla"><thead><tr><th></th><th>Jugador</th>' +
          '<th class="num">Puntos</th><th class="num">Aciertos</th></tr></thead><tbody>' +
          s.tabla.map(function (f) {
            return '<tr' + (f.id === estado.usuario.id ? ' class="yo"' : '') + '>' +
              '<td class="lugar">' + f.lugar + '</td><td>' + f.nombre + '</td>' +
              '<td class="num" style="font-size:16px">' + f.puntos + '</td>' +
              '<td class="num">' + f.aciertos + ' / ' + f.jugados + '</td></tr>';
          }).join('') +
          '</tbody></table>' +
        '</div>' +
      '</article>';
    }).join('');

    caja.querySelectorAll('[data-jornada]').forEach(function (b) {
      b.addEventListener('click', function () {
        var art = b.parentElement;
        var abierta = art.dataset.abierta === 'true';
        art.dataset.abierta = String(!abierta);
        art.querySelector('.detalle').hidden = abierta;
      });
    });
  }

  // ======================================================== MI CONTRASEÑA ===

  /**
   * Cambiar la propia contrasena. El servidor pide la de ahorita, cierra todas
   * las sesiones y entrega un token nuevo, asi que hay que guardarlo.
   */
  function cambiarMiClave(actual, nueva) {
    return api('/api/mi-clave', { cuerpo: { actual: actual, nueva: nueva } })
      .then(function (r) {
        token = r.token;
        localStorage.setItem(LLAVE, token);
        estado.usuario = r.usuario;
        return r;
      });
  }

  $('form-mi-clave').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var caja = $('error-clave');
    caja.hidden = true;

    if ($('c-nueva').value !== $('c-repetir').value) {
      caja.textContent = 'Las dos contraseñas nuevas no son iguales.';
      caja.hidden = false;
      return;
    }

    cambiarMiClave($('c-actual').value, $('c-nueva').value)
      .then(function () {
        $('form-mi-clave').reset();
        brindis('Listo, ya es tuya. Nadie más la sabe.', 'bien');
        pintarCuenta();
      })
      .catch(function (e) {
        caja.textContent = e.message;
        caja.hidden = false;
      });
  });

  /**
   * Cuando el administrador puso una contrasena de emergencia, el jugador tiene
   * que cambiarla antes de hacer cualquier otra cosa. El dialogo no se puede
   * cerrar: o la cambia, o se sale.
   */
  function exigirClavePropia() {
    Dialogo.cambioObligado({
      titulo: 'Ponte tu propia contraseña',
      texto: 'El administrador te dio una contraseña temporal para que pudieras entrar. ' +
             'Cámbiala ahora por una que solo tú sepas.',
      alGuardar: cambiarMiClave
    }).then(function () {
      brindis('Listo. Esa contraseña ya es solo tuya.', 'bien');
    });
  }

  // =============================================================== CUENTA ===

  function pintarCuenta() {
    var u = estado.usuario;
    var p = estado.pagos;
    var c = estado.config;

    $('datos-cuenta').innerHTML =
      '<h3 style="margin-bottom:14px;font-size:17px">Mis datos</h3>' +
      '<table class="tabla"><tbody>' +
      '<tr><td style="color:var(--suave);width:150px">Nombre</td><td><b>' + u.nombre + '</b></td></tr>' +
      '<tr><td style="color:var(--suave)">Correo</td><td>' + u.correo + '</td></tr>' +
      '<tr><td style="color:var(--suave)">Teléfono</td><td>' + u.telefono + '</td></tr>' +
      '<tr><td style="color:var(--suave)">Registrado</td><td>' + fecha(u.creado) + '</td></tr>' +
      (u.claveTemporal
        ? '<tr><td style="color:var(--suave)">Contraseña</td><td>' +
          '<span class="pastilla debe">Temporal · cámbiala abajo</span></td></tr>'
        : '') +
      '<tr><td style="color:var(--suave)">Depositado</td><td><b style="font-size:17px">' + pesos(p.total) +
        '</b> de ' + pesos(c.totalTemporada) + '</td></tr>' +
      '<tr><td style="color:var(--suave)">Semanas abiertas</td><td>' +
        (p.semanasCubiertas >= c.semanasDePago
          ? '<span class="pastilla ok">Toda la temporada</span>'
          : '<span class="pastilla debe">1 a la ' + p.semanasCubiertas + ' · faltan ' + pesos(p.falta) + '</span>') +
      '</td></tr></tbody></table>';

    $('mis-pagos').innerHTML = p.movimientos.length
      ? '<table class="tabla"><thead><tr><th>Fecha</th><th>Nota</th><th class="num">Monto</th></tr></thead><tbody>' +
        p.movimientos.map(function (m) {
          return '<tr><td>' + m.fecha + '</td><td style="color:var(--suave)">' + (m.nota || '—') +
                 '</td><td class="num">' + pesos(m.monto) + '</td></tr>';
        }).join('') +
        '</tbody><tfoot><tr><th colspan="2">Total</th><th class="num" style="font-size:16px;color:var(--texto)">' +
        pesos(p.total) + '</th></tr></tfoot></table>'
      : '<div class="aviso ambar"><span class="icono">' + ico('billete') + '</span><div><b class="titulo">Todavía no hay depósitos registrados</b>' +
        'En cuanto el administrador registre el tuyo, aparece aquí y se te abren las semanas.</div></div>';
  }

  // ============================================================== ENCENDER ==

  if (token) arrancar();

  // Al volver a la pestaña, resincronizar: pudo haber cerrado una semana.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && token && semanaActual) abrirSemana(semanaActual);
  });

})();
