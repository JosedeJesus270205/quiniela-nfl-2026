/**
 * El servidor. Sin dependencias: solo lo que trae Node.
 *
 *   node servidor.js            -> http://localhost:4400
 *   node servidor.js --puerto 8080
 *
 * Sirve la carpeta publico/ y responde la API bajo /api/. El reloj de este
 * proceso es la unica hora que vale: el navegador puede decir misa.
 */

'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var api = require('./lib/api');
var admin = require('./lib/admin');
var configuracion = require('./lib/configuracion');
var almacen = require('./lib/almacen');
var vivo = require('./lib/vivo');
var reloj = require('./lib/reloj');

var PUBLICO = path.join(__dirname, 'publico');
var LIMITE_CUERPO = 256 * 1024;

// PORT es lo que inyecta el servicio donde se publica (Render y casi todos).
// QUINIELA_PUERTO sirve para forzarlo a mano, y --puerto manda sobre los dos.
var puerto = Number(process.env.QUINIELA_PUERTO) || Number(process.env.PORT) || 4400;
var i = process.argv.indexOf('--puerto');
if (i !== -1 && process.argv[i + 1]) puerto = Number(process.argv[i + 1]);

// ---------------------------------------------------------------------------
// Freno a los intentos de contrasena
// ---------------------------------------------------------------------------

var intentos = new Map();
var MAX_INTENTOS = 8;
var VENTANA = 10 * 60 * 1000;

function demasiadosIntentos(ip) {
  var registro = intentos.get(ip);
  if (!registro) return false;
  if (Date.now() - registro.desde > VENTANA) { intentos.delete(ip); return false; }
  return registro.veces >= MAX_INTENTOS;
}

function fallo(ip) {
  var registro = intentos.get(ip);
  if (!registro || Date.now() - registro.desde > VENTANA) {
    intentos.set(ip, { veces: 1, desde: Date.now() });
  } else {
    registro.veces++;
  }
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

var RUTAS = {
  'GET  /api/ambiente': api.ambiente,
  'POST /api/registro': api.registro,
  'POST /api/entrar': api.entrar,
  'POST /api/salir': api.salir,
  'POST /api/mi-clave': api.cambiarMiClave,
  'GET  /api/estado': api.estado,
  'GET  /api/semana': api.semana,
  'POST /api/pick': api.guardarPick,
  'POST /api/pick-quitar': api.quitarPick,
  'POST /api/confirmar': api.confirmar,
  'GET  /api/tabla': api.tabla,

  'POST /api/admin/entrar': admin.entrar,
  'GET  /api/admin/jugadores': admin.jugadores,
  'POST /api/admin/pago': admin.registrarPago,
  'POST /api/admin/pago-borrar': admin.borrarPago,
  'POST /api/admin/clave-nueva': admin.cambiarClave,
  'POST /api/admin/jugador-borrar': admin.borrarJugador,
  'POST /api/admin/marcar-semana': admin.marcarSemana,
  'GET  /api/admin/semana': admin.semana,
  'POST /api/admin/puntos': admin.fijarPuntos,
  'GET  /api/admin/picks': admin.picksDeSemana,
  'POST /api/admin/resultados': admin.actualizarResultados
};

// La tabla de arriba usa espacios de mas solo para que se lea alineada.
var TABLA = new Map();
Object.keys(RUTAS).forEach(function (clave) {
  var t = clave.trim().split(/\s+/);
  TABLA.set(t[0] + ' ' + t[1], RUTAS[clave]);
});

function buscarRuta(metodo, ruta) {
  return TABLA.get(metodo + ' ' + ruta) || null;
}

// ---------------------------------------------------------------------------
// Archivos estaticos
// ---------------------------------------------------------------------------

var TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function servirArchivo(res, ruta) {
  var relativa = decodeURIComponent(ruta.split('?')[0]);
  if (relativa === '/') relativa = '/index.html';
  if (relativa === '/admin') relativa = '/admin.html';

  var destino = path.join(PUBLICO, relativa);
  // Nadie sale de publico/ con ../
  if (!destino.startsWith(PUBLICO)) { res.writeHead(403).end('No.'); return; }

  fs.readFile(destino, function (err, contenido) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No existe ' + relativa);
      return;
    }
    var ext = path.extname(destino).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache'
    });
    res.end(contenido);
  });
}

// ---------------------------------------------------------------------------
// El servidor
// ---------------------------------------------------------------------------

function responder(res, codigo, datos) {
  var cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise(function (resolver, rechazar) {
    var trozos = [];
    var tamano = 0;
    req.on('data', function (t) {
      tamano += t.length;
      if (tamano > LIMITE_CUERPO) { rechazar(api.error(413, 'Peticion demasiado grande.')); req.destroy(); return; }
      trozos.push(t);
    });
    req.on('end', function () {
      if (!trozos.length) return resolver({});
      try {
        resolver(JSON.parse(Buffer.concat(trozos).toString('utf8')));
      } catch (e) {
        rechazar(api.error(400, 'El cuerpo no es JSON valido.'));
      }
    });
    req.on('error', rechazar);
  });
}

var servidor = http.createServer(async function (req, res) {
  var partes = url.parse(req.url, true);
  var ruta = partes.pathname;

  if (!ruta.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    return servirArchivo(res, req.url);
  }

  var manejador = buscarRuta(req.method, ruta);
  if (!manejador) return responder(res, 404, { error: 'Esa ruta no existe.' });

  var ip = req.socket.remoteAddress || 'desconocida';
  var esLogin = ruta === '/api/entrar' || ruta === '/api/admin/entrar' || ruta === '/api/registro';

  if (esLogin && demasiadosIntentos(ip)) {
    return responder(res, 429, { error: 'Demasiados intentos. Espera diez minutos.' });
  }

  try {
    var cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
    var cabecera = req.headers.authorization || '';
    var ctx = {
      token: cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '',
      cuerpo: cuerpo,
      consulta: partes.query,
      ip: ip
    };
    var salida = await manejador(ctx);
    if (esLogin) intentos.delete(ip);
    responder(res, 200, salida);
  } catch (e) {
    if (esLogin && (e.codigo === 401 || e.codigo === 409)) fallo(ip);
    if (!e.codigo) console.error('Error no previsto en ' + ruta + ':', e);
    responder(res, e.codigo || 500, {
      error: e.codigo ? e.message : 'Algo se rompio del lado del servidor.',
      motivo: e.extra && e.extra.motivo
    });
  }
});

/**
 * El vigilante de los partidos.
 *
 * Cada medio minuto se asoma a ver si hay algo corriendo y, si ESPN ya dio un
 * partido por terminado, guarda su marcador. Asi los puntos entran solos
 * aunque nadie tenga el tablero abierto: no dependen de que alguien pase por
 * la pagina ni de que el administrador se acuerde de picar un boton.
 *
 * Cuando no hay futbol —o sea, casi toda la semana— esto no consulta nada: la
 * primera revision es local y sale por la puerta de atras enseguida.
 */
function vigilarPartidos() {
  var trabajando = false;

  async function revisar() {
    if (trabajando) return;           // la vuelta anterior todavia no acaba
    trabajando = true;
    try {
      var calendario = almacen.calendario();
      var semanas = vivo.semanasEnJuego(calendario, almacen.resultados());
      for (var i = 0; i < semanas.length; i++) {
        await api.alDia(calendario, semanas[i]);
      }
    } catch (e) {
      // Que ESPN falle no puede tumbar al servidor. Se reintenta al rato.
      console.error('  (no se pudo revisar el marcador en vivo: ' + e.message + ')');
    } finally {
      trabajando = false;
    }
  }

  revisar();
  var latido = setInterval(revisar, vivo.CADA);
  // No mantiene vivo al proceso: si no hay nada mas que hacer, que se apague.
  if (latido.unref) latido.unref();
}

// Se lee la configuracion antes de escuchar: asi la contrasena del panel
// aparece en la consola arriba de la direccion.
var config = configuracion.cargar();

try {
  var cal = almacen.calendario();
  servidor.listen(puerto, function () {
    if (reloj.esEnsayo()) {
      var f = new Intl.DateTimeFormat('es-MX', {
        timeZone: config.zona, dateStyle: 'full', timeStyle: 'short'
      }).format(reloj.fechaDeEnsayo());
      console.log('  ############################################################');
      console.log('  #  MODO ENSAYO — el sistema cree que hoy es:');
      console.log('  #  ' + f);
      console.log('  #  Datos en ' + almacen.DATOS);
      console.log('  #  Nada de esto toca la quiniela de verdad.');
      console.log('  ############################################################\n');
    }
    console.log('  Quiniela NFL ' + cal.temporada + ' · ' + cal.partidos.length + ' partidos cargados');
    console.log('  Jugadores:      http://localhost:' + puerto + '/');
    console.log('  Administracion: http://localhost:' + puerto + '/admin');
    console.log('  Cuota $' + config.cuotaSemanal + ' x ' + config.semanasDePago +
                ' semanas = $' + config.totalTemporada);
    console.log('  Puntos: el 1o de la jornada paga ' + config.puntosPrimero +
                ', del 2o en adelante ' + config.puntosArranque + ', ' + (config.puntosArranque + 1) +
                ', ' + (config.puntosArranque + 2) + '… · empate x' + config.multiplicadorEmpate);
    console.log('\n  Ctrl+C para detener.\n');
    vigilarPartidos();
  });
} catch (e) {
  console.error('\n  No encuentro datos/calendario.json.');
  console.error('  Corre primero:  node herramientas/actualizar-calendario.js\n');
  process.exit(1);
}
