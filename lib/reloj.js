/**
 * El reloj del sistema. TODO lo que necesite saber que hora es pasa por aqui.
 *
 * Normalmente devuelve la hora de verdad. Pero si existe la variable de entorno
 * QUINIELA_ENSAYO con una fecha, el sistema entero se cree que estamos en ese
 * momento: los candados cierran, los partidos "ya empezaron" y las cuentas
 * regresivas corren como si fuera ese dia.
 *
 * Sirve para ensayar una jornada completa antes de que llegue de verdad.
 *
 * A proposito NO se lee de un archivo de configuracion: va en la linea de
 * comandos, para que sea imposible dejarlo prendido sin darse cuenta. Un
 * servidor que se reinicia normal vuelve a la hora real solo.
 */

'use strict';

var desfase = 0;      // milisegundos que le sumamos al reloj de verdad
var fijada = null;    // la fecha que se pidio, tal cual, para poder avisarla

var pedida = process.env.QUINIELA_ENSAYO;
if (pedida) {
  var t = Date.parse(pedida);
  if (Number.isNaN(t)) {
    console.error('\n  QUINIELA_ENSAYO="' + pedida + '" no es una fecha que entienda.');
    console.error('  Usa algo como 2026-10-15T18:00:00Z\n');
    process.exit(1);
  }
  desfase = t - Date.now();
  fijada = new Date(t);
}

/** La hora que vale para todo el sistema. */
function ahora() {
  return new Date(Date.now() + desfase);
}

/** Lo mismo, en milisegundos. */
function milis() {
  return Date.now() + desfase;
}

/** Cadena ISO para guardar en la base. */
function sello() {
  return ahora().toISOString();
}

/** Estamos ensayando? */
function esEnsayo() {
  return fijada !== null;
}

/** La fecha del ensayo, o null si el reloj es el de verdad. */
function fechaDeEnsayo() {
  return fijada;
}

module.exports = {
  ahora: ahora,
  milis: milis,
  sello: sello,
  esEnsayo: esEnsayo,
  fechaDeEnsayo: fechaDeEnsayo
};
