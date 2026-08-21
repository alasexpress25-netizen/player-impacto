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
//  VIDEO EN VIVO (reproducción independiente por pantalla)
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

async function abrirVideoEnVivo(screenId, nombre) {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">▶ ${esc(nombre)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div id="vivo-stage" style="width:100%;aspect-ratio:9/16;max-height:70dvh;background:#000;border-radius:var(--r-sm);overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>
    <div style="text-align:center;font-size:11px;color:var(--text2);margin-top:10px;line-height:1.5;">
      Reproducción independiente con el mismo contenido y orden de la playlist activa — no es un espejo en vivo pixel a pixel, puede estar en un punto distinto del video.
    </div>
  `);

  const stage = document.getElementById('vivo-stage');

  const { data: screen, error: errScreen } = await sb
    .from('screens')
    .select('playlist_id')
    .eq('id', screenId)
    .single();

  if (errScreen || !screen?.playlist_id) {
    stage.innerHTML = `<div class="captura-empty">Esta pantalla no tiene una playlist asignada.</div>`;
    return;
  }

  const { data: items, error: errItems } = await sb
    .from('playlist_items')
    .select('orden, media:media_id(tipo, url_storage, duracion)')
    .eq('playlist_id', screen.playlist_id)
    .eq('activo', true)
    .order('orden', { ascending: true });

  const activos = (items || []).filter(it => it.media && it.media.url_storage);

  if (errItems || !activos.length) {
    stage.innerHTML = `<div class="captura-empty">Sin contenido disponible para reproducir ahora.</div>`;
    return;
  }

  iniciarLoopVivo(stage, activos, 0);
}

function iniciarLoopVivo(stage, items, idx) {
  clearTimeout(vivoPlayerTimer);
  if (!document.getElementById('modal-overlay').classList.contains('active')) return;

  const item = items[idx % items.length];
  const m = item.media;
  const next = () => iniciarLoopVivo(stage, items, idx + 1);

  if (m.tipo === 'imagen') {
    stage.innerHTML = `<img src="${esc(m.url_storage)}" style="width:100%;height:100%;object-fit:contain;">`;
    vivoPlayerTimer = setTimeout(next, (m.duracion || 10) * 1000);
  } else {
    stage.innerHTML = `<video autoplay muted playsinline style="width:100%;height:100%;object-fit:contain;" src="${esc(m.url_storage)}"></video>`;
    const v = stage.querySelector('video');
    v.onended = next;
    v.onerror = next;
  }
}


