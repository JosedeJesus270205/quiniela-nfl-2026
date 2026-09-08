/**
 * Baja el calendario oficial de la NFL desde la API publica de ESPN y arma
 * datos/calendario.json, que es la unica fuente de verdad de horarios.
 *
 *   node herramientas/actualizar-calendario.js
 *   node herramientas/actualizar-calendario.js --temporada 2027
 *   node herramientas/actualizar-calendario.js --sin-imagenes
 *
 * Tres cosas que importan:
 *
 * 1. La hora se guarda en UTC. El servidor la compara contra su propio reloj,
 *    asi que nadie se cuela adelantando la hora de su computadora.
 *
 * 2. ESPN marca con `timeValid: false` los partidos cuyo horario todavia no se
 *    define (el flex schedule de fin de temporada) y les pone medianoche de
 *    relleno. Eso se guarda como `horaConfirmada: false` para no tratar un
 *    relleno como si fuera una hora real.
 *
 * 3. La semana de la NFL corre de jueves a miercoles. Se calcula la ventana de
 *    cada semana y se avisa de cualquier partido que se salga de ella.
 *
 * De paso descarga los escudos y la foto de cada estadio, para que la quiniela
 * se vea igual aunque despues se corra sin internet.
 */

'use strict';

var fs = require('fs');
var path = require('path');

var RAIZ = path.join(__dirname, '..');
var SALIDA = path.join(RAIZ, 'datos', 'calendario.json');
var IMG = path.join(RAIZ, 'publico', 'img');
var SEMANAS = 18;
var DIA = 24 * 60 * 60 * 1000;

var temporada = 2026;
var i = process.argv.indexOf('--temporada');
if (i !== -1 && process.argv[i + 1]) temporada = Number(process.argv[i + 1]);
var sinImagenes = process.argv.indexOf('--sin-imagenes') !== -1;

function api(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('ESPN respondio ' + r.status + ' en ' + url);
    return r.json();
  });
}

function scoreboard(semana) {
  return api('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' +
             '?dates=' + temporada + '&seasontype=2&week=' + semana);
}

function equipo(competidor) {
  var t = competidor.team;
  return {
    abbr: t.abbreviation,
    nombre: t.displayName,
    corto: t.shortDisplayName || t.name,
    ciudad: t.location || '',
    color: '#' + (t.color || '2a2a2a'),
    alterno: '#' + (t.alternateColor || 'ffffff')
  };
}

/**
 * El jueves con el que arranca cada semana. Se toma el jueves de la semana
 * calendario del grueso de los partidos (el domingo), asi un partido adelantado
 * al miercoles no corre la ventana entera.
 */
function ventanaDeSemana(partidos) {
  var horas = partidos.map(function (p) { return Date.parse(p.inicio); }).sort(function (a, b) { return a - b; });
  var mediana = new Date(horas[Math.floor(horas.length / 2)]);
  // Retroceder al jueves anterior o igual a esa fecha (4 = jueves).
  var d = new Date(Date.UTC(mediana.getUTCFullYear(), mediana.getUTCMonth(), mediana.getUTCDate()));
  while (d.getUTCDay() !== 4) d = new Date(d.getTime() - DIA);
  return {
    inicia: d.toISOString(),                       // jueves 00:00 UTC
    termina: new Date(d.getTime() + 7 * DIA - 1).toISOString()  // miercoles 23:59:59 UTC
  };
}

async function bajar(url, destino) {
  if (fs.existsSync(destino)) return false;
  try {
    var r = await fetch(url);
    if (!r.ok) return false;
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch (e) {
    return false;
  }
}

async function main() {
  var partidos = [];
  var equipos = {};
  var sedes = {};
  var sinHora = 0;

  for (var s = 1; s <= SEMANAS; s++) {
    var datos = await scoreboard(s);
    var eventos = datos.events || [];

    eventos.forEach(function (ev) {
      var comp = ev.competitions[0];
      var casa = comp.competitors.find(function (c) { return c.homeAway === 'home'; });
      var fuera = comp.competitors.find(function (c) { return c.homeAway === 'away'; });
      if (!casa || !fuera) return;

      var local = equipo(casa);
      var visitante = equipo(fuera);
      equipos[local.abbr] = local;
      equipos[visitante.abbr] = visitante;

      var sede = comp.venue || {};
      var dir = sede.address || {};
      if (sede.id) {
        sedes[sede.id] = { nombre: sede.fullName, ciudad: [dir.city, dir.state || dir.country].filter(Boolean).join(', ') };
      }

      // ESPN pone medianoche de relleno cuando el horario no esta definido.
      var confirmada = comp.timeValid !== false;
      if (!confirmada) sinHora++;

      partidos.push({
        id: String(ev.id),
        semana: s,
        inicio: new Date(ev.date).toISOString(),
        horaConfirmada: confirmada,
        neutral: comp.neutralSite === true,
        local: local,
        visitante: visitante,
        sedeId: sede.id ? String(sede.id) : null,
        sede: sede.fullName || '',
        ciudad: [dir.city, dir.state || dir.country].filter(Boolean).join(', '),
        techo: sede.indoor === true
      });
    });

    process.stdout.write('Semana ' + String(s).padStart(2) + ': ' + eventos.length + ' partidos\n');
  }

  partidos.sort(function (a, b) {
    return a.semana - b.semana || a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id);
  });

  // Ventana jueves -> miercoles de cada semana, y aviso de los que se salen.
  var semanas = {};
  var fuera = [];
  for (var n = 1; n <= SEMANAS; n++) {
    var deLaSemana = partidos.filter(function (p) { return p.semana === n; });
    if (!deLaSemana.length) continue;
    var v = ventanaDeSemana(deLaSemana);
    semanas[n] = v;
    deLaSemana.forEach(function (p) {
      if (p.inicio < v.inicia || p.inicio > v.termina) {
        fuera.push({ semana: n, id: p.id, etiqueta: p.visitante.abbr + ' @ ' + p.local.abbr, inicio: p.inicio });
      }
    });
  }

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify({
    temporada: temporada,
    generado: new Date().toISOString(),
    fuente: 'site.api.espn.com · NFL scoreboard',
    semanas: semanas,
    equipos: equipos,
    sedes: sedes,
    partidos: partidos
  }, null, 1), 'utf8');

  console.log('\n' + partidos.length + ' partidos escritos en datos/calendario.json');

  if (sinHora) {
    console.log('\n  ' + sinHora + ' partidos SIN HORARIO DEFINIDO todavia.');
    console.log('  ESPN les pone medianoche de relleno; quedan marcados como');
    console.log('  horaConfirmada:false y en pantalla dicen "horario por definir".');
    console.log('  Vuelve a correr esto cuando la NFL publique los horarios.');
  }

  if (fuera.length) {
    console.log('\n  ' + fuera.length + ' partidos fuera de la ventana jueves-miercoles de su semana:');
    fuera.forEach(function (p) {
      var f = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
      }).format(new Date(p.inicio));
      console.log('     Semana ' + p.semana + '  ' + p.etiqueta + '  ' + f);
    });
    console.log('  Asi los publica ESPN. Los candados no dependen de que sea jueves:');
    console.log('  la semana cierra 30 min antes de SU primer partido, sea el dia que sea.');
  }

  if (sinImagenes) return;

  // ------------------------------------------------------------- imagenes --
  console.log('\nBajando imagenes…');
  var escudos = path.join(IMG, 'equipos');
  var estadios = path.join(IMG, 'estadios');
  [escudos, estadios].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });

  var abbrs = Object.keys(equipos).sort();
  var nuevos = 0;
  for (var j = 0; j < abbrs.length; j++) {
    var a = abbrs[j].toLowerCase();
    // El escudo estandar de ESPN trae contorno claro, asi que se lee bien
    // sobre el fondo oscuro sin necesidad de otra version.
    if (await bajar('https://a.espncdn.com/i/teamlogos/nfl/500/' + a + '.png',
                    path.join(escudos, abbrs[j] + '.png'))) nuevos++;
  }
  console.log('  ' + abbrs.length + ' equipos · ' + nuevos + ' escudos nuevos');

  // Foto de cada estadio. La interior se ve mejor de fondo: se ve el campo.
  var ids = Object.keys(sedes);
  var fotos = 0;
  for (var k = 0; k < ids.length; k++) {
    var destino = path.join(estadios, ids[k] + '.jpg');
    var ok = await bajar('https://a.espncdn.com/i/venues/nfl/day/interior/' + ids[k] + '.jpg', destino);
    if (!ok) ok = await bajar('https://a.espncdn.com/i/venues/nfl/day/' + ids[k] + '.jpg', destino);
    if (ok) fotos++;
  }
  console.log('  ' + ids.length + ' estadios · ' + fotos + ' fotos nuevas');
}

main().catch(function (e) {
  console.error('\nFallo la actualizacion:', e.message);
  process.exit(1);
});
