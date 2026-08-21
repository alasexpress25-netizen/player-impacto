# Actualización: Sistema de Video Prioritario (Filmación + Overlay + Publicación instantánea)

**Fecha:** 13/08/2026 (actualizado el mismo día — corrección de proporción del compuesto)
**Estado:** Propuesta — pendiente de confirmación de puntos marcados con ⚠️ antes de implementar
**Repos involucrados:** `alasexpress25-netizen/social-bot-agency` (o repo donde viva el admin DS Player) + Supabase `sdfwredxmyawvolxuifp`

---

## 1. Objetivo

Agregar al admin (`Pantallas Admin`) un flujo completo para:

1. Filmar contenido puntual (ej. partido de fútbol en un club cliente).
2. Subirlo a R2, en la misma carpeta donde ya se guardan los videos filmados.
3. Componer automáticamente un único video final: el material filmado + el fondo/overlay de una playlist existente (efecto tipo "noticiero" — publicidad + recuadro con el video nuevo, quemado en un solo MP4).
4. Publicarlo de forma instantánea en una pantalla específica, **reemplazando temporalmente** la playlist que está corriendo.
5. Poder revertir con un clic y volver a la playlist original, sin perder cuál era.

Todo esto **sin tocar** el modelo de reproducción actual del APK (sigue reproduciendo un solo archivo/playlist por vez, como hoy) — el "efecto especial" se resuelve 100% en el procesamiento previo, no en el TV.

---

## 2. Nuevo ítem de menú: "Video Prioritario"

Se agrega un botón nuevo en el margen lateral izquierdo del admin, entre **Media** y **Alertas** (o donde mejor visualmente encaje con los íconos existentes — line-icon estilo outline, consistente con "Pantallas" 🖥, "Media" ▶, "Alertas" 🔔).

**Ícono propuesto:** un ícono outline compuesto — combinación de "cámara" + "rayo" (⚡) para transmitir "filmación + publicación urgente/prioritaria". Se entrega como SVG inline (mismo patrón que los íconos existentes del sidebar) para mantener consistencia visual con la paleta dark/gold (`#C9A244`).

**Label:** `Video Prioritario`

---

## 3. Flujo dentro de la nueva sección

### Paso 1 — Subida del material filmado
- Selector de archivo(s) de video (uno o varios clips).
- Se suben a R2, en la **misma carpeta** donde ya se depositan los videos filmados (reutiliza el bucket/prefijo actual — no se crea carpeta nueva salvo que prefieras separarlas por fecha/evento, ej. `filmaciones/2026-08-13_club-futbol/`).
- Barra de progreso de subida (igual criterio que "Media", que ya soporta carga resumible para archivos grandes).

### Paso 2 — Selección de la playlist de fondo/overlay
- Dropdown con las playlists existentes (mismo listado que usa `05-playlists.js`).
- **✅ Confirmado:** el fondo se arma leyendo los `playlist_items` de la playlist elegida **en el mismo orden (`orden`) en que están cargados hoy**, y concatenándolos tal cual (mismo orden que reproduciría el TV normalmente).
- **✅ Confirmado (corregido) — proporción del compuesto: el video filmado es el protagonista, no la publicidad.**
  - El video filmado ocupa **toda la pantalla**, en su proporción nativa (sin recortes ni deformación) — es el foco visual, pensado para generar interés genuino (ej. el partido).
  - La publicidad va como **recuadro PIP superpuesto**, ocupando **~30% del ancho de pantalla** (alto proporcional, manteniendo su propio aspect ratio 16:9, sin deformar).
  - **Se descartó el split real de pantalla** (`hstack`/`vstack` 70/30) por un problema técnico: los videos de origen son 16:9, y un split literal de áreas deja cada bloque con un aspect ratio no estándar, obligando a meter letterboxing (barras negras) dentro de cada mitad — la publicidad terminaría reducida a una franja negra con un video ilegible adentro. El PIP (filtro `overlay` de FFmpeg) evita esto: cada fuente mantiene su proporción real.
  - **Criterio de por qué 30% alcanza aunque el texto de la publicidad no se llegue a leer:** el PIP existe por una razón contractual (que la rotación de cada anunciante se haya "pasado" en pantalla dentro del tiempo que dura el video filmado), no por audiencia — en esos segundos el protagonismo es del contenido filmado. No hace falta subir el tamaño del recuadro por legibilidad.
  - **Loop del fondo:** si la duración concatenada de la playlist de fondo es menor a la duración del video filmado, la concatenación de publicidad debe **loopearse** hasta cubrir toda la duración del filmado (nunca cortar a la mitad ni dejar pantalla en negro el resto) — así se garantiza que la rotación completa de anunciantes se cumplió, sin importar cuánto dure la filmación. Implementación: `-stream_loop` sobre el input concatenado de fondo, o loop vía `concat` demuxer.
  - **Posición del recuadro PIP:** default = **esquina inferior derecha** (convención más usada en este tipo de composición, y suele chocar menos con textos/logos que ya tenga el video filmado en otras esquinas). Confirmar si se prefiere otra esquina.
- El script de composición (paso 3) primero **lee la playlist desde Supabase** (`playlist_items` ordenados) antes de armar el comando de FFmpeg, para asegurar que el orden de concatenación coincida exactamente con el de la playlist real.

### Paso 3 — Composición (procesamiento en la nube)
- Botón **"🎬 Generar video compuesto"**.
- Dispara un **GitHub Actions workflow** (ver sección 5) que:
  1. Descarga de R2 los clips filmados + los archivos de la playlist elegida.
  2. Concatena los videos de la playlist de fondo (si son varios) en un solo stream, igual que lo haría la reproducción normal.
  3. Aplica overlay (FFmpeg `overlay` filter) con el video filmado como PIP — posición, tamaño y texto configurables por parámetro.
  4. Quema el texto (si se define uno, ej. nombre del cliente/evento).
  5. Sube el resultado final a R2, en la misma carpeta de videos filmados, con nombre identificable (ej. `COMPUESTO_2026-08-13_club-futbol.mp4`).
  6. Actualiza una tabla en Supabase (`video_prioritario_jobs`) con estado: `procesando` → `listo` / `error`.
- El admin hace polling (cada 5-10s) contra esa tabla y muestra el estado ("Procesando... ⏳" → "✅ Listo para publicar").

### Paso 4 — Selección de pantalla y publicación
- Una vez listo el video compuesto, aparece el selector de pantalla (mismo listado que usa `02-pantallas.js`).
- Dos botones:

  **🟢 Publicar**
  1. Lee el `playlist_id` **actual** de la pantalla elegida (y de paso su nombre, para mostrarlo en la UI — ej. "se va a restaurar: Publicidad La Visual MK").
  2. **✅ Confirmado:** se guarda en **Supabase** (es un dato chico — solo `screen_id` + `playlist_id` + nombre de playlist — no hay motivo de peso para no hacerlo ahí). Así el backup es accesible desde cualquier dispositivo: publicás desde el celular en el club, y podés revertir después desde la notebook en casa sin depender de que sea el mismo navegador.
  3. Crea (o reutiliza) una playlist "técnica" de un solo ítem con el video compuesto, y actualiza `screens.playlist_id` de esa pantalla a esa playlist.
  4. El APK detecta el cambio por heartbeat (como ya sucede hoy) y arranca a reproducir el nuevo video — sin reiniciar el TV.

  **🔴 Revertir a playlist original**
  1. Lee `playlist_id_original` guardado para esa pantalla.
  2. Restaura `screens.playlist_id` a ese valor.
  3. Limpia el registro de "backup" para esa pantalla (ya no hay nada pendiente de revertir).
  4. Vuelve la publicidad de siempre, sin intervención manual adicional.

- Estado visual claro en la UI: si una pantalla tiene un video prioritario activo, mostrar un indicador (ej. badge "🟠 Video prioritario activo" en la tarjeta de esa pantalla en la sección Pantallas), para que no se te olvide cuál tenés pendiente de revertir.

---

## 4. Modelo de datos nuevo (Supabase, proyecto `sdfwredxmyawvolxuifp`)

**Tabla nueva: `video_prioritario_jobs`**

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid, PK | |
| `cliente_id` | uuid, FK | opcional, para asociar a un cliente |
| `archivos_filmados` | jsonb | rutas R2 de los clips subidos |
| `playlist_fondo_id` | uuid, FK → playlists | la elegida en el paso 2 — de ahí se leen los `playlist_items` en orden para el fondo |
| `texto_overlay` | text | opcional |
| `estado` | text | `procesando` / `listo` / `error` |
| `video_final_url` | text | URL R2 del resultado |
| `screen_id` | uuid, FK → screens | pantalla donde se publicó (nullable hasta publicar) |
| `playlist_id_original` | uuid, nullable | backup para poder revertir |
| `publicado_en` | timestamptz, nullable | |
| `created_at` | timestamptz | |

Migración nueva a agregar al repo (según convención existente, próximo número disponible tras `0042`).

---

## 5. Procesamiento: GitHub Actions (recomendado sobre Supabase Edge Function)

**Por qué GitHub Actions y no Edge Function:**
- Supabase Edge Functions (Deno Deploy) tienen límite de tiempo de ejecución corto y no traen FFmpeg nativo instalado — requeriría FFmpeg WASM, mucho más lento/inestable para archivos de varios MB y minutos de duración como los tuyos.
- GitHub Actions permite `apt-get install ffmpeg` real, corre sin apuro (hasta 6 horas si hiciera falta), y ya es parte de tu stack (workflows existentes en `social-bot-agency`).
- No es tiempo real de todas formas (subís → procesás → publicás), así que los ~30-60s extra de arranque del runner no son un problema práctico.

**Disparo:** el admin llama a un endpoint (Supabase Edge Function liviana, solo para autenticar y disparar) que ejecuta `workflow_dispatch` sobre un nuevo workflow, ej. `.github/workflows/video-prioritario.yml`, pasándole el `job_id` de `video_prioritario_jobs`.

**El workflow:**
1. Checkout + instala FFmpeg.
2. Descarga desde R2 los archivos indicados en el job.
3. Corre el comando FFmpeg de concatenación + overlay + texto.
4. Sube el resultado a R2.
5. Hace un `PATCH` a Supabase actualizando `estado = 'listo'` y `video_final_url`.
6. Si falla algo, `estado = 'error'` con detalle en un campo `error_detail`.

---

## 6. Qué NO cambia (para tu tranquilidad)

- El APK (`MainActivity.kt`) **no se toca**. Sigue reproduciendo un solo stream vía ExoPlayer como hoy — el video prioritario llega como un MP4 normal más, indistinguible de cualquier otro.
- El modelo de playlists/pantallas existente no se altera — solo se agregan una tabla y (opcional) una columna de backup.
- La publicidad original nunca se borra ni se sobreescribe — solo se "pausa" cambiando qué playlist está asignada a la pantalla, y se restaura con un clic.
- Nada de esto afecta a pantallas donde no uses esta función — comportamiento 100% opt-in por pantalla/evento.

---

## 7. Puntos a confirmar antes de implementar ⚠️

1. ~~Qué va de fondo y qué va en el recuadro PIP~~ — ✅ Confirmado (corregido): el video filmado ocupa toda la pantalla (protagonista), la publicidad va como PIP ~30% del ancho, esquina inferior derecha por default.
2. ~~Dónde se guarda el backup de la playlist original~~ — ✅ Confirmado: Supabase.
3. **Carpeta en R2**: ¿reutilizar la carpeta actual de videos filmados tal cual, o crear subcarpetas por fecha/evento dentro de ella (ej. `filmaciones/2026-08-13_club-futbol/`) para mantener orden?
4. **Nombre y posición exacta del ícono nuevo** en el sidebar (¿entre Media y Alertas está bien, o preferís otro lugar?).
5. **Posición del recuadro PIP**: se dejó esquina inferior derecha como default — confirmar si se prefiere otra esquina.

---

## 8. Próximos pasos una vez confirmado

1. Crear migración Supabase para `video_prioritario_jobs` (+ columna backup si aplica).
2. Crear workflow de GitHub Actions `video-prioritario.yml`.
3. Crear Edge Function liviana de disparo (`trigger-video-prioritario`).
4. Agregar sección nueva al admin: ícono sidebar + `js/11-video-prioritario.js` (siguiendo la numeración de módulos ya existente) + estilos en `css/admin.css`.
5. Agregar badge de estado "video prioritario activo" en las tarjetas de `02-pantallas.js`.

---

## 9. Contexto de la sesión (para retomar en otra conversación)

Esta funcionalidad surgió de una charla que arrancó con una idea distinta y fue derivando hasta esto. Resumen del hilo completo, por si se retoma desde otra sesión sin este historial:

**Punto de partida:** Laís quería un split-screen en vivo en el TV (tipo noticiero: publicidad de fondo + recuadro con video nuevo), pensado primero para el caso de uso de un **club de fútbol cliente** — filmar los partidos que la gente juega ahí y mostrarlos en la pantalla, para generar interés genuino en la gente del lugar y así vender más publicidad en ese punto.

**Por qué se descartó el split en tiempo real en el TV:** el hardware es muy limitado — TV Android estándar con **8GB de almacenamiento y 1GB de RAM**, firmware Hisilicon (board P75-352V6.2). Dos instancias de `ExoPlayer` corriendo en simultáneo muy probablemente saturarían el decoder de hardware (la mayoría de estos SoCs baratos tienen un solo decoder de video por hardware), generando freezes — el mismo tipo de inestabilidad que ya está peleando con el firmware. Se descartó por riesgo.

**Solución elegida:** en vez de split en vivo, **renderizar el efecto de antemano** y subir un solo MP4 ya compuesto (fondo + PIP + texto quemado) — así el TV reproduce un archivo normal, sin sobrecarga, con un solo `ExoPlayer` como ya funciona hoy.

**Evolución de "cómo generar ese video compuesto":**
1. Primero se habló de editarlo a mano en la notebook (CapCut, DaVinci, OBS).
2. Laís preguntó si existe una herramienta para automatizar: tomar una lista de videos (como una playlist) y unirlos en uno solo, quemando el efecto tipo la imagen de referencia (fondo + recuadro cámara + texto "Seus clientes estão online."). Respuesta: **FFmpeg** (concatenar + overlay + texto quemado, todo en un comando/script).
3. De ahí surgió el pedido concreto que terminó en este documento: automatizar todo el flujo **dentro del admin** (Pantallas Admin), no como script suelto en la notebook.

**Decisión de arquitectura para el procesamiento (FFmpeg):** se evaluó Supabase Edge Function vs GitHub Actions. Se eligió **GitHub Actions** porque Edge Functions (Deno Deploy) tienen límites de tiempo de ejecución cortos y no traen FFmpeg nativo (solo WASM, lento/inestable para videos reales). GitHub Actions permite instalar FFmpeg real vía `apt-get`, corre sin apuro, y ya es parte del stack existente de Laís (usa GitHub Actions en `social-bot-agency`).

**Decisiones ya confirmadas por Laís (no volver a preguntar):**
- El fondo del video compuesto = los videos de la **playlist elegida por el usuario, leídos en el mismo orden (`orden`) que tienen hoy en `playlist_items`**, concatenados tal cual. El video filmado nuevo va en el recuadro PIP encima.
- El backup de "qué playlist estaba corriendo antes" para poder revertir se guarda en **Supabase** (no en `localStorage`), justamente para poder publicar desde un dispositivo (ej. celular en el club) y revertir después desde otro (notebook en casa).
- El repo del admin ya usa R2 activamente (se ve en la captura de la sección "Media": subida directa a R2, botón "Sincronizar R2", 15 archivos en biblioteca ya organizados por cliente — Alas Tecno, Impacto Tv dooh, La Visual Marketing).

**Pendiente de confirmar (aún abierto):**
- Punto 3: ¿carpeta R2 plana (reutilizar la carpeta de filmaciones tal cual) o subcarpetas por fecha/evento?
- Punto 4: posición exacta del ícono nuevo en el sidebar del admin (propuesta: entre "Media" y "Alertas").

**Próximo paso cuando se retome:** una vez cerrados los puntos 3 y 4, arrancar con la implementación en el orden de la sección 8 (migración Supabase → workflow GitHub Actions → Edge Function de disparo → UI del admin → badge en pantallas).

**Nota sobre el ecosistema para no perder contexto técnico:** este admin es el de **DS Player / ImpactoTV** (Supabase project `sdfwredxmyawvolxuifp`), distinto del proyecto `redaqqxoeciycqgjhpbv` de `social-bot-agency` — son dos plataformas separadas de Laís, no confundir migraciones/tablas entre ambos al retomar.

