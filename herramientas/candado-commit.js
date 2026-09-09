/**
 * El candado del commit.
 *
 * Se corre solo antes de cada commit y lo rechaza si detecta datos de
 * jugadores o secretos. El repo es publico: aqui un descuido no se puede
 * deshacer, porque hay bots que archivan repos nuevos en minutos y borrar el
 * commit despues no borra la copia que ya se llevaron.
 *
 * Revisa dos cosas:
 *
 *   1. Archivos que jamas deben subir, por su ruta.
 *   2. Contenido que huele a dato real: hashes de contrasena, tokens,
 *      correos que no son de ejemplo, telefonos de diez digitos.
 *
 * Para saltarlo a proposito (rarisimo, piensalo dos veces):
 *   git commit --no-verify
 */

'use strict';

var cp = require('child_process');

// ---------------------------------------------------------------------------
// Lo que nunca sube, por ruta
// ---------------------------------------------------------------------------

var RUTAS_PROHIBIDAS = [
  { patron: /(^|\/)quiniela\.json$/,      que: 'la base de datos: jugadores, pagos y picks' },
  { patron: /(^|\/)configuracion\.json$/, que: 'la configuracion, que trae la contrasena del panel' },
  { patron: /(^|\/)resultados\.json$/,    que: 'los marcadores cargados' },
  { patron: /(^|\/)respaldos\//,          que: 'un respaldo de la base' },
  { patron: /^ensayo\//,                  que: 'la carpeta del modo ensayo' },
  { patron: /\.env(\.|$)/,                que: 'un archivo de variables de entorno' },
  { patron: /\.pem$|\.key$|id_rsa/,       que: 'una llave privada' }
];

// ---------------------------------------------------------------------------
// Lo que nunca sube, por contenido
// ---------------------------------------------------------------------------

var HUELLAS = [
  { patron: /"hash"\s*:\s*"[0-9a-f]{64}"/,        que: 'el hash de la contrasena de un jugador' },
  { patron: /"sal"\s*:\s*"[0-9a-f]{32}"/,         que: 'la sal de la contrasena de un jugador' },
  { patron: /adminContrasena"?\s*[:=]\s*"[^"]{4,}"/, que: 'la contrasena del panel, escrita a mano' },
  { patron: /gh[pousr]_[A-Za-z0-9]{20,}/,         que: 'un token de GitHub' },
  { patron: /github_pat_[A-Za-z0-9_]{20,}/,       que: 'un token de GitHub' },
  { patron: /"telefono"\s*:\s*"\d{10}"/,          que: 'el telefono de alguien' }
];

// Correos que si pueden aparecer: son de ejemplo o de maquina.
var CORREOS_PERMITIDOS = /@(ejemplo\.mx|ensayo\.mx|example\.(com|org)|users\.noreply\.github\.com|anthropic\.com)$/i;
var CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Archivos donde no tiene sentido buscar texto.
var BINARIOS = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip)$/i;

// ---------------------------------------------------------------------------

function enEspera() {
  var salida = cp.execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
  return salida.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
}

function contenido(archivo) {
  try {
    return cp.execSync('git show :' + JSON.stringify(archivo), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    return '';
  }
}

var problemas = [];
var archivos = enEspera();

archivos.forEach(function (archivo) {
  RUTAS_PROHIBIDAS.forEach(function (r) {
    if (r.patron.test(archivo)) {
      problemas.push({ archivo: archivo, que: r.que, donde: 'por su ruta' });
    }
  });

  if (BINARIOS.test(archivo)) return;

  var texto = contenido(archivo);
  if (!texto) return;

  HUELLAS.forEach(function (h) {
    var m = texto.match(h.patron);
    if (m) {
      problemas.push({ archivo: archivo, que: h.que, donde: 'linea ' + linea(texto, m.index) });
    }
  });

  var correos = texto.match(CORREO) || [];
  var sospechosos = [];
  correos.forEach(function (c) {
    if (!CORREOS_PERMITIDOS.test(c) && sospechosos.indexOf(c) === -1) sospechosos.push(c);
  });
  if (sospechosos.length) {
    problemas.push({
      archivo: archivo,
      que: 'un correo que no es de ejemplo: ' + sospechosos.slice(0, 3).join(', '),
      donde: 'linea ' + linea(texto, texto.indexOf(sospechosos[0]))
    });
  }
});

function linea(texto, indice) {
  return texto.slice(0, indice).split('\n').length;
}

if (!problemas.length) process.exit(0);

console.error('');
console.error('  COMMIT DETENIDO. Esto no puede subir a un repo publico:');
console.error('');
problemas.forEach(function (p) {
  console.error('     ' + p.archivo);
  console.error('        ' + p.que + '  (' + p.donde + ')');
});
console.error('');
console.error('  Quitalo de la zona de espera con:');
problemas.forEach(function (p) {
  console.error('     git restore --staged ' + JSON.stringify(p.archivo));
});
console.error('');
console.error('  Si de verdad es un falso positivo:  git commit --no-verify');
console.error('');
process.exit(1);
