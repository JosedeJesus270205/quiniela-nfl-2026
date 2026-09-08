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
 * SIEMPRE respalda antes, en datos/respaldos/. Nada de esto se puede deshacer
 * de otra forma.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var RAIZ = path.join(__dirname, '..');
var DATOS = process.env.QUINIELA_DATOS ? path.resolve(process.env.QUINIELA_DATOS) : path.join(RAIZ, 'datos');
var ARCHIVO = path.join(DATOS, 'quiniela.json');
var RESULTADOS = path.join(DATOS, 'resultados.json');
var RESPALDOS = path.join(DATOS, 'respaldos');

var hazlo = process.argv.indexOf('--hazlo') !== -1;
var borrarJugadores = process.argv.indexOf('--borrar-jugadores') !== -1;

if (!fs.existsSync(ARCHIVO)) {
  console.log('\n  No hay nada que reiniciar: todavia no existe ' + ARCHIVO + '\n');
  process.exit(0);
}

var db = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
var resultados = fs.existsSync(RESULTADOS)
  ? JSON.parse(fs.readFileSync(RESULTADOS, 'utf8'))
  : { partidos: {} };

function pesos(n) { return '$' + Number(n).toLocaleString('es-MX'); }

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

// ---------------------------------------------------------------------------
// Que se va
// ---------------------------------------------------------------------------

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
  console.log('     node herramientas/reiniciar-temporada.js --hazlo --borrar-jugadores\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Respaldo y reinicio
// ---------------------------------------------------------------------------

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
console.log('\n  Si el servidor esta corriendo, reinicialo para que lo lea.\n');
