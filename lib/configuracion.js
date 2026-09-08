/**
 * La configuracion editable. Se crea sola la primera vez que arranca el
 * servidor, en datos/configuracion.json, con una contrasena de administrador
 * generada al azar que se imprime una vez en la consola.
 *
 * Todo lo de aqui se puede cambiar con un editor de texto sin tocar codigo:
 * la cuota semanal, hasta que semana se cobra, lo que paga el primer partido de
 * la jornada, donde arranca la escalera de los demas, cuanto paga el empate y
 * de cuanto es el margen de cierre.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var reglas = require('./reglas');

var DATOS = process.env.QUINIELA_DATOS
  ? path.resolve(process.env.QUINIELA_DATOS)
  : path.join(__dirname, '..', 'datos');
var ARCHIVO = path.join(DATOS, 'configuracion.json');

var cache = null;

function contrasenaLegible() {
  var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  var partes = [];
  for (var b = 0; b < 3; b++) {
    var t = '';
    for (var i = 0; i < 4; i++) t += abc[crypto.randomInt(abc.length)];
    partes.push(t);
  }
  return partes.join('-');
}

function cargar() {
  if (cache) return cache;

  var nueva = false;
  var datos = {};
  try {
    datos = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  } catch (e) {
    nueva = true;
  }

  var config = {
    // Al publicar conviene fijarla por variable de entorno: asi no hay que ir
    // a buscarla a los registros del servidor ni queda escrita en el disco.
    adminContrasena: process.env.QUINIELA_ADMIN || datos.adminContrasena || contrasenaLegible(),
    cuotaSemanal: Number(datos.cuotaSemanal) || reglas.CONFIG.cuotaSemanal,
    semanasDePago: Number(datos.semanasDePago) || reglas.CONFIG.semanasDePago,
    puntosPrimero: Number(datos.puntosPrimero) || reglas.CONFIG.puntosPrimero,
    puntosArranque: Number(datos.puntosArranque) || reglas.CONFIG.puntosArranque,
    multiplicadorEmpate: Number(datos.multiplicadorEmpate) || reglas.CONFIG.multiplicadorEmpate,
    minutosCierre: Number.isFinite(Number(datos.minutosCierre))
      ? Number(datos.minutosCierre)
      : reglas.CONFIG.minutosCierre,
    zona: datos.zona || reglas.CONFIG.zona
  };
  config.totalTemporada = config.cuotaSemanal * config.semanasDePago;

  if (nueva) {
    // Si la contrasena viene del entorno NO se escribe en el archivo: se queda
    // nada mas donde el que publica la puso. Tampoco se imprime, para que no
    // acabe en los registros del servidor.
    var delEntorno = !!process.env.QUINIELA_ADMIN;
    var aGuardar = Object.assign({}, config);
    if (delEntorno) delete aGuardar.adminContrasena;

    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    fs.writeFileSync(ARCHIVO, JSON.stringify(aGuardar, null, 1), 'utf8');

    console.log('\n  Se creo ' + ARCHIVO);
    if (delEntorno) {
      console.log('  La contrasena del panel viene de QUINIELA_ADMIN.');
      console.log('  No se guardo en el archivo ni se imprime aqui.\n');
    } else {
      console.log('  Contrasena del panel de administracion:  ' + config.adminContrasena);
      console.log('  (esta en ese archivo, la puedes cambiar cuando quieras)\n');
    }
  }

  cache = config;
  return cache;
}

/** Lo que si se le puede mandar al navegador. La contrasena nunca sale. */
function publica() {
  var c = cargar();
  return {
    cuotaSemanal: c.cuotaSemanal,
    semanasDePago: c.semanasDePago,
    totalTemporada: c.totalTemporada,
    puntosPrimero: c.puntosPrimero,
    puntosArranque: c.puntosArranque,
    multiplicadorEmpate: c.multiplicadorEmpate,
    minutosCierre: c.minutosCierre,
    zona: c.zona
  };
}

module.exports = { ARCHIVO: ARCHIVO, cargar: cargar, publica: publica };
