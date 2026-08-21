// ════════════════════════════════════════════════════════════════
//  MEDIA — CARGA
// ════════════════════════════════════════════════════════════════
async function loadMedia() {
  const grid = document.getElementById('media-grid');
  grid.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando media...</div>';

  const [{ data, error }, { data: clientesData }] = await Promise.all([
    sb.from('media').select('*').order('created_at', { ascending: false }),
    sb.from('clientes').select('id, nombre, empresa, token_acceso, activo').order('nombre')
  ]);

  if (error) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`;
    return;
  }

  allClientes = clientesData || [];
  allClientesById = {};
  allClientes.forEach(c => allClientesById[c.id] = c);

  allMedia = data || [];
  document.getElementById('media-count').textContent = `${allMedia.length} archivos en biblioteca`;

  if (!allMedia.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🎬</div>
      <div class="empty-text">Sin media aún</div>
      <div class="empty-sub">Subí videos e imágenes usando la zona de arriba.</div>
    </div>`;
    return;
  }

  grid.innerHTML = allMedia.map(m => renderMediaCard(m)).join('');
}

async function syncExternalFiles() {
  toast('Escaneando Cloudflare R2...', 'info');
  try {
    const res = await fetch(R2_MEDIA_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Token': R2_UPLOAD_TOKEN },
      body: JSON.stringify({ action: 'list' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const externalFiles = data.files || [];
    let addedCount = 0;

    for (const file of externalFiles) {
      const exists = allMedia.some(m => m.url_storage === file.url);
      if (!exists) {
        const { error } = await sb.from('media').insert({
          nombre: file.name,
          tipo: file.media_type === 'video' ? 'video' : 'imagen',
          url_storage: file.url,
          tamanho_bytes: file.size,
          duracion: file.media_type === 'video' ? 30 : 10
        });
        if (!error) addedCount++;
      }
    }

    if (addedCount > 0) {
      toast(`¡Se encontraron ${addedCount} archivos nuevos!`, 'success');
      loadMedia();
    } else {
      toast('No hay archivos nuevos en R2', 'info');
    }
  } catch (err) {
    toast('Error al sincronizar: ' + err.message, 'error');
  }
}

function renderMediaCard(m) {
  const isImg  = m.tipo === 'imagen';
  const size   = formatBytes(m.tamanho_bytes || 0);
  const dur    = m.duracion ? m.duracion + 's' : '—';
  const thumb  = isImg
    ? `<img class="media-thumb" src="${esc(m.url_storage)}" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="media-thumb-placeholder" style="cursor:pointer;position:relative;" onclick="previewMedia('${m.id}')" title="Ver video">🎬<span style="font-size:26px;position:absolute;">▶️</span></div>`;

  const cliente = allClientesById?.[m.cliente_id];
  const clienteTag = cliente
    ? `<span class="badge badge-green">👤 ${esc(cliente.empresa || cliente.nombre)}</span>`
    : `<span class="badge badge-gray">👤 Sin cliente</span>`;

  const verBtn = !isImg
    ? `<button class="media-del-btn" title="Ver video" style="right:80px;background:rgba(76,175,80,0.15);" onclick="previewMedia('${m.id}')">▶</button>`
    : `<button class="media-del-btn" title="Ver imagen" style="right:80px;background:rgba(76,175,80,0.15);" onclick="previewMedia('${m.id}')">👁</button>`;

  return `
  <div class="media-card">
    ${thumb}
    <div class="media-actions">
      ${verBtn}
      <button class="media-del-btn" title="Asignar cliente" style="right:42px;background:rgba(201,162,68,0.15);"
              onclick="showAssignClienteModal('${m.id}','${esc(m.nombre)}')">👤</button>
      <button class="media-del-btn" title="Eliminar" onclick="confirmDeleteMedia('${m.id}','${esc(m.url_storage)}','${esc(m.nombre)}')">🗑</button>
    </div>
    <div class="media-info">
      <div class="media-name">${esc(m.nombre)}</div>
      <div class="media-meta">
        <span class="badge ${isImg ? 'badge-blue' : 'badge-yellow'}">${isImg ? '📷' : '🎬'} ${m.tipo}</span>
        <span>${dur}</span>
        <span>${size}</span>
      </div>
      <div class="media-meta" style="margin-top:6px;">
        ${clienteTag}
      </div>
    </div>
  </div>`;
}

// Preview de un archivo de media (video o imagen) en el modal existente,
// para poder identificar qué es cada archivo sin descargarlo.
function previewMedia(mediaId) {
  const m = allMedia.find(x => x.id === mediaId);
  if (!m) { toast('No se encontró ese archivo', 'error'); return; }

  const isImg = m.tipo === 'imagen';
  const body = isImg
    ? `<img src="${esc(m.url_storage)}" style="width:100%;max-height:70vh;object-fit:contain;border-radius:8px;background:#000;">`
    : `<video src="${esc(m.url_storage)}" controls autoplay style="width:100%;max-height:70vh;border-radius:8px;background:#000;"></video>`;

  openModal(`
    <div class="modal-header">
      <div class="modal-title" style="word-break:break-word;padding-right:12px;">${isImg ? '📷' : '🎬'} ${esc(m.nombre)}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div style="margin-top:12px;">${body}</div>
  `);
}

// ════════════════════════════════════════════════════════════════
//  MEDIA — UPLOAD
// ════════════════════════════════════════════════════════════════
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.add('drag-over');
}
function handleDragLeave(e) {
  document.getElementById('upload-zone').classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  handleFileSelect(e.dataTransfer.files);
}

async function handleFileSelect(files) {
  if (!files?.length) return;
  const arr = Array.from(files);
  const CONCURRENCY = 3;

  for (let i = 0; i < arr.length; i += CONCURRENCY) {
    const batch = arr.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(f => uploadMedia(f)));
  }
  loadMedia();
  const fi = document.getElementById('file-input');
  if (fi) fi.value = '';
}

async function uploadMedia(file) {
  const progressArea = document.getElementById('upload-progress-area');
  const progressId   = 'prog-' + Date.now();
  const shortName    = file.name.length > 30 ? file.name.slice(0, 27) + '...' : file.name;

  progressArea.insertAdjacentHTML('beforeend', `
    <div class="progress-wrap" id="${progressId}">
      <div class="progress-label">
        <span>${shortName}</span>
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
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) { toast(`Tipo no soportado: ${file.type}`, 'error'); return; }

    setProgress(5);

    // 1) Pedirle a la edge function una URL prefirmada de R2 para este archivo
    const presignRes = await fetch(R2_MEDIA_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Token': R2_UPLOAD_TOKEN },
      body: JSON.stringify({ action: 'presign-upload', filename: file.name, size: file.size })
    });
    const presignData = await presignRes.json();
    if (presignData.error) throw new Error(presignData.error);

    setProgress(10);

    // 2) Subir el archivo directo a R2 con el PUT prefirmado (no pasa por Supabase)
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignData.uploadUrl, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 70) + 10;
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

    setProgress(85);

    let duracion = isImage ? 10 : 30;
    if (isVideo) {
      try { duracion = await getVideoDuration(file); } catch {}
    }

    const { error: dbErr } = await sb.from('media').insert({
      nombre:        presignData.filename,
      tipo:          isVideo ? 'video' : 'imagen',
      url_storage:   presignData.publicUrl,
      tamanho_bytes: file.size,
      duracion:      Math.round(duracion),
    });

    if (dbErr) throw new Error('Supabase DB: ' + dbErr.message);

    setProgress(100);
    toast(`"${shortName}" subido a Cloudflare R2 ✓`, 'success');

    setTimeout(() => document.getElementById(progressId)?.remove(), 2000);

  } catch (err) {
    const el = document.getElementById(progressId);
    if (el) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:6px 0;">⚠️ Error: ${err.message}</div>`;
      setTimeout(() => el?.remove(), 4000);
    }
    toast('Error al subir: ' + err.message, 'error');
  }
}

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted   = true;
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = '';
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const dur = video.duration || 30;
      cleanup();
      resolve(dur);
    };
    video.onerror = () => { cleanup(); reject(new Error('metadata error')); };
    video.src = url;

    setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 10000);
  });
}

// ════════════════════════════════════════════════════════════════
//  MEDIA — DELETE
// ════════════════════════════════════════════════════════════════
function confirmDeleteMedia(id, urlStorage, nombre) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">🗑 Eliminar media</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:14px;margin-bottom:20px;line-height:1.5;">
    ¿Eliminar <strong>"${esc(nombre)}"</strong>?<br>
    Esta acción también lo eliminará de todas las playlists donde esté incluido.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger" onclick="deleteMedia('${id}','${esc(urlStorage)}')">🗑 Eliminar</button>
  </div>`;
  openModal(html);
}

async function deleteMedia(id, urlStorage) {
  closeModal();

  try {
    const filename = urlStorage.split('/').pop();

    const response = await fetch(R2_MEDIA_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Token': R2_UPLOAD_TOKEN },
      body: JSON.stringify({ action: 'delete', filename: filename })
    });

    const r2Res = await response.json();
    if (r2Res.error) {
      console.warn('R2 delete warning:', r2Res.error);
    }

    const { error: dbErr } = await sb.from('media').delete().eq('id', id);
    if (dbErr) throw new Error('Supabase DB: ' + dbErr.message);

    toast('Media eliminada de R2 y DB ✓', 'success');
    loadMedia();

  } catch (err) {
    toast('Error al eliminar: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════
//  MEDIA — ASIGNAR CLIENTE  (vincula un anuncio a su anunciante,
//  para que el comprobante de veiculação cuente sus reproducciones)
// ════════════════════════════════════════════════════════════════
async function showAssignClienteModal(mediaId, mediaNombre) {
  // Refrescar lista de clientes por si se creó uno nuevo en otra pestaña
  const { data: clientesData, error } = await sb
    .from('clientes')
    .select('id, nombre, empresa, token_acceso, activo')
    .order('nombre');

  if (error) { toast('Error al cargar clientes: ' + error.message, 'error'); return; }

  allClientes = clientesData || [];
  allClientesById = {};
  allClientes.forEach(c => allClientesById[c.id] = c);

  const media = allMedia.find(m => m.id === mediaId);
  const clienteActualId = media?.cliente_id || '';

  const opts = allClientes.map(c => `
    <option value="${c.id}" ${c.id === clienteActualId ? 'selected' : ''}>
      ${esc(c.empresa || c.nombre)}${!c.activo ? ' (inactivo)' : ''}
    </option>
  `).join('');

  const html = `
  <div class="modal-header">
    <div class="modal-title">👤 Asignar cliente</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:13px;margin-bottom:16px;line-height:1.5;">
    Anuncio: <strong style="color:var(--text)">${esc(mediaNombre)}</strong><br>
    El cliente asignado podrá ver cuántas veces se exhibió este anuncio en su comprobante de veiculação.
  </p>

  <div class="field">
    <label>Cliente / anunciante</label>
    <select id="m-media-cliente">
      <option value="">— Sin cliente (contenido propio) —</option>
      ${opts}
    </select>
  </div>

  <button class="btn-link-sm" onclick="showNuevoClienteInline()" id="btn-nuevo-cliente-toggle">
    + Crear cliente nuevo
  </button>

  <div id="nuevo-cliente-fields" style="display:none;">
    <div class="field">
      <label>Nombre del contacto</label>
      <input id="m-nc-nombre" placeholder="Ej: Carlos Souza">
    </div>
    <div class="field">
      <label>Empresa / marca (se muestra en el comprobante)</label>
      <input id="m-nc-empresa" placeholder="Ej: Audi Santa Catarina">
    </div>
    <div class="field">
      <label>Email (opcional)</label>
      <input id="m-nc-email" placeholder="cliente@email.com">
    </div>
  </div>

  <div id="cliente-link-box" style="display:${clienteActualId ? 'block' : 'none'};margin-top:6px;"></div>

  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="saveMediaCliente('${mediaId}')">Guardar</button>
  </div>`;

  openModal(html);

  if (clienteActualId) mostrarLinkComprobante(clienteActualId);

  // Al cambiar el select, refrescar el link de comprobante mostrado
  const sel = document.getElementById('m-media-cliente');
  sel.addEventListener('change', () => {
    if (sel.value) mostrarLinkComprobante(sel.value);
    else document.getElementById('cliente-link-box').style.display = 'none';
  });
}

function mostrarLinkComprobante(clienteId) {
  const cliente = allClientesById[clienteId];
  const box = document.getElementById('cliente-link-box');
  if (!cliente || !box) return;

  const url = `${COMPROBANTE_BASE_URL}?t=${cliente.token_acceso}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(url)}`;

  box.style.display = 'block';
  box.innerHTML = `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px;">
      <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px;font-weight:600;">
        📲 Acceso del cliente
      </div>

      <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">
        <img src="${qrUrl}" alt="QR código de acceso" width="120" height="120"
             style="border-radius:8px;background:#fff;padding:6px;flex-shrink:0;">

        <div style="flex:1;min-width:160px;">
          <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;font-weight:600;">Código corto</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:.08em;color:var(--accent);font-family:monospace;margin-bottom:10px;">
            ${esc(cliente.token_acceso)}
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${esc(url)}');toast('Link copiado ✓','success')">📋 Copiar link</button>
            <a class="btn btn-ghost btn-sm" href="${qrUrl}" download="qr-${esc(cliente.token_acceso)}.png" style="text-decoration:none;">⬇️ Descargar QR</a>
          </div>
        </div>
      </div>

      <input readonly value="${esc(url)}" style="width:100%;margin-top:10px;font-size:11px;font-family:monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 9px;color:var(--text2);">
    </div>`;
}

function showNuevoClienteInline() {
  document.getElementById('nuevo-cliente-fields').style.display = 'block';
  document.getElementById('btn-nuevo-cliente-toggle').style.display = 'none';
}

async function saveMediaCliente(mediaId) {
  let clienteId = document.getElementById('m-media-cliente').value || null;

  // Si se completó el formulario de "cliente nuevo", crearlo primero
  const nuevoNombre  = document.getElementById('m-nc-nombre')?.value.trim();
  const nuevoEmpresa = document.getElementById('m-nc-empresa')?.value.trim();
  const nuevoEmail   = document.getElementById('m-nc-email')?.value.trim();

  if (nuevoNombre) {
    const { data: nuevoCliente, error: errCliente } = await sb
      .from('clientes')
      .insert({ nombre: nuevoNombre, empresa: nuevoEmpresa || null, email: nuevoEmail || null })
      .select('id')
      .single();

    if (errCliente) { toast('Error al crear cliente: ' + errCliente.message, 'error'); return; }
    clienteId = nuevoCliente.id;
  }

  const { error } = await sb.from('media').update({ cliente_id: clienteId }).eq('id', mediaId);
  if (error) { toast('Error al asignar: ' + error.message, 'error'); return; }

  toast(clienteId ? '👤 Cliente asignado ✓' : 'Cliente removido ✓', 'success');
  closeModal();
  loadMedia();
}

