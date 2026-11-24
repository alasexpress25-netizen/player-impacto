// ════════════════════════════════════════════════════════════════
//  CAPTURAS — galería de screenshots remotos (bucket "screenshots")
// ════════════════════════════════════════════════════════════════
async function loadCapturas() {
  const grid = document.getElementById('capturas-grid');
  grid.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando capturas...</div>';

  const { data: screens, error } = await sb
    .from('screens')
    .select('id, uuid, nombre')
    .eq('activa', true)
    .order('nombre', { ascending: true, nullsFirst: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(error.message)}</div></div>`;
    return;
  }
  if (!screens || !screens.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📷</div><div class="empty-text">Sin pantallas registradas</div></div>`;
    return;
  }

  // Por cada pantalla, listamos su carpeta en el bucket y nos quedamos con
  // el archivo más reciente (el nombre es un timestamp epoch, así que
  // ordenar por nombre desc ya nos da el más nuevo primero).
  const cards = await Promise.all(screens.map(async sc => {
    const nombre = sc.nombre || sc.uuid?.slice(0, 12) || 'Sin nombre';
    try {
      const { data: files } = await sb.storage.from('screenshots').list(sc.uuid, {
        limit: 1,
        sortBy: { column: 'name', order: 'desc' }
      });
      const latest = files && files[0];
      if (!latest) return renderCapturaCard(sc.id, nombre, null, null);

      const path = `${sc.uuid}/${latest.name}`;
      const { data: pub } = sb.storage.from('screenshots').getPublicUrl(path);
      const ts = Number(latest.name.split('.')[0]);
      const when = Number.isFinite(ts) ? new Date(ts) : null;
      return renderCapturaCard(sc.id, nombre, pub?.publicUrl || null, when);
    } catch (e) {
      return renderCapturaCard(sc.id, nombre, null, null);
    }
  }));

  grid.innerHTML = cards.join('');
}

function renderCapturaCard(id, nombre, url, when) {
  const thumb = url
    ? `<img src="${esc(url)}" alt="Captura de ${esc(nombre)}" loading="lazy" onclick="openLightbox('${esc(url)}')">`
    : `<div class="captura-empty">Sin capturas todavía</div>`;
  const timeLabel = when ? timeAgo(when.toISOString()) : '—';

  return `
  <div class="captura-card">
    <div class="captura-thumb">${thumb}</div>
    <div class="captura-body">
      <div class="captura-name">${esc(nombre)}</div>
      <div class="captura-time">🕐 ${timeLabel}</div>
      <button class="btn btn-outline btn-sm btn-full" onclick="requestScreenshot('${esc(id)}','${esc(nombre)}')">📷 Solicitar nueva</button>
    </div>
  </div>`;
}

function openLightbox(url) {
  document.getElementById('captura-lightbox-img').src = url;
  document.getElementById('captura-lightbox').classList.add('active');
}
function closeLightbox() {
  document.getElementById('captura-lightbox').classList.remove('active');
  document.getElementById('captura-lightbox-img').src = '';
}

// ════════════════════════════════════════════════════════════════
//  VIDEO EN VIVO (sigue el archivo que reporta la TV)
// ════════════════════════════════════════════════════════════════
let vivoPlayerTimer = null;

async function loadVideoVivo() {
  const grid = document.getElementById('vivo-grid');
  grid.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando pantallas...</div>';

  const { data: screens, error } = await sb
    .from('screens')
    .select('id, uuid, nombre, ciudad, last_heartbeat, playlist_id')
    .eq('activa', true)
    .order('nombre', { ascending: true, nullsFirst: false });

  if (error) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${esc(error.message)}</div></div>`;
    return;
  }
  if (!screens || !screens.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">▶️</div><div class="empty-text">Sin pantallas registradas</div></div>`;
    return;
  }

  // Reutilizamos la última captura remota como miniatura (mismo bucket que "Capturas")
  const cards = await Promise.all(screens.map(async sc => {
    const nombre = sc.nombre || sc.uuid?.slice(0, 12) || 'Sin nombre';
    const online = !!(sc.last_heartbeat && (Date.now() - new Date(sc.last_heartbeat).getTime()) < 3 * 60 * 1000);
    let thumbUrl = null;
    try {
      const { data: files } = await sb.storage.from('screenshots').list(sc.uuid, {
        limit: 1,
        sortBy: { column: 'name', order: 'desc' }
      });
      const latest = files && files[0];
      if (latest) {
        const { data: pub } = sb.storage.from('screenshots').getPublicUrl(`${sc.uuid}/${latest.name}`);
        thumbUrl = pub?.publicUrl || null;
      }
    } catch (e) { /* sin captura todavía, no pasa nada */ }
    return renderVivoCard(sc.id, nombre, sc.ciudad, online, thumbUrl, !!sc.playlist_id);
  }));

  grid.innerHTML = cards.join('');
}

function renderVivoCard(id, nombre, ciudad, online, thumbUrl, tienePlaylist) {
  const thumb = thumbUrl
    ? `<img src="${esc(thumbUrl)}" alt="${esc(nombre)}" loading="lazy">`
    : `<div class="captura-empty">Sin vista previa todavía</div>`;
  const badgeCls = online ? 'badge-green' : 'badge-red';
  const dotLabel = online ? 'Online' : 'Offline';
  const clickAttr = tienePlaylist ? `onclick="abrirVideoEnVivo('${esc(id)}','${esc(nombre)}')"` : '';

  return `
  <div class="captura-card">
    <div class="captura-thumb" style="position:relative;${tienePlaylist ? 'cursor:pointer;' : ''}" ${clickAttr}>
      ${thumb}
      ${tienePlaylist ? `<div class="vivo-play-overlay">▶</div>` : ''}
    </div>
    <div class="captura-body">
      <div class="captura-name">${esc(nombre)}</div>
      <div class="captura-time">${esc(ciudad || '—')} · <span class="badge ${badgeCls}"><span class="dot"></span>${dotLabel}</span></div>
      <button class="btn btn-outline btn-sm btn-full" ${tienePlaylist ? '' : 'disabled title="Esta pantalla no tiene playlist asignada"'} ${clickAttr}>
        <span class="vivo-live-dot"></span>&nbsp;Ver en vivo
      </button>
    </div>
  </div>`;
}

// Sigue el archivo que la TV reporta en screens.media_actual (se actualiza
// en cada cambio de video). Se consulta cada 3s; vivoPlayerTimer se mantiene
// con ese nombre porque closeModal() (07-utils) lo limpia al cerrar.
let vivoArchivoActual = null;
const vivoMediaCache = {};

async function abrirVideoEnVivo(screenId, nombre) {
  vivoArchivoActual = null;
  openModal(`
    <div class="modal-header">
      <div class="modal-title">▶ ${esc(nombre)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div id="vivo-stage" style="width:100%;aspect-ratio:16/9;max-height:70dvh;background:#000;border-radius:var(--r-sm);overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>
    <div style="text-align:center;margin-top:10px;font-size:12px;color:var(--text);">
      <span class="vivo-live-dot"></span>&nbsp;Reproduciendo en la TV: <b id="vivo-now">—</b>
    </div>
    <div style="text-align:center;font-size:11px;color:var(--text2);margin-top:6px;line-height:1.5;">
      Muestra el archivo que la pantalla está ejecutando y cambia cuando la TV pasa al siguiente. Se sincroniza con el segundo en que la TV empezó el video; puede haber 1-2 s de diferencia.
    </div>
  `);
  vivoSincronizar(screenId, document.getElementById('vivo-stage'));
}

async function vivoBuscarMedia(nombreArchivo) {
  if (vivoMediaCache[nombreArchivo] !== undefined) return vivoMediaCache[nombreArchivo];
  const { data } = await sb.from('media')
    .select('id, tipo, url_storage, duracion')
    .eq('nombre', nombreArchivo)
    .limit(1);
  const m = (data && data[0] && data[0].url_storage) ? data[0] : null;
  vivoMediaCache[nombreArchivo] = m;
  return m;
}

// Hora en que la TV empezó este archivo (último play_log de esa pantalla y media).
// Si no se puede leer (RLS, sin registro), devuelve null y el video arranca en 0.
async function vivoInicioReproduccion(screenId, mediaId) {
  try {
    const { data, error } = await sb.from('play_log')
      .select('played_at')
      .eq('screen_id', screenId)
      .eq('media_id', mediaId)
      .order('played_at', { ascending: false })
      .limit(1);
    if (error || !data || !data[0]) return null;
    return new Date(data[0].played_at).getTime();
  } catch (e) { return null; }
}

async function vivoSincronizar(screenId, stage) {
  clearTimeout(vivoPlayerTimer);
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || !overlay.classList.contains('active') || !stage || !stage.isConnected) return;

  try {
    const { data: sc, error } = await sb.from('screens')
      .select('media_actual, orientacion')
      .eq('id', screenId)
      .single();
    if (error) throw error;

    stage.style.aspectRatio = sc.orientacion === 'vertical' ? '9/16' : '16/9';
    const archivo = sc.media_actual || null;
    const label = document.getElementById('vivo-now');
    if (label) label.textContent = archivo || '—';

    if (archivo !== vivoArchivoActual) {
      vivoArchivoActual = archivo;
      const m = archivo ? await vivoBuscarMedia(archivo) : null;
      if (!m) {
        stage.innerHTML = `<div class="captura-empty">${archivo ? 'La pantalla reporta "' + esc(archivo) + '", que no es un archivo de la biblioteca.' : 'La pantalla no reporta ningún archivo todavía.'}</div>`;
      } else if (m.tipo === 'imagen') {
        stage.innerHTML = `<img src="${esc(m.url_storage)}" style="width:100%;height:100%;object-fit:contain;">`;
      } else {
        const inicio = await vivoInicioReproduccion(screenId, m.id);
        stage.innerHTML = `<video autoplay muted loop playsinline style="width:100%;height:100%;object-fit:contain;" src="${esc(m.url_storage)}"></video>`;
        const v = stage.querySelector('video');
        // Salta al segundo en que va la TV. El cálculo se hace al cargar el
        // video (no antes) para descontar lo que tarda en descargarse.
        // Si el registro es más viejo que el video (TV trabada) no se salta.
        if (inicio && v) {
          v.addEventListener('loadedmetadata', () => {
            const seg = (Date.now() - inicio) / 1000;
            if (seg > 0 && v.duration && seg < v.duration) v.currentTime = seg;
          }, { once: true });
        }
      }
    }
  } catch (e) {
    console.warn('vivoSincronizar:', e);
  }

  vivoPlayerTimer = setTimeout(() => vivoSincronizar(screenId, stage), 3000);
}
