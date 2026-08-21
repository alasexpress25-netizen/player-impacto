// ════════════════════════════════════════════════════════════════
//  PLAYLISTS
// ════════════════════════════════════════════════════════════════
async function loadPlaylists() {
  const list = document.getElementById('playlists-list');
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';

  const { data, error } = await sb
    .from('playlists')
    .select('id, nombre, grupo_base, loop_continuo, activa, updated_at, playlist_items(count)')
    .eq('activa', true)
    .order('nombre');

  if (error) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`;
    return;
  }

  allPlaylists = data || [];

  if (!allPlaylists.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">Sin playlists</div>
      <div class="empty-sub">Creá una playlist para empezar a asignar contenido a tus pantallas.</div>
    </div>`;
    return;
  }

  list.innerHTML = allPlaylists.map(pl => {
    const count = pl.playlist_items?.[0]?.count ?? 0;
    return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(pl.nombre)}</div>
          <div class="card-sub">${count} ítems · Grupo ${pl.grupo_base || '?'} · ${pl.loop_continuo ? 'Loop' : 'Sin loop'}</div>
        </div>
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="Editar" onclick="openPlEditor('${pl.id}')">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" title="Eliminar" onclick="confirmDeletePlaylist('${pl.id}','${esc(pl.nombre)}')">🗑</button>
        </div>
      </div>
      <div class="card-meta">
        <span>📅 Actualizada ${timeAgo(pl.updated_at)}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Crear playlist ────────────────────────────────────────────
function showCreatePlaylistModal() {
  const html = `
  <div class="modal-header">
    <div class="modal-title">➕ Nueva playlist</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="field">
    <label>Nombre</label>
    <input id="m-pl-name" placeholder="Playlist Grupo A — Farmácias">
  </div>
  <div class="field">
    <label>Grupo base</label>
    <select id="m-pl-grupo">
      <option value="A">Grupo A</option>
      <option value="B">Grupo B</option>
      <option value="C">Grupo C</option>
    </select>
  </div>
  <div class="field">
    <label>Loop continuo</label>
    <select id="m-pl-loop">
      <option value="true">Sí (recomendado)</option>
      <option value="false">No</option>
    </select>
  </div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="createPlaylist()">Crear</button>
  </div>`;
  openModal(html);
}

async function createPlaylist() {
  const nombre       = document.getElementById('m-pl-name').value.trim();
  const grupo_base   = document.getElementById('m-pl-grupo').value;
  const loop_continuo = document.getElementById('m-pl-loop').value === 'true';

  if (!nombre) { toast('Ingresá un nombre', 'error'); return; }

  const { error } = await sb.from('playlists').insert({ nombre, grupo_base, loop_continuo, activa: true });
  if (error) { toast('Error: ' + error.message, 'error'); return; }

  toast('Playlist creada ✓', 'success');
  closeModal();
  loadPlaylists();
}

// ─── Eliminar playlist ─────────────────────────────────────────
function confirmDeletePlaylist(id, nombre) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">🗑 Eliminar playlist</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:14px;margin-bottom:20px;line-height:1.5;">
    ¿Eliminar <strong>"${esc(nombre)}"</strong>?<br>
    Las pantallas que la tenían asignada quedarán sin playlist.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger" onclick="deletePlaylist('${id}')">🗑 Eliminar</button>
  </div>`;
  openModal(html);
}

async function deletePlaylist(id) {
  closeModal();
  const { error } = await sb.from('playlists').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Playlist eliminada ✓', 'success');
  loadPlaylists();
}

// ════════════════════════════════════════════════════════════════
//  PLAYLIST EDITOR
// ════════════════════════════════════════════════════════════════
async function openPlEditor(plId) {
  editingPlId    = plId;
  editingPlItems = [];

  const editor = document.getElementById('pl-editor');
  const body   = document.getElementById('pl-editor-body');
  body.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';
  document.getElementById('pl-editor-title').textContent = 'Cargando...';
  editor.classList.add('active');
  document.body.style.overflow = 'hidden';

  const { data: pl, error: plErr } = await sb
    .from('playlists').select('*').eq('id', plId).single();
  if (plErr) { toast('Error: ' + plErr.message, 'error'); closePlEditor(); return; }

  document.getElementById('pl-editor-title').textContent = pl.nombre;

  const { data: items } = await sb
    .from('playlist_items')
    .select('id, orden, media:media_id(id, nombre, tipo, url_storage, duracion, tamanho_bytes)')
    .eq('playlist_id', plId).eq('activo', true).order('orden');

  editingPlItems = (items || []).sort((a,b) => a.orden - b.orden);

  const { data: media } = await sb.from('media').select('*').eq('activo', true).order('created_at', { ascending: false });
  allMedia = media || [];

  renderPlEditor(pl);
}

function renderPlEditor(pl) {
  const inPlaylistIds = new Set(editingPlItems.map(i => i.media.id));

  const itemsHtml = editingPlItems.length
    ? editingPlItems.map((item, idx) => renderPlItem(item, idx)).join('')
    : `<div class="empty-state" style="padding:24px">
        <div class="empty-icon">➕</div>
        <div class="empty-text">Sin ítems</div>
        <div class="empty-sub">Agregá media desde la biblioteca de abajo.</div>
      </div>`;

  const libHtml = allMedia.map(m => renderLibItem(m, inPlaylistIds.has(m.id))).join('');

  document.getElementById('pl-editor-body').innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="margin-bottom:12px">
        <div class="field" style="margin-bottom:10px">
          <label>Nombre de la playlist</label>
          <input id="pl-edit-name" value="${esc(pl.nombre)}">
        </div>
        <div style="display:flex;gap:10px">
          <div class="field" style="flex:1;margin-bottom:0">
            <label>Grupo base</label>
            <select id="pl-edit-grupo">
              <option value="A" ${pl.grupo_base==='A'?'selected':''}>Grupo A</option>
              <option value="B" ${pl.grupo_base==='B'?'selected':''}>Grupo B</option>
              <option value="C" ${pl.grupo_base==='C'?'selected':''}>Grupo C</option>
            </select>
          </div>
          <div class="field" style="flex:1;margin-bottom:0">
            <label>Loop</label>
            <select id="pl-edit-loop">
              <option value="true" ${pl.loop_continuo?'selected':''}>Sí</option>
              <option value="false" ${!pl.loop_continuo?'selected':''}>No</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <div style="font-size:14px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
      <span>📋 Contenido (${editingPlItems.length} ítems)</span>
      <span style="font-size:11px;color:var(--text2);font-weight:400">Duración editable para imágenes</span>
    </div>
    <div class="playlist-items-list" id="pl-items-list">${itemsHtml}</div>

    <hr class="divider">

    <div style="font-size:14px;font-weight:700;margin-bottom:10px">
      ➕ Agregar desde biblioteca (${allMedia.length})
    </div>
    <div class="media-library-grid" id="pl-lib-grid">${libHtml || '<div style="color:var(--text2);font-size:13px">Sin media disponible. Subí archivos en la tab Media.</div>'}</div>

    <div style="height:24px"></div>
  `;
}

function renderPlItem(item, idx) {
  const m      = item.media;
  const isImg  = m.tipo === 'imagen';
  const isFirst = idx === 0;
  const isLast  = idx === editingPlItems.length - 1;
  const thumb  = isImg
    ? `<img class="pl-item-thumb" src="${esc(m.url_storage)}" loading="lazy" style="cursor:pointer" onclick="previewMedia('${m.id}')" title="Ver">`
    : `<div class="pl-item-thumb-placeholder" style="cursor:pointer;position:relative" onclick="previewMedia('${m.id}')" title="Ver video">🎬<span style="font-size:16px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)">▶️</span></div>`;

  return `
  <div class="pl-item" id="plitem-${item.id}">
    <div class="pl-item-order">${idx + 1}</div>
    ${thumb}
    <div class="pl-item-info">
      <div class="pl-item-name">${esc(m.nombre)}</div>
      <div class="pl-item-meta">
        ${isImg
          ? `Duración: <input class="dur-input" type="number" min="1" max="300" value="${m.duracion || 10}"
               onchange="updateItemDuration('${item.id}','${m.id}',this.value)"> seg`
          : `🎬 ${m.duracion || '?'}s`}
      </div>
    </div>
    <div class="pl-item-actions">
      <button class="btn btn-ghost btn-sm btn-icon" onclick="previewMedia('${m.id}')" title="Ver">👁</button>
      <button class="btn btn-ghost btn-sm btn-icon" ${isFirst ? 'disabled' : ''} onclick="moveItem('${item.id}',-1)" title="Subir">↑</button>
      <button class="btn btn-ghost btn-sm btn-icon" ${isLast ? 'disabled' : ''} onclick="moveItem('${item.id}',1)" title="Bajar">↓</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="removeFromPlaylist('${item.id}')" title="Quitar">✕</button>
    </div>
  </div>`;
}

function renderLibItem(m, inPl) {
  const thumb = m.tipo === 'imagen'
    ? `<img class="lib-thumb" src="${esc(m.url_storage)}" loading="lazy">`
    : `<div class="lib-thumb-placeholder">🎬<span style="font-size:16px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)">▶️</span></div>`;
  return `
  <div class="lib-item ${inPl ? 'in-playlist' : ''}" title="${esc(m.nombre)}">
    <div style="position:relative" onclick="${inPl ? '' : `addToPlaylist('${m.id}')`}">
      ${thumb}
      <div class="lib-name">${esc(m.nombre)}</div>
    </div>
    <button class="btn btn-ghost btn-sm btn-icon" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5)" title="Ver" onclick="event.stopPropagation();previewMedia('${m.id}')">👁</button>
  </div>`;
}

async function addToPlaylist(mediaId) {
  const nextOrden = editingPlItems.length;
  const { error } = await sb.from('playlist_items').insert({
    playlist_id: editingPlId,
    media_id:    mediaId,
    orden:       nextOrden,
    activo:      true,
  });
  if (error && error.code !== '23505') {
    toast('Error: ' + error.message, 'error'); return;
  }
  toast('Agregado a la playlist ✓', 'success');
  await reloadPlItems();
}

async function removeFromPlaylist(itemId) {
  const { error } = await sb.from('playlist_items').delete().eq('id', itemId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Ítem eliminado ✓', 'success');
  await reloadPlItems();
}

async function moveItem(itemId, direction) {
  const idx = editingPlItems.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= editingPlItems.length) return;

  const arr = [...editingPlItems];
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];

  const updates = arr.map((item, i) =>
    sb.from('playlist_items').update({ orden: i }).eq('id', item.id)
  );
  await Promise.all(updates);

  editingPlItems = arr;
  const listEl = document.getElementById('pl-items-list');
  if (listEl) listEl.innerHTML = editingPlItems.map((item, i) => renderPlItem(item, i)).join('');
}

async function updateItemDuration(itemId, mediaId, value) {
  const dur = Math.max(1, Math.min(300, parseInt(value) || 10));
  await sb.from('media').update({ duracion: dur }).eq('id', mediaId);
}

async function reloadPlItems() {
  const { data: items } = await sb
    .from('playlist_items')
    .select('id, orden, media:media_id(id, nombre, tipo, url_storage, duracion, tamanho_bytes)')
    .eq('playlist_id', editingPlId).eq('activo', true).order('orden');
  editingPlItems = (items || []).sort((a,b) => a.orden - b.orden);

  const listEl = document.getElementById('pl-items-list');
  const libEl  = document.getElementById('pl-lib-grid');

  if (listEl) {
    listEl.innerHTML = editingPlItems.length
      ? editingPlItems.map((item, idx) => renderPlItem(item, idx)).join('')
      : `<div class="empty-state" style="padding:24px"><div class="empty-icon">➕</div><div class="empty-text">Sin ítems</div></div>`;
  }

  const inPlaylistIds = new Set(editingPlItems.map(i => i.media.id));
  if (libEl) {
    libEl.innerHTML = allMedia.map(m => renderLibItem(m, inPlaylistIds.has(m.id))).join('');
  }
}

async function savePlEditor() {
  const nombre       = document.getElementById('pl-edit-name')?.value?.trim();
  const grupo_base   = document.getElementById('pl-edit-grupo')?.value;
  const loop_continuo = document.getElementById('pl-edit-loop')?.value === 'true';

  if (!nombre) { toast('El nombre no puede estar vacío', 'error'); return; }

  const { error } = await sb.from('playlists')
    .update({ nombre, grupo_base, loop_continuo })
    .eq('id', editingPlId);

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  toast('Playlist guardada ✓', 'success');
  document.getElementById('pl-editor-title').textContent = nombre;
}

async function autoSaveAndCloseEditor() {
  // Autoguardado silencioso: si hay nombre válido, persistimos nombre/grupo/loop
  // antes de salir (los ítems ya se guardan solos en cada acción, esto es
  // solo para los 3 campos que viven en el formulario del editor).
  const nombre        = document.getElementById('pl-edit-name')?.value?.trim();
  const grupo_base    = document.getElementById('pl-edit-grupo')?.value;
  const loop_continuo = document.getElementById('pl-edit-loop')?.value === 'true';

  if (nombre) {
    await sb.from('playlists')
      .update({ nombre, grupo_base, loop_continuo })
      .eq('id', editingPlId);
  }

  document.getElementById('pl-editor').classList.remove('active');
  document.body.style.overflow = '';
  editingPlId    = null;
  editingPlItems = [];
  loadPlaylists(); // refresca la lista en segundo plano para cuando vuelvas
}

function closePlEditor() {
  document.getElementById('pl-editor').classList.remove('active');
  document.body.style.overflow = '';
  editingPlId    = null;
  editingPlItems = [];
  loadPlaylists();
}

