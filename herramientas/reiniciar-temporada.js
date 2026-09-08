/**
 * Deja la quiniela en ceros para arrancar una temporada.
 *
 *   node herramientas/reiniciar-temporada.js                  dice que haria
 *   node herramientas/reiniciar-temporada.js --hazlo          lo hace
 *   node herramientas/reiniciar-temporada.js --hazlo --borrar-jugadores
 *
 * Borra pagos, picks, marcadores y los puntos que se hayan ajustado a mano.
 * Las cuentas de los jugadores se quedan (nombre, correo, telefono y su
 * contrasena) salvo que se pida --borrar-jugadores.
 *
 * SIEMPRE respalda antes, en datos/respaldos/.
 *
 * OJO: no corre si el servidor esta prendido, y con razon. El servidor tiene
 * la base cargada en memoria y la reescribe entera cada vez que guarda algo;
 * si aqui se toca el archivo por debajo, el primer guardado del servidor
 * revive todo lo borrado y el reinicio se pierde sin que nadie se entere.
 */

'use strict';

var fs = require('fs');
var net = require('net');
var path = require('path');

var RAIZ = path.join(__dirname, '..');
var DATOS = process.env.QUINIELA_DATOS ? path.resolve(process.env.QUINIELA_DATOS) : path.join(RAIZ, 'datos');
var ARCHIVO = path.join(DATOS, 'quiniela.json');
var RESULTADOS = path.join(DATOS, 'resultados.json');
var RESPALDOS = path.join(DATOS, 'respaldos');
var PUERTO = Number(process.env.QUINIELA_PUERTO) || 4400;

var hazlo = process.argv.indexOf('--hazlo') !== -1;
var borrarJugadores = process.argv.indexOf('--borrar-jugadores') !== -1;

function pesos(n) { return '$' + Number(n).toLocaleString('es-MX'); }

/** Hay alguien escuchando en ese puerto? */
function servidorCorriendo(puerto) {
  return new Promise(function (resolver) {
    var s = net.createConnection({ host: '127.0.0.1', port: puerto });
    var listo = false;
    var terminar = function (r) { if (!listo) { listo = true; s.destroy(); resolver(r); } };
    s.setTimeout(600);
    s.on('connect', function () { terminar(true); });
    s.on('error', function () { terminar(false); });
    s.on('timeout', function () { terminar(false); });
  });
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(ARCHIVO)) {
  console.log('\n  No hay nada que reiniciar: todavia no existe ' + ARCHIVO + '\n');
  process.exit(0);
}

var db = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
var resultados = fs.existsSync(RESULTADOS)
  ? JSON.parse(fs.readFileSync(RESULTADOS, 'utf8'))
  : { partidos: {} };

// ---------------------------------------------------------------------------
// Que hay ahorita
// ---------------------------------------------------------------------------

console.log('\n  LO QUE HAY AHORITA\n');

db.usuarios.forEach(function (u) {
  var pagos = db.pagos.filter(function (p) { return p.usuarioId === u.id; });
  var total = pagos.reduce(function (s, p) { return s + Number(p.monto || 0); }, 0);
  var picks = db.picks[u.id] || {};
  var firmados = Object.keys(picks).filter(function (k) { return picks[k].confirmado; }).length;

  console.log('     ' + u.nombre);
  console.log('        ' + u.correo + '   ' + pesos(total) + ' en ' + pagos.length +
              ' movimientos   ' + Object.keys(picks).length + ' picks (' + firmados + ' firmados)');
});

if (!db.usuarios.length) console.log('     (ninguna cuenta)');

console.log('');
console.log('     ' + Object.keys(resultados.partidos || {}).length + ' partidos con marcador');
console.log('     ' + Object.keys(db.puntos || {}).length + ' partidos con puntaje ajustado a mano');

console.log('\n  LO QUE SE BORRA\n');
console.log('     todos los pagos           (' + db.pagos.length + ')');
console.log('     todos los picks           (' + Object.keys(db.picks).length + ' jugadores con picks)');
console.log('     todos los marcadores      (' + Object.keys(resultados.partidos || {}).length + ')');
console.log('     los puntajes a mano       (' + Object.keys(db.puntos || {}).length + ')');
console.log('     las sesiones abiertas     (' + Object.keys(db.sesiones).length + ')');
console.log('     ' + (borrarJugadores
  ? 'LAS CUENTAS DE LOS JUGADORES (' + db.usuarios.length + ')'
  : 'las cuentas se QUEDAN (' + db.usuarios.length + '), con su contrasena'));

if (!hazlo) {
  console.log('\n  Esto fue solo un ensayo. Para hacerlo de verdad:');
  console.log('     node herramientas/reiniciar-temporada.js --hazlo');
  console.log('     node herramientas/reiniciar-temporada.js --hazlo --borrar-jugadores');
  console.log('\n  El servidor tiene que estar apagado.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Respaldo y reinicio
// ---------------------------------------------------------------------------

servidorCorriendo(PUERTO).then(function (prendido) {
  if (prendido) {
    console.error('\n  NO SE HIZO NADA: el servidor esta corriendo en el puerto ' + PUERTO + '.');
    console.error('');
    console.error('  Con el servidor prendido este reinicio no serviria de nada: el');
    console.error('  servidor trae la base en memoria y la reescribe completa en cuanto');
    console.error('  guarda cualquier cosa, con lo que revive todo lo que aqui se borre.');
    console.error('');
    console.error('  Apagalo (Ctrl+C en su ventana), corre esto otra vez, y vuelve a');
    console.error('  prenderlo.\n');
    process.exit(1);
  }

  fs.mkdirSync(RESPALDOS, { recursive: true });
  var sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var copia = path.join(RESPALDOS, 'quiniela-' + sello + '.json');
  fs.copyFileSync(ARCHIVO, copia);
  if (fs.existsSync(RESULTADOS)) {
    fs.copyFileSync(RESULTADOS, path.join(RESPALDOS, 'resultados-' + sello + '.json'));
  }

  db.pagos = [];
  db.picks = {};
  db.puntos = {};
  db.sesiones = {};
  if (borrarJugadores) db.usuarios = [];

  var temporal = ARCHIVO + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(db, null, 1), 'utf8');
  fs.renameSync(temporal, ARCHIVO);

  if (fs.existsSync(RESULTADOS)) fs.unlinkSync(RESULTADOS);

  console.log('\n  Listo. La quiniela quedo en ceros.');
  console.log('  Respaldo en ' + copia);
  console.log('\n  Ya puedes volver a prender el servidor.\n');
});
