// ════════════════════════════════════════════════════════════════
//  VIDEO PRIORITARIO — filmación puntual + overlay + publicación
//  instantánea en una pantalla. Ver ACTUALIZACION-VIDEO-PRIORITARIO.md
//
//  [x] Paso 1: subida de clips filmados a R2
//  [x] Paso 2: selección de playlist de fondo + texto overlay
//  [x] Paso 3: creación del job + disparo del workflow + polling
//  [x] Paso 4: publicar / revertir en pantalla
// ════════════════════════════════════════════════════════════════

let vpClips = []; // clips filmados ya subidos a R2 en esta sesión, EN ORDEN: {nombre, url, size}
let vpPlaylists = []; // playlists disponibles para elegir como fondo (Paso 2)
let vpScreens = []; // pantallas disponibles para publicar (Paso 4)

// En conexiones móviles débiles (4G con poca señal) una consulta puede
// quedarse "colgada" sin resolver nunca ni el .then ni el .catch, dejando
// el spinner infinito. Esto envuelve cualquier promesa de supabase con un
// límite de tiempo: si no responde en `ms`, se corta con un error legible
// en vez de dejar la UI trabada para siempre.
function vpWithTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('La conexión está muy lenta o se cortó. Revisá tu señal/wifi y reintentá.')), ms)
    )
  ]);
}

async function loadVideoPrioritario() {
  vpStopPolling(); // por si se navegó fuera de la sección con un polling activo
  renderVpClipsList();
  await vpLoadPlaylists();
  vpUpdateGenerarState();
  vpSetJobStatus('');

  // El paso 4 se vuelve a mostrar automáticamente cuando un job termine
  // 'listo' en esta sesión (vpRevealStep4); al reentrar a la sección
  // arranca oculto hasta ese momento.
  const step4 = document.getElementById('vp-step-4');
  if (step4) step4.style.display = 'none';

  const scSel = document.getElementById('vp-screen-select');
  if (scSel) scSel.innerHTML = '<option value="">(elegí primero un video listo)</option>';

  await vpLoadJobsRecientes();
}

// ════════════════════════════════════════════════════════════════
//  PASO 2 — SELECCIÓN DE PLAYLIST DE FONDO/PUBLICIDAD
//  Mismo patrón de consulta que loadPlaylists() en 05-playlists.js
//  (solo playlists activas). El orden de concatenación del fondo lo
//  define `orden` en playlist_items — eso se lee recién en el Paso 3,
//  al armar el job, para asegurar que coincida con la playlist real
//  en el momento de generar (no acá).
// ════════════════════════════════════════════════════════════════
async function vpLoadPlaylists() {
  const plSel = document.getElementById('vp-playlist-select');
  if (!plSel) return;

  plSel.innerHTML = '<option value="">Cargando playlists...</option>';

  let data, error;
  try {
    ({ data, error } = await vpWithTimeout(
      sb.from('playlists')
        .select('id, nombre, playlist_items(count)')
        .eq('activa', true)
        .order('nombre')
    ));
  } catch (timeoutErr) {
    plSel.innerHTML = '<option value="">⚠️ Sin respuesta — tocá para reintentar</option>';
    plSel.onclick = () => { plSel.onclick = null; vpLoadPlaylists(); };
    toast(timeoutErr.message, 'error');
    return;
  }

  if (error) {
    plSel.innerHTML = '<option value="">Error al cargar playlists</option>';
    toast('Error cargando playlists: ' + error.message, 'error');
    return;
  }

  vpPlaylists = data || [];

  if (!vpPlaylists.length) {
    plSel.innerHTML = '<option value="">Sin playlists disponibles</option>';
    return;
  }

  plSel.innerHTML = '<option value="">Elegí una playlist...</option>' +
    vpPlaylists.map(pl => {
      const count = pl.playlist_items?.[0]?.count ?? 0;
      return `<option value="${pl.id}">${esc(pl.nombre)} (${count} ítems)</option>`;
    }).join('');

  plSel.onchange = vpUpdateGenerarState;
}

// ════════════════════════════════════════════════════════════════
//  PASO 1 — SUBIDA DE CLIPS FILMADOS A R2
//  Mismo patrón que uploadMedia() en 04-media.js (presign + PUT
//  directo a R2), pero sin tocar la tabla `media`: los clips viven
//  solo en vpClips[] hasta que se genere el job (Paso 3), que es
//  cuando se guardan las rutas finales en video_prioritario_jobs.
//  Carpeta: prefijo plano "filmaciones/" (sin subcarpeta por fecha/
//  evento — no hay campo de evento en el UI actual; punto 3 del doc).
// ════════════════════════════════════════════════════════════════
function vpHandleDragOver(e) { e.preventDefault(); document.getElementById('vp-upload-zone')?.classList.add('drag-over'); }
function vpHandleDragLeave(e) { document.getElementById('vp-upload-zone')?.classList.remove('drag-over'); }
function vpHandleDrop(e) {
  e.preventDefault();
  document.getElementById('vp-upload-zone')?.classList.remove('drag-over');
  vpHandleFileSelect(e.dataTransfer.files);
}

async function vpHandleFileSelect(files) {
  if (!files?.length) return;
  const arr = Array.from(files).filter(f => f.type.startsWith('video/'));
  if (!arr.length) { toast('Elegí archivos de video', 'error'); return; }

  // Secuencial (no concurrente): el orden de subida define el orden de
  // concatenación en el compuesto final, así que no conviene paralelizar.
  for (const file of arr) {
    await vpUploadClip(file);
  }

  const fi = document.getElementById('vp-clips-input');
  if (fi) fi.value = '';
}

async function vpUploadClip(file) {
  const progressArea = document.getElementById('vp-upload-progress-area');
  const progressId   = 'vp-prog-' + Date.now() + '-' + Math.round(Math.random() * 1000);
  const shortName    = file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name;

  progressArea.insertAdjacentHTML('beforeend', `
    <div class="progress-wrap" id="${progressId}">
      <div class="progress-label">
        <span>${esc(shortName)}</span>
        <span id="${progressId}-pct">0%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="${progressId}-fill" style="width:0%"></div></div>
    </div>`);

  const setProgress = (pct) => {
    const fill = document.getElementById(progressId + '-fill');
    const pctEl = document.getElementById(progressId + '-pct');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  };

  try {
    setProgress(5);

    const r2Filename = `filmaciones/${Date.now()}_${file.name}`;

    // 1) Pedir URL prefirmada de R2 para este clip
    const presignRes = await fetch(R2_MEDIA_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Token': R2_UPLOAD_TOKEN },
      body: JSON.stringify({ action: 'presign-upload', filename: r2Filename, size: file.size })
    });
    const presignData = await presignRes.json();
    if (presignData.error) throw new Error(presignData.error);

    setProgress(10);

    // 2) Subir directo a R2 con el PUT prefirmado
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignData.uploadUrl, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 85) + 10;
        setProgress(pct);
      }
    };

    const uploadPromise = new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Error subiendo a R2 (HTTP ${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Error de red al subir a R2'));
    });

    xhr.send(file);
    await uploadPromise;

    setProgress(100);

    vpClips.push({
      nombre: presignData.filename || r2Filename,
      url:    presignData.publicUrl,
      size:   file.size
    });
    renderVpClipsList();
    vpUpdateGenerarState();

    toast(`"${shortName}" subido ✓`, 'success');
    setTimeout(() => document.getElementById(progressId)?.remove(), 1500);

  } catch (err) {
    const el = document.getElementById(progressId);
    if (el) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:6px 0;">⚠️ Error: ${esc(err.message)}</div>`;
      setTimeout(() => el?.remove(), 4000);
    }
    toast('Error al subir clip: ' + err.message, 'error');
  }
}

function renderVpClipsList() {
  const list = document.getElementById('vp-clips-list');
  if (!list) return;

  if (!vpClips.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = vpClips.map((c, i) => `
    <div class="vp-clip-chip">
      <span style="opacity:.6;font-weight:700;">${i + 1}</span>
      <span class="vp-clip-name" title="${esc(c.nombre)}">${esc(c.nombre)}</span>
      <span style="color:var(--text2);">${formatBytes(c.size || 0)}</span>
      <button class="btn btn-ghost btn-sm" onclick="vpRemoveClip(${i})" title="Quitar">🗑</button>
    </div>`).join('');
}

function vpRemoveClip(index) {
  vpClips.splice(index, 1);
  renderVpClipsList();
  vpUpdateGenerarState();
}

// El botón "Generar" necesita al menos un clip subido Y una playlist
// de fondo elegida (Paso 2). El texto overlay es opcional, no condiciona.
function vpUpdateGenerarState() {
  const btn = document.getElementById('vp-btn-generar');
  if (!btn) return;
  const plSel = document.getElementById('vp-playlist-select');
  const tienePlaylist = !!plSel?.value;
  btn.disabled = !(vpClips.length > 0 && tienePlaylist);
}

// ════════════════════════════════════════════════════════════════
//  PASO 3 — COMPOSICIÓN: crear job + disparar workflow + polling
//  1) Insert en video_prioritario_jobs (estado inicial 'procesando').
//  2) POST a la Edge Function `trigger-video-prioritario` (mismo
//     patrón de auth que callTuyaEdge en 09-energia.js: Bearer del
//     session token del usuario logueado) — esa función liviana solo
//     autentica y dispara el workflow_dispatch de GitHub Actions.
//  3) Polling cada 7s contra la fila del job hasta 'listo' / 'error'.
//  Requiere que ya exista la tabla `video_prioritario_jobs` (sección
//  4 del doc) y la Edge Function `trigger-video-prioritario` (sección
//  5) — si todavía no están creadas en Supabase, este paso va a fallar
//  al insertar o al llamar la función, avisando por toast.
// ════════════════════════════════════════════════════════════════
let vpCurrentJob = null;   // { id, video_final_url } — job activo de esta sesión
let vpPollTimer  = null;

function getVpTriggerEdgeUrl() {
  return (loadConfig()?.supabaseUrl ?? '') + '/functions/v1/trigger-video-prioritario';
}

async function vpGenerar() {
  if (!vpClips.length) { toast('Subí al menos un clip primero', 'error'); return; }

  const plSel = document.getElementById('vp-playlist-select');
  const playlistId = plSel?.value;
  if (!playlistId) { toast('Elegí una playlist de fondo', 'error'); return; }

  const textoOverlay = document.getElementById('vp-texto-overlay')?.value?.trim() || null;

  const btn = document.getElementById('vp-btn-generar');
  const statusEl = document.getElementById('vp-job-status');
  if (btn) btn.disabled = true;
  vpSetJobStatus('<div class="loading-center"><div class="spinner"></div> Creando job...</div>');

  try {
    // 1) Crear el registro del job
    const { data: job, error: insertErr } = await sb
      .from('video_prioritario_jobs')
      .insert({
        archivos_filmados: vpClips,       // jsonb: [{nombre, url, size}, ...] en orden de subida
        playlist_fondo_id: playlistId,
        texto_overlay: textoOverlay,
        estado: 'procesando'
      })
      .select()
      .single();

    if (insertErr) throw new Error('No se pudo crear el job: ' + insertErr.message);

    vpCurrentJob = { id: job.id, video_final_url: null };
    vpSetJobStatus('<div class="loading-center"><div class="spinner"></div> Disparando composición...</div>');

    // 2) Disparar el workflow de GitHub Actions vía Edge Function.
    //    La función NO valida sesión de Supabase: valida el mismo
    //    X-Upload-Token que ya usamos para subir a R2 (ver r2-media /
    //    04-media.js). Antes acá se mandaba solo Authorization Bearer
    //    del usuario, que la función ignora por completo → 401 siempre.
    const res = await fetch(getVpTriggerEdgeUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upload-Token': R2_UPLOAD_TOKEN
      },
      body: JSON.stringify({ job_id: job.id })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    // 3) Arrancar el polling
    vpSetJobStatus('<div class="loading-center"><div class="spinner"></div> Procesando... ⏳ (podés cerrar esta pestaña, seguimos avisando acá al volver)</div>');
    vpStartPolling(job.id);

  } catch (err) {
    vpSetJobStatus(`<div style="color:var(--red);">⚠️ ${esc(err.message)}</div>`);
    toast('Error al generar: ' + err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

function vpSetJobStatus(html) {
  const el = document.getElementById('vp-job-status');
  if (el) el.innerHTML = html;
}

function vpStartPolling(jobId) {
  vpStopPolling();
  vpPollTimer = setInterval(() => vpPollJob(jobId), 7000);
  vpPollJob(jobId); // primer chequeo inmediato
}

function vpStopPolling() {
  if (vpPollTimer) { clearInterval(vpPollTimer); vpPollTimer = null; }
}

async function vpPollJob(jobId) {
  const { data: job, error } = await sb
    .from('video_prioritario_jobs')
    .select('id, estado, video_final_url, error_detail')
    .eq('id', jobId)
    .single();

  if (error) {
    // No corta el polling por un error de red puntual; solo avisa.
    console.warn('vpPollJob: ' + error.message);
    return;
  }

  if (job.estado === 'procesando') return; // sigue esperando, nada que hacer

  vpStopPolling();
  const btn = document.getElementById('vp-btn-generar');
  if (btn) btn.disabled = false;

  if (job.estado === 'listo') {
    vpCurrentJob = { id: job.id, video_final_url: job.video_final_url };
    vpSetJobStatus(`<div style="color:var(--green, #4caf50);">✅ Listo para publicar</div>`);
    toast('Video compuesto listo ✓', 'success');
    vpRevealStep4();
  } else if (job.estado === 'error') {
    vpSetJobStatus(`<div style="color:var(--red);">⚠️ Error al componer: ${esc(job.error_detail || 'sin detalle')}</div>`);
    toast('El job terminó con error', 'error');
  }
}

function vpRevealStep4() {
  const step4 = document.getElementById('vp-step-4');
  if (step4) step4.style.display = '';
  vpLoadScreens();
}

// ════════════════════════════════════════════════════════════════
//  PASO 4 — SELECCIÓN DE PANTALLA Y PUBLICACIÓN
//  Publicar: guarda backup (screen_id + playlist_id_original) en el
//  propio job (Supabase, no localStorage — así se puede revertir desde
//  otro dispositivo), crea/reusa una playlist "técnica" de 1 ítem con
//  el video compuesto, y apunta screens.playlist_id a esa playlist —
//  el APK la toma sola por heartbeat, sin tocar el player.
//  Revertir: restaura screens.playlist_id al valor de backup y marca
//  el job como revertido. La llama tanto el botón de acá como el badge
//  "🟠 Video prioritario activo" de la tarjeta de pantalla en
//  js/02-pantallas.js (mismo flujo, dos entradas).
// ════════════════════════════════════════════════════════════════
async function vpLoadScreens() {
  const scSel = document.getElementById('vp-screen-select');
  if (!scSel) return;

  scSel.innerHTML = '<option value="">Cargando pantallas...</option>';

  let data, error;
  try {
    ({ data, error } = await vpWithTimeout(
      sb.from('screens')
        .select('id, nombre, ciudad')
        .eq('activa', true)
        .order('nombre')
    ));
  } catch (timeoutErr) {
    scSel.innerHTML = '<option value="">⚠️ Sin respuesta — tocá para reintentar</option>';
    scSel.onclick = () => { scSel.onclick = null; vpLoadScreens(); };
    toast(timeoutErr.message, 'error');
    return;
  }

  if (error) {
    scSel.innerHTML = '<option value="">Error al cargar pantallas</option>';
    toast('Error cargando pantallas: ' + error.message, 'error');
    return;
  }

  vpScreens = data || [];

  if (!vpScreens.length) {
    scSel.innerHTML = '<option value="">Sin pantallas registradas</option>';
    return;
  }

  scSel.innerHTML = '<option value="">Elegí una pantalla...</option>' +
    vpScreens.map(sc => {
      const label = sc.nombre || sc.id.slice(0, 8);
      return `<option value="${sc.id}">${esc(label)}${sc.ciudad ? ' — ' + esc(sc.ciudad) : ''}</option>`;
    }).join('');
}

async function vpPublicar() {
  if (!vpCurrentJob?.id || !vpCurrentJob?.video_final_url) {
    toast('No hay ningún video compuesto listo para publicar', 'error');
    return;
  }

  const scSel = document.getElementById('vp-screen-select');
  const screenId = scSel?.value;
  if (!screenId) { toast('Elegí una pantalla', 'error'); return; }

  const screen = vpScreens.find(sc => sc.id === screenId);
  const nombrePantalla = screen?.nombre || screenId.slice(0, 8);

  // 1) Leer la playlist actual de esa pantalla — es lo que se va a
  //    restaurar al revertir, y lo mostramos antes de confirmar.
  const { data: screenRow, error: screenErr } = await sb
    .from('screens')
    .select('playlist_id, playlists:playlist_id(nombre)')
    .eq('id', screenId)
    .single();

  if (screenErr) { toast('Error leyendo la pantalla: ' + screenErr.message, 'error'); return; }

  vpConfirmPublicar(screenId, nombrePantalla, screenRow.playlist_id || null, screenRow.playlists?.nombre || null);
}

function vpConfirmPublicar(screenId, nombrePantalla, playlistOriginalId, playlistOriginalNombre) {
  const restoreLabel = playlistOriginalNombre
    ? `"${esc(playlistOriginalNombre)}"`
    : (playlistOriginalId ? 'la playlist que tiene asignada hoy' : 'sin playlist (no tenía ninguna asignada)');

  const html = `
  <div class="modal-header">
    <div class="modal-title">🟢 Publicar video prioritario</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:14px;margin-bottom:20px;line-height:1.5;">
    Se va a publicar en <strong>${esc(nombrePantalla)}</strong>, reemplazando temporalmente lo que está corriendo ahí.<br><br>
    Cuando reviertas, se va a restaurar: ${restoreLabel}.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="vpPublicarConfirmado('${screenId}', ${playlistOriginalId ? `'${playlistOriginalId}'` : 'null'})">🟢 Publicar</button>
  </div>`;
  openModal(html);
}

async function vpPublicarConfirmado(screenId, playlistOriginalId) {
  closeModal();
  const btn = document.getElementById('vp-btn-publicar');
  if (btn) btn.disabled = true;

  try {
    const { data: jobRow, error: jobErr } = await sb
      .from('video_prioritario_jobs')
      .select('*')
      .eq('id', vpCurrentJob.id)
      .single();
    if (jobErr) throw new Error('No se pudo leer el job: ' + jobErr.message);

    // 2) Asegurar el registro "media" técnico que apunta al video compuesto
    //    (se crea una sola vez por job; si ya existe — ej. republicando
    //    tras revertir — se reusa).
    let mediaTecnicoId = jobRow.media_tecnico_id;
    if (!mediaTecnicoId) {
      let duracion = 60;
      try { duracion = await vpGetVideoDurationFromUrl(jobRow.video_final_url); } catch { /* usa el default */ }

      const { data: mediaRow, error: mediaErr } = await sb
        .from('media')
        .insert({
          nombre: 'VP_' + jobRow.id.slice(0, 8) + '.mp4',
          tipo: 'video',
          url_storage: jobRow.video_final_url,
          duracion: Math.round(duracion),
        })
        .select()
        .single();
      if (mediaErr) throw new Error('No se pudo crear el media técnico: ' + mediaErr.message);
      mediaTecnicoId = mediaRow.id;
    }

    // 3) Crear (o reusar) la playlist técnica de 1 solo ítem con ese media
    let playlistTecnicaId = jobRow.playlist_tecnica_id;
    if (!playlistTecnicaId) {
      const { data: plRow, error: plErr } = await sb
        .from('playlists')
        .insert({
          nombre: '⚡ Video Prioritario ' + new Date().toLocaleDateString('es-AR'),
          loop_continuo: true,
          activa: true,
        })
        .select()
        .single();
      if (plErr) throw new Error('No se pudo crear la playlist técnica: ' + plErr.message);
      playlistTecnicaId = plRow.id;

      const { error: itemErr } = await sb.from('playlist_items').insert({
        playlist_id: playlistTecnicaId,
        media_id: mediaTecnicoId,
        orden: 0,
        activo: true,
      });
      if (itemErr) throw new Error('No se pudo armar la playlist técnica: ' + itemErr.message);
    }

    // 4) Guardar el backup en el propio job (Supabase, accesible desde
    //    cualquier dispositivo) y marcarlo como publicado
    const { error: updJobErr } = await sb
      .from('video_prioritario_jobs')
      .update({
        screen_id: screenId,
        playlist_id_original: playlistOriginalId,
        media_tecnico_id: mediaTecnicoId,
        playlist_tecnica_id: playlistTecnicaId,
        publicado_en: new Date().toISOString(),
        revertido_en: null,
      })
      .eq('id', jobRow.id);
    if (updJobErr) throw new Error('No se pudo guardar la publicación: ' + updJobErr.message);

    // 5) Apuntar la pantalla a la playlist técnica — esto es lo que el
    //    APK detecta por heartbeat y lo hace arrancar a reproducir
    const { error: updScreenErr } = await sb
      .from('screens')
      .update({ playlist_id: playlistTecnicaId })
      .eq('id', screenId);
    if (updScreenErr) throw new Error('No se pudo actualizar la pantalla: ' + updScreenErr.message);

    toast('Publicado ✓ — el TV lo toma en el próximo heartbeat', 'success');
    vpSetJobStatus('<div style="color:var(--green, #4caf50);">✅ Publicado en pantalla</div>');
    await vpLoadJobsRecientes();

  } catch (err) {
    toast('Error al publicar: ' + err.message, 'error');
  } finally {
    const btn2 = document.getElementById('vp-btn-publicar');
    if (btn2) btn2.disabled = false;
  }
}

// Igual que getVideoDuration() de 04-media.js, pero a partir de una URL
// pública (el compuesto ya está en R2, no tenemos el File acá) en vez
// de un File local.
function vpGetVideoDurationFromUrl(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    let settled = false;

    video.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      resolve(video.duration || 60);
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error('No se pudo leer la duración del video'));
    };
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('Timeout leyendo duración')); } }, 8000);

    video.src = url;
  });
}

// Revertir: la puede llamar tanto el botón del historial de acá como el
// badge "🔴 Revertir" de la tarjeta de pantalla en 02-pantallas.js.
async function vpRevertir(jobId) {
  const { data: job, error: jobErr } = await sb
    .from('video_prioritario_jobs')
    .select('id, screen_id, playlist_id_original, revertido_en')
    .eq('id', jobId)
    .single();

  if (jobErr) { toast('Error leyendo el job: ' + jobErr.message, 'error'); return; }
  if (!job.screen_id) { toast('Este job no está publicado en ninguna pantalla', 'error'); return; }
  if (job.revertido_en) { toast('Este job ya fue revertido', 'info'); return; }

  try {
    const { error: updScreenErr } = await sb
      .from('screens')
      .update({ playlist_id: job.playlist_id_original })
      .eq('id', job.screen_id);
    if (updScreenErr) throw new Error(updScreenErr.message);

    const { error: updJobErr } = await sb
      .from('video_prioritario_jobs')
      .update({ revertido_en: new Date().toISOString() })
      .eq('id', job.id);
    if (updJobErr) throw new Error(updJobErr.message);

    toast('Playlist original restaurada ✓', 'success');

    // Refresca lo que esté visible: la grilla de Pantallas (badge) y/o
    // el historial de Video Prioritario, según desde dónde se llamó.
    if (document.getElementById('screens-list') && typeof loadDashboard === 'function') loadDashboard();
    if (document.getElementById('vp-jobs-recent')) vpLoadJobsRecientes();

  } catch (err) {
    toast('Error al revertir: ' + err.message, 'error');
  }
}

// ── Historial de jobs recientes ──────────────────────────────────
async function vpLoadJobsRecientes() {
  const el = document.getElementById('vp-jobs-recent');
  if (!el) return;
  el.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';

  let data, error;
  try {
    ({ data, error } = await vpWithTimeout(
      sb.from('video_prioritario_jobs')
        .select('id, estado, created_at, publicado_en, revertido_en, screen_id, screens:screen_id(nombre)')
        .order('created_at', { ascending: false })
        .limit(10)
    ));
  } catch (timeoutErr) {
    el.innerHTML = `<div class="empty-sub">⚠️ ${esc(timeoutErr.message)} <button class="btn btn-ghost btn-sm" onclick="vpLoadJobsRecientes()">↻ Reintentar</button></div>`;
    return;
  }

  if (error) {
    el.innerHTML = `<div class="empty-sub">Error al cargar historial: ${esc(error.message)}</div>`;
    return;
  }

  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-sub">Todavía no generaste ningún video prioritario.</div>';
    return;
  }

  el.innerHTML = data.map(j => {
    const statusCls = j.estado === 'listo' ? 'vp-status-listo' : j.estado === 'error' ? 'vp-status-error' : 'vp-status-procesando';
    const statusLbl = j.estado === 'listo' ? '✅ Listo' : j.estado === 'error' ? '⚠️ Error' : '⏳ Procesando';
    const activo    = j.estado === 'listo' && j.screen_id && j.publicado_en && !j.revertido_en;
    const pantallaLbl = activo && j.screens?.nombre ? ` · 📺 ${esc(j.screens.nombre)}` : '';

    const accion = activo
      ? `<button class="btn btn-danger btn-sm" onclick="vpRevertir('${j.id}')">🔴 Revertir</button>`
      : (j.estado === 'listo' ? `<button class="btn btn-ghost btn-sm" onclick="vpUsarJob('${j.id}')">↻ Reusar</button>` : '');

    return `
    <div class="vp-clip-chip">
      <span class="vp-status-chip ${statusCls}">${statusLbl}</span>
      <span class="vp-clip-name">${timeAgo(j.created_at)}${pantallaLbl}</span>
      ${accion}
    </div>`;
  }).join('');
}

// Retoma un job anterior (generado en otra sesión, o revertido) para
// volver a publicarlo sin tener que filmar/componer todo de nuevo.
async function vpUsarJob(jobId) {
  const { data: job, error } = await sb
    .from('video_prioritario_jobs')
    .select('id, video_final_url')
    .eq('id', jobId)
    .single();

  if (error || !job?.video_final_url) { toast('No se pudo cargar ese job', 'error'); return; }

  vpCurrentJob = { id: job.id, video_final_url: job.video_final_url };
  vpSetJobStatus('<div style="color:var(--green, #4caf50);">✅ Listo para publicar (job anterior)</div>');
  vpRevealStep4();
  toast('Job cargado — elegí una pantalla y publicá', 'success');
}