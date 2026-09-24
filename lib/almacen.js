/**
 * La base de datos. Es un solo archivo JSON en datos/quiniela.json que se
 * escribe de forma atomica (primero a un temporal, luego se reemplaza) para que
 * un corte de luz a media escritura no deje el archivo a medias.
 *
 * Guarda: jugadores, pagos, picks, puntos por partido y sesiones abiertas.
 * Las contrasenas nunca se guardan en claro: se guarda el scrypt con su sal.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var reloj = require('./reloj');

var RAIZ = path.join(__dirname, '..');
// El modo ensayo apunta a su propia carpeta para no rozar los datos de verdad.
var DATOS = process.env.QUINIELA_DATOS
  ? path.resolve(process.env.QUINIELA_DATOS)
  : path.join(RAIZ, 'datos');

var ARCHIVO = path.join(DATOS, 'quiniela.json');
var RESULTADOS = path.join(DATOS, 'resultados.json');

/**
 * El calendario no es un dato que cambie solo: viene con el codigo. Al
 * publicar, DATOS apunta a un disco aparte donde el calendario no esta, asi
 * que si no aparece ahi se busca en la carpeta del proyecto.
 */
var CALENDARIO = fs.existsSync(path.join(DATOS, 'calendario.json'))
  ? path.join(DATOS, 'calendario.json')
  : path.join(RAIZ, 'datos', 'calendario.json');

var VACIO = {
  version: 1,
  puntos: {},      // { partidoId: puntos }  lo que el admin define a mano
  usuarios: [],    // { id, nombre, correo, telefono, sal, hash, creado }
  pagos: [],       // { id, usuarioId, monto, fecha, nota, registrado }
  picks: {},       // { usuarioId: { partidoId: { eleccion, confirmado, ... } } }
  sesiones: {}     // { token: { usuarioId, expira } }  admin usa usuarioId ':admin'
};

var cache = null;

// ---------------------------------------------------------------------------
// Lectura y escritura
// ---------------------------------------------------------------------------

function cargar() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    Object.keys(VACIO).forEach(function (k) {
      if (cache[k] === undefined) cache[k] = JSON.parse(JSON.stringify(VACIO[k]));
    });
  } catch (e) {
    cache = JSON.parse(JSON.stringify(VACIO));
  }
  return cache;
}

function guardar() {
  if (!cache) return;
  fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
  var temporal = ARCHIVO + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(temporal, ARCHIVO);
}

function calendario() {
  return JSON.parse(fs.readFileSync(CALENDARIO, 'utf8'));
}

function resultados() {
  try {
    return JSON.parse(fs.readFileSync(RESULTADOS, 'utf8'));
  } catch (e) {
    return { actualizado: null, partidos: {} };
  }
}

function guardarResultados(datos) {
  fs.mkdirSync(path.dirname(RESULTADOS), { recursive: true });
  fs.writeFileSync(RESULTADOS, JSON.stringify(datos, null, 1), 'utf8');
}

// ---------------------------------------------------------------------------
// Contrasenas y sesiones
// ---------------------------------------------------------------------------

function hashear(contrasena, sal) {
  return crypto.scryptSync(String(contrasena), sal, 32).toString('hex');
}

function nuevaSal() {
  return crypto.randomBytes(16).toString('hex');
}

/** Comparacion en tiempo constante: no delata la contrasena por lo que tarda. */
function contrasenaCorrecta(contrasena, usuario) {
  if (!usuario || !usuario.sal || !usuario.hash) return false;
  var intento = Buffer.from(hashear(contrasena, usuario.sal), 'hex');
  var guardado = Buffer.from(usuario.hash, 'hex');
  return intento.length === guardado.length && crypto.timingSafeEqual(intento, guardado);
}

var DIAS_SESION = 30;

function abrirSesion(usuarioId) {
  var db = cargar();
  var token = crypto.randomBytes(32).toString('hex');
  db.sesiones[token] = {
    usuarioId: usuarioId,
    expira: reloj.milis() + DIAS_SESION * 24 * 60 * 60 * 1000
  };
  limpiarSesiones(db);
  guardar();
  return token;
}

function cerrarSesion(token) {
  var db = cargar();
  if (db.sesiones[token]) {
    delete db.sesiones[token];
    guardar();
  }
}

function limpiarSesiones(db) {
  var ahora = reloj.milis();
  Object.keys(db.sesiones).forEach(function (t) {
    if (!db.sesiones[t] || db.sesiones[t].expira < ahora) delete db.sesiones[t];
  });
}

/** Devuelve el usuario de una sesion viva, o null. */
function sesion(token) {
  if (!token) return null;
  var db = cargar();
  var s = db.sesiones[token];
  if (!s || s.expira < reloj.milis()) return null;
  if (s.usuarioId === ':admin') return { admin: true, id: ':admin', nombre: 'Administrador' };
  var u = buscarPorId(s.usuarioId);
  return u ? Object.assign({ admin: false }, u) : null;
}

// ---------------------------------------------------------------------------
// Jugadores
// ---------------------------------------------------------------------------

function normalizarCorreo(correo) {
  return String(correo || '').trim().toLowerCase();
}

function buscarPorCorreo(correo) {
  var c = normalizarCorreo(correo);
  return cargar().usuarios.find(function (u) { return u.correo === c; }) || null;
}

function buscarPorId(id) {
  return cargar().usuarios.find(function (u) { return u.id === id; }) || null;
}

function crearUsuario(datos) {
  var db = cargar();
  var sal = nuevaSal();
  var usuario = {
    id: crypto.randomUUID(),
    nombre: String(datos.nombre).trim(),
    correo: normalizarCorreo(datos.correo),
    telefono: String(datos.telefono).trim(),
    sal: sal,
    hash: hashear(datos.contrasena, sal),
    creado: reloj.sello()
  };
  db.usuarios.push(usuario);
  guardar();
  return usuario;
}

/**
 * Le pone contrasena nueva a un jugador.
 *
 * Cuando la pone el ADMINISTRADOR va marcada como temporal: el jugador esta
 * obligado a cambiarla la proxima vez que entre, y hasta que lo haga no puede
 * hacer nada mas. Asi el administrador nunca se queda sabiendo la contrasena
 * de nadie.
 *
 * Se le cierran todas las sesiones abiertas a proposito: si alguien mas andaba
 * metido en esa cuenta, queda fuera en el momento.
 */
function cambiarContrasena(usuarioId, nueva, temporal) {
  var db = cargar();
  var usuario = db.usuarios.find(function (u) { return u.id === usuarioId; });
  if (!usuario) return false;

  usuario.sal = nuevaSal();
  usuario.hash = hashear(nueva, usuario.sal);
  if (temporal) usuario.claveTemporal = true;
  else delete usuario.claveTemporal;

  Object.keys(db.sesiones).forEach(function (t) {
    if (db.sesiones[t].usuarioId === usuarioId) delete db.sesiones[t];
  });

  guardar();
  return true;
}

/**
 * Borra a un jugador y todo lo suyo: pagos, picks y sesiones. Sirve para el
 * que se registro dos veces o el que ya no va a jugar. No se puede deshacer.
 */
function borrarUsuario(usuarioId) {
  var db = cargar();
  var antes = db.usuarios.length;
  db.usuarios = db.usuarios.filter(function (u) { return u.id !== usuarioId; });
  if (db.usuarios.length === antes) return false;

  db.pagos = db.pagos.filter(function (p) { return p.usuarioId !== usuarioId; });
  delete db.picks[usuarioId];
  Object.keys(db.sesiones).forEach(function (t) {
    if (db.sesiones[t].usuarioId === usuarioId) delete db.sesiones[t];
  });
  guardar();
  return true;
}

/** El jugador tal como se le puede mandar al navegador: sin sal ni hash. */
function publico(usuario) {
  if (!usuario) return null;
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    telefono: usuario.telefono,
    creado: usuario.creado,
    // Si el administrador le puso una de emergencia, tiene que cambiarla.
    claveTemporal: !!usuario.claveTemporal
  };
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

function pagosDe(usuarioId) {
  return cargar().pagos.filter(function (p) { return p.usuarioId === usuarioId; });
}

function registrarPago(usuarioId, monto, nota, fecha) {
  var db = cargar();
  var pago = {
    id: crypto.randomUUID(),
    usuarioId: usuarioId,
    monto: Number(monto),
    fecha: fecha || reloj.sello().slice(0, 10),
    nota: String(nota || '').trim(),
    registrado: reloj.sello()
  };
  db.pagos.push(pago);
  guardar();
  return pago;
}

/**
 * Recorta lo depositado hasta dejarlo en `objetivo` pesos, quitando de los
 * movimientos mas recientes hacia atras. Si uno queda a medias se le baja el
 * monto en lugar de borrarlo, para que el historial siga cuadrando.
 */
function recortarPagos(usuarioId, objetivo) {
  var db = cargar();
  var mios = db.pagos
    .filter(function (p) { return p.usuarioId === usuarioId; })
    .sort(function (a, b) { return b.registrado.localeCompare(a.registrado); });

  var total = mios.reduce(function (s, p) { return s + Number(p.monto || 0); }, 0);
  var sobra = total - objetivo;
  var quitados = [];

  for (var i = 0; i < mios.length && sobra > 0; i++) {
    var p = mios[i];
    if (p.monto <= sobra) {
      sobra -= p.monto;
      quitados.push(p.id);
    } else {
      p.monto -= sobra;
      p.nota = (p.nota ? p.nota + ' · ' : '') + 'ajustado desde el tablero';
      sobra = 0;
    }
  }

  db.pagos = db.pagos.filter(function (p) { return quitados.indexOf(p.id) === -1; });
  guardar();
  return total - objetivo;
}

function borrarPago(pagoId) {
  var db = cargar();
  var antes = db.pagos.length;
  db.pagos = db.pagos.filter(function (p) { return p.id !== pagoId; });
  if (db.pagos.length !== antes) guardar();
  return db.pagos.length !== antes;
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

function picksDe(usuarioId) {
  var db = cargar();
  if (!db.picks[usuarioId]) db.picks[usuarioId] = {};
  return db.picks[usuarioId];
}

function guardarPick(usuarioId, partidoId, eleccion) {
  var mios = picksDe(usuarioId);
  mios[partidoId] = {
    eleccion: eleccion,
    confirmado: false,
    actualizado: reloj.sello()
  };
  guardar();
  return mios[partidoId];
}

function confirmarPick(usuarioId, partidoId) {
  var mios = picksDe(usuarioId);
  if (!mios[partidoId]) return null;
  mios[partidoId].confirmado = true;
  mios[partidoId].confirmadoEn = reloj.sello();
  guardar();
  return mios[partidoId];
}

function borrarPick(usuarioId, partidoId) {
  var mios = picksDe(usuarioId);
  if (!mios[partidoId] || mios[partidoId].confirmado) return false;
  delete mios[partidoId];
  guardar();
  return true;
}

// ---------------------------------------------------------------------------
// Puntos por partido (los define el administrador)
// ---------------------------------------------------------------------------

function puntos() {
  return cargar().puntos;
}

function fijarPuntos(mapa) {
  var db = cargar();
  Object.keys(mapa).forEach(function (id) {
    var v = Number(mapa[id]);
    if (!Number.isFinite(v) || v <= 0) delete db.puntos[id];
    else db.puntos[id] = v;
  });
  guardar();
  return db.puntos;
}

module.exports = {
  ARCHIVO: ARCHIVO,
  DATOS: DATOS,
  cargar: cargar,
  guardar: guardar,
  calendario: calendario,
  resultados: resultados,
  guardarResultados: guardarResultados,
  hashear: hashear,
  nuevaSal: nuevaSal,
  contrasenaCorrecta: contrasenaCorrecta,
  abrirSesion: abrirSesion,
  cerrarSesion: cerrarSesion,
  sesion: sesion,
  normalizarCorreo: normalizarCorreo,
  buscarPorCorreo: buscarPorCorreo,
  buscarPorId: buscarPorId,
  crearUsuario: crearUsuario,
  cambiarContrasena: cambiarContrasena,
  borrarUsuario: borrarUsuario,
  publico: publico,
  pagosDe: pagosDe,
  registrarPago: registrarPago,
  recortarPagos: recortarPagos,
  borrarPago: borrarPago,
  picksDe: picksDe,
  guardarPick: guardarPick,
  confirmarPick: confirmarPick,
  borrarPick: borrarPick,
  puntos: puntos,
  fijarPuntos: fijarPuntos
};
