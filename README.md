# Quiniela NFL

Quiniela de la temporada 2026 de la NFL: 272 partidos reales, pagos semanales,
candados por horario y puntos configurables partido por partido.

Sin dependencias. Solo Node 18 o más nuevo.

---

## Arrancar

```bash
node servidor.js
```

- Jugadores → <http://localhost:4400/>
- Administración → <http://localhost:4400/admin>

La primera vez se crea `datos/configuracion.json` con una contraseña de
administrador al azar, **que se imprime una sola vez en la consola**. Está en ese
archivo; cámbiala cuando quieras.

Para que entren desde otros equipos de la misma red, comparte tu IP local
(`ipconfig`) con el puerto: `http://192.168.x.x:4400`.

---

## Las reglas, tal como quedaron programadas

### Pagos

| | |
|---|---|
| Cuota | $100 por semana |
| Se deposita | De la semana 1 a la 15 |
| Total de la temporada | $1,500 |

Cada $100 abre una semana, **en orden y sin importar la fecha del depósito**.
Quien mete $700 de golpe trae las semanas 1 a la 7 abiertas.

**Semanas 16, 17, 18 y eliminatorias:** ya no se deposita, pero solo juega quien
completó los $1,500. A quien le faltó, se le quedan los puntos que ya llevaba.

Nadie puede poner partidos de una semana que no tiene pagada. El único que
libera es el administrador, registrando el depósito en su panel.

### Horarios

La semana de la NFL corre de **jueves a miércoles**, y el miércoles no hay
juego. Dos excepciones reales en 2026, así publicadas por ESPN: el partido
inaugural (NE @ SEA, **miércoles 9 de septiembre**) y GB @ LAR la víspera de
Thanksgiving (**miércoles 25 de noviembre**). Los candados no dependen del día
de la semana, así que las dos quedan cubiertas.

- **Cada semana cierra 30 minutos antes de SU primer partido**, sea jueves o
  miércoles. Se cierra completa: el del jueves y el del lunes por igual.
- **REGLA DE ORO: un partido que ya inició no se puede tocar jamás.** Se revisa
  partido por partido, además del cierre de la semana, para que un cambio de
  horario de la NFL no abra una rendija.

Las dos se verifican **en el servidor**, con el reloj del servidor. Quien mueva
la hora de su computadora verá otra cuenta regresiva en pantalla, pero el
servidor lo rechaza igual. Las horas se muestran siempre en hora de Ciudad de
México.

### Los horarios que la NFL todavía no define

Al día de hoy hay **24 partidos sin hora**: toda la semana 18, más cuatro de la
16 y cuatro de la 17. Es el *flex schedule*: la NFL decide esos horarios ya
entrada la temporada. ESPN los entrega con medianoche de relleno y una marca de
`timeValid: false`.

La quiniela los guarda como `horaConfirmada: false` y en pantalla dice
**"horario por definir"** en lugar de inventar una hora. Vuelve a correr
`actualizar-calendario.js` cuando la NFL los publique.

### Puntos

El puntaje se calcula solo, por el **lugar que ocupa el partido dentro de su
semana** (el orden es cronológico: el primero de la jornada es el partido 1).

| Partido | 1 | 2 | 3 | 4 | 5 | … | 16 | 17 |
|---|---|---|---|---|---|---|---|---|
| **Paga** | 25 | 10 | 11 | 12 | 13 | … | 24 | 25 |

El primero se lleva el premio gordo porque es el único que hay que arriesgar a
ciegas: cuando arranca, la semana entera ya cerró. Y como cada partido vale
distinto, dos jugadores casi nunca terminan empatados.

> En 2026 ninguna semana llega a 17 partidos: van de 13 a 16. La escalera es la
> misma, nada más que termina antes (una semana de 16 cierra en 24).

- **Atinarle al empate paga el doble** de lo que valga ese partido: 50 en el
  primero, 20 en el segundo, 22 en el tercero…
- El administrador puede **pisar el valor de cualquier partido** desde **Puntos
  por partido**, y devolverlo al automático con un botón.
- Solo se elige una opción: ganador **o** empate. Elegir una desactiva la otra.

### Ganadores por jornada

Además de la tabla general de toda la temporada, cada semana tiene su propio
ganador: el que más puntos hizo en esa jornada.

**La jornada corre de jueves a martes.** Un partido en miércoles pertenece a la
jornada que arranca al día siguiente. En 2026 solo hay dos partidos en
miércoles —el inaugural y la víspera de Thanksgiving— y con esta regla caen
exactamente en la semana que les corresponde según la NFL. Está verificado
contra los 272 partidos: las 18 jornadas jueves-martes coinciden una a una con
las 18 semanas del calendario.

Detalles de cómo se cuenta:

- Solo compite quien tenga **picks confirmados** en esa semana. Al que no pagó o
  no alcanzó a firmar no se le cuenta como que perdió: simplemente no estuvo.
- Si dos empatan arriba, **se reparten la jornada** y a los dos se les acredita.
- Una jornada aparece en cuanto tiene su primer marcador final, marcada como
  incompleta hasta que terminen todos sus partidos.
- En la tabla general, la columna **Jornadas** dice cuántas semanas lleva ganadas
  cada quien.

### Confirmar

Elegir no basta. **Un partido sin confirmar no cuenta puntos**, aunque le
atines. Confirmar es irreversible: es la firma del jugador sobre ese partido.
Se puede confirmar uno por uno o todos los pendientes de la semana de un golpe.

---

## Cómo se ve

La pantalla del jugador está armada como un tablero de casa de apuestas, no
como una galería de tarjetas:

- **Columna izquierda:** cuánto llevas depositado y la lista de las 18 jornadas,
  cada una con su estado (abierta, cuántas firmaste, o *pagar*).
- **Centro:** el partido 1 de la jornada arriba, con la foto de su estadio,
  porque es el que más paga. Debajo, un renglón por partido con las tres
  opciones en columnas —**Visita · Empate · Local**— y el puntaje de cada una
  dentro del botón. Renglones apretados: caben doce partidos sin hacer scroll.
- **Columna derecha, el cupón:** conforme picas opciones se te van juntando ahí,
  con la suma de lo que llevarías si le atinas a todo. Un solo botón las firma
  todas. En pantallas angostas el cupón se convierte en una barra fija abajo.

Un solo color manda —lima eléctrico— para lo que eliges y para los botones de
acción. El verde aparece solo cuando algo ya quedó firmado, el ámbar cuando
falta pagar y el rojo cuando algo está cerrado.

---

## El panel de administración

**Pagos.** Arriba, el tablero de **quién ya pagó**: cada jugador es un renglón y
cada semana de cobro una casilla. Llega el depósito, picas la casilla y al
jugador se le abren los partidos de esa semana al momento. Picar una casilla
adelantada (la 7, digamos) cobra de un golpe lo que le falte para llegar ahí.
Para deshacer, se pica la última verde.

Abajo, el detalle por jugador: nombre, correo, teléfono, cuánto lleva, qué
semanas trae abiertas y cuántos partidos confirmó, con botón de `+ $100`,
"Otro monto" para lo demás, y cada movimiento con su fecha y su nota.

**Contraseña nueva.** No hay correo de recuperación: si a alguien se le olvida
la suya, se la cambias desde su ficha y se la pasas. Al hacerlo se le cierran
todas las sesiones que tuviera abiertas, así que si alguien más andaba metido en
esa cuenta, queda fuera en el momento.

La que tú pongas queda marcada como **temporal**: la próxima vez que ese jugador
entre, le sale un diálogo que no se puede cerrar pidiéndole que ponga la suya.
Hasta que no lo haga no puede hacer nada más. Así tú nunca te quedas sabiendo la
contraseña de nadie — solo la de emergencia, que deja de servir en cuanto la
cambian. En la lista de jugadores se ve quién sigue con una temporal pendiente.

Cada jugador también puede cambiarla cuando quiera desde **Mi cuenta**, dando su
contraseña de ese momento.

También se puede **eliminar** a un jugador —el que se registró dos veces, el que
ya no va a jugar— con todo lo suyo: pagos y picks. Pide escribir su nombre
completo, porque no se puede deshacer.

**Puntos por partido.** Semana por semana, con el lugar que ocupa cada partido,
lo que paga y lo que pagaría el empate. **No hay que capturar nada:** el puntaje
sale solo. Sirve para revisarlo, para corregir algo puntual y para devolver toda
la semana al automático de un botón. Lo que esté ajustado a mano se ve en ámbar.

**Quién eligió qué.** La cuadrícula de toda la semana: cada jugador contra cada
partido. Los que se ven tenues están elegidos pero **sin confirmar**.

**Actualizar resultados desde ESPN.** Baja los marcadores finales y recalcula la
tabla general. Solo cuenta partidos que ESPN ya marcó como terminados, para que
la tabla no se mueva a media tarde.

---

## Los archivos

```
servidor.js                 El servidor. Rutas, archivos estáticos y freno a
                            los intentos de contraseña.
lib/
  reglas.js                 El corazón: candados, pagos y puntos. Funciones
                            puras que reciben la hora como argumento.
  almacen.js                La base de datos. Escribe de forma atómica.
  api.js                    Endpoints del jugador.
  admin.js                  Endpoints del administrador.
  configuracion.js          Lo editable, en datos/configuracion.json.
datos/
  calendario.json           Los 272 partidos con su hora en UTC. Fuente única
                            de verdad de horarios.
  configuracion.json        Contraseña del panel, cuota, lo que paga el primer
                            partido, dónde arranca la escalera y el margen de
                            cierre. Se crea solo.
  quiniela.json             Jugadores, pagos, picks y sesiones. Se crea solo.
  resultados.json           Marcadores finales. Se crea al actualizar.
publico/
  index.html                La pantalla del jugador.
  admin.html                El panel de administración.
  css/estilos.css           Todo el diseño.
  js/app.js · js/admin.js   Las dos pantallas.
  js/dialogo.js             Los diálogos de confirmar, propios en lugar de
                            los del navegador.
  img/equipos/              Los 32 escudos.
  img/estadios/             La foto de cada estadio.
ensayo.js                   Modo ensayo: una jornada de mentiras en la fecha
                            que quieras. Ver más abajo.
herramientas/
  actualizar-calendario.js  Rebaja el calendario, los escudos y las fotos de
                            los estadios desde ESPN.
  aligerar-fotos.ps1        Reduce esas fotos de 44 MB a 3.5 MB.
  barrido-temporada.js      Revisa las 18 semanas en cinco momentos cada una.
  prueba-de-punta-a-punta.js
pruebas.js                  Pruebas de las reglas.
lib/reloj.js                El reloj del sistema. Normalmente la hora de verdad;
                            en modo ensayo, la que se le pida.
```

### Qué se guarda de cada quien

`datos/quiniela.json` es toda la memoria de la quiniela:

- **Jugadores:** nombre completo, correo, teléfono, fecha de alta y la
  contraseña como hash scrypt con su sal. Nunca en claro.
- **Pagos:** cada depósito con su monto, fecha, nota y cuándo se registró.
- **Picks:** por jugador y por partido, qué eligió, si ya lo confirmó y a qué
  hora. Un pick confirmado queda ahí para siempre.

Los **puntos no se guardan como número**: se calculan cada vez a partir del pick
confirmado, el marcador final y lo que vale ese partido. Es a propósito — si
corriges un marcador o ajustas un puntaje, la tabla se recalcula sola y no queda
un total viejo colgado por ahí.

Los marcadores viven aparte, en `datos/resultados.json`, y solo cuentan cuando
ESPN marca el partido como terminado.

**El respaldo es un solo archivo:** copia `datos/quiniela.json` y ya tienes todo.

---

## Pruebas

```bash
node --test pruebas.js
```

34 pruebas de las reglas: los dos candados de horario, la regla de oro con
relojes simulados, los pagos parciales y adelantados, el corte de la semana 16,
la escalera de puntos (25, 10, 11, 12…) y que se reinicie cada semana, el empate
al doble, que un pick sin confirmar no pague, que la semana corra de jueves a
miércoles, que ningún partido se salga de su ventana, **la cuenta completa de
una semana** (picks + marcadores → puntos de cada quien) contra números sacados
a mano, y que las jornadas jueves-martes coincidan con las semanas del
calendario.

Con el servidor corriendo, la prueba del camino completo:

```bash
node herramientas/prueba-de-punta-a-punta.js
```

Registro, validaciones, candado por falta de pago, el tablero de quién ya pagó
(marcar, adelantar, desmarcar), elegir, confirmar, el rechazo de lo ya
confirmado, el cambio de contraseña (que la vieja deje de servir y que se cierre
la sesión abierta) y los permisos de las sesiones. La prueba borra sus propias
cuentas al terminar, así que no deja basura.

---

## Modo ensayo · probar una jornada antes de que llegue

Esto es lo que hay que usar **antes de abrirla al grupo**. Monta una quiniela
completa de mentiras —jugadores, pagos, picks y marcadores— y pone el reloj del
sistema en el momento que le pidas. Abres el navegador y todo se comporta como
si de verdad fuera ese día.

```bash
node ensayo.js --semana 8 --momento cerrada
```

Se abre en <http://localhost:4500> con una **cinta ámbar** arriba que no deja
confundirlo con la quiniela de verdad.

| Momento | Dónde te para |
|---|---|
| `abierta` *(por omisión)* | Dos días antes del primer partido: todo se puede elegir |
| `porcerrar` | 15 minutos antes del cierre, con la cuenta regresiva en rojo |
| `cerrada` | 5 minutos después del cierre, antes del primer silbatazo |
| `enmedio` | Con el partido del jueves ya jugado y el resto por jugarse |
| `terminada` | La jornada completa, con todos sus marcadores |

> **Cuidado con las contraseñas.** Tu correo existe en los dos lados con
> contraseñas distintas: en el ensayo es `ensayo123`, en la quiniela de verdad
> es la que tú elegiste. Si te equivocas, el ensayo te lo dice en el mensaje de
> error; la quiniela real no da pistas, a propósito.

El ensayo **copia los nombres y correos de la quiniela de verdad** (nada más
eso: nunca lee contraseñas, pagos ni picks, y jamás escribe en los datos
reales), así lo revisas con la lista de gente que ya conoces. Todos entran con
la contraseña `ensayo123`. El primero de la lista le atina a 8 de cada 10, para
tener puntos altos que revisar desde el principio.

Si hay pocos registrados, completa hasta seis con jugadores inventados: uno de
ellos va atrasado en pagos y otro nunca depositó, para ver los candados en
acción. La contraseña del panel se imprime al arrancar.

**Nunca toca los datos de verdad.** El ensayo vive en `ensayo/`, que se borra y
se rehace en cada corrida, y corre en otro puerto. Puedes tenerlo prendido al
mismo tiempo que la quiniela normal.

Los marcadores del ensayo son inventados, pero siempre los mismos: se calculan a
partir del id de cada partido, así que dos corridas seguidas dan resultados
idénticos y se pueden comparar.

Para ver el resumen sin abrir el servidor:

```bash
node ensayo.js --semana 12 --momento terminada --revisar
```

### El barrido de la temporada completa

```bash
node herramientas/barrido-temporada.js
```

Recorre **las 18 semanas en los cinco momentos** —90 escenarios, más de 6,500
verificaciones— y comprueba en cada uno que ningún partido iniciado quede
editable, que la semana cierre completa, que el candado del dinero aguante con
tres perfiles de pago distintos y que la escalera de puntos no tenga huecos ni
repetidos. Corre en segundos y no necesita servidor.

Es la revisión que conviene pasar antes de publicar, y cada vez que se
actualice el calendario.

---

## Actualizar el calendario

```bash
node herramientas/actualizar-calendario.js
```

Vuelve a bajar las 18 semanas desde la API pública de ESPN y reescribe
`datos/calendario.json`. Los ids de partido son los de ESPN y no cambian, así que
los picks ya capturados siguen amarrados a su partido aunque se mueva un horario.

Para otra temporada:

```bash
node herramientas/actualizar-calendario.js --temporada 2027
```

Baja también los escudos y la foto de cada estadio. ESPN las entrega en 2000 px
(44 MB entre todas), así que después conviene correr:

```bash
powershell -File herramientas/aligerar-fotos.ps1
```

Ocho sedes no tienen foto en ESPN: las siete internacionales (Melbourne, Río,
Londres, París, Madrid, Múnich, Ciudad de México) y el estadio nuevo de Buffalo.
Esos partidos usan de fondo un degradado con los colores reales de los dos
equipos, con rayas de yarda encima.

---

## Publicar en internet · Render

El repo esta en **github.com/JosedeJesus270205/quiniela-nfl-2026** (privado).

La quiniela necesita tres cosas que un hosting de solo archivos (Netlify,
GitHub Pages) no da:

1. **Un proceso de Node vivo.** El reloj del servidor es el que decide si un
   partido ya cerro. Sin proceso no hay candados.
2. **Un disco que sobreviva a los despliegues.** Jugadores, pagos y picks viven
   en `quiniela.json`. Si el disco se borra al reiniciar, se pierde todo.
3. **HTTPS**, porque van contrasenas. Render lo pone solo.

> El plan **gratis de Render no sirve** para esto: se duerme cuando nadie entra
> y borra el disco en cada reinicio, o sea que se perderian los picks. El plan
> **Starter** (~7 USD al mes) es el minimo que admite disco de verdad. El
> `render.yaml` de este repo ya esta configurado para ese plan.

### Los ocho pasos

1. Entra a **render.com** y crea una cuenta con el mismo GitHub.
2. **New → Blueprint.**
3. Elige el repositorio `quiniela-nfl-2026`. Render encuentra `render.yaml` solo
   y arma el servicio con todo: plan, disco, variables y prueba de pulso.
4. Te va a pedir un valor para **`QUINIELA_ADMIN`**: ahi escribes la contrasena
   del panel de administracion. Que sea larga y que no se parezca a ninguna otra
   que uses. No se guarda en el repo ni en el disco ni en los registros: vive
   solo en la configuracion de Render.
5. **Apply.** El primer despliegue tarda un par de minutos.
6. Cuando termine te da una direccion tipo
   `https://quiniela-nfl.onrender.com`. Esa es la que se le pasa al grupo.
7. Entra tu primero a `/admin` con la contrasena del paso 4 y comprueba que
   abre.
8. Ya que cada quien se registre, les vas marcando los pagos en el tablero.

### Que hacer despues de cada cambio

`git push` y ya. Render vuelve a desplegar solo. **Los datos no se tocan**: el
disco esta montado aparte del codigo.

Antes de publicar, el despliegue corre las pruebas (`buildCommand`). Si alguna
falla, Render cancela y se queda con la version anterior corriendo.

### Las variables de entorno

| Variable | Para que |
|---|---|
| `QUINIELA_ADMIN` | La contrasena del panel. La pide Render al crear el servicio |
| `QUINIELA_DATOS` | La carpeta de los datos. Apunta al disco: `/var/datos` |
| `PORT` | Lo pone Render solo. El servidor lo respeta |

El calendario se busca primero en `QUINIELA_DATOS` y, si no esta ahi, en la
carpeta `datos/` del proyecto — que es lo que pasa al publicar, porque el
calendario viaja con el codigo y los datos van en otro disco.

### Respaldos

`datos/quiniela.json` es toda la memoria de la quiniela. En Render vive en
`/var/datos/quiniela.json`. Conviene bajarlo de vez en cuando desde el shell del
servicio, sobre todo al terminar cada jornada.

### Actualizar el calendario ya publicado

Cuando la NFL defina los horarios que faltan (los 24 de las semanas 16 a 18):

```bash
node herramientas/actualizar-calendario.js
powershell -File herramientas/aligerar-fotos.ps1
git add datos/calendario.json publico/img
git commit -m "Horarios nuevos de la NFL"
git push
```

Render redespliega solo y los candados se recalculan con las horas nuevas.
