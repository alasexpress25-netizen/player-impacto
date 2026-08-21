// ════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════
let screenClienteMap = {}; // screen_id -> array de nombres de clientes asignados (cliente_pantallas)
let screenVpJobMap    = {}; // screen_id -> job_id de video_prioritario_jobs activo (publicado, sin revertir)

// NUEVO: mapa de pantallas con un Video Prioritario activo pendiente de
// revertir (ver js/11-video-prioritario.js), para mostrar el badge y
// permitir revertir directo desde la tarjeta.
async function loadScreenVpJobMap() {
  screenVpJobMap = {};
  const { data } = await sb.from('video_prioritario_jobs')
    .select('id, screen_id, publicado_en')
    .not('screen_id', 'is', null)
    .not('publicado_en', 'is', null)
    .is('revertido_en', null)
    .order('publicado_en', { ascending: false });
  (data || []).forEach(j => {
    if (!screenVpJobMap[j.screen_id]) screenVpJobMap[j.screen_id] = j.id;
  });
}

async function loadScreenClienteMap() {
  screenClienteMap = {};
  const { data: asignaciones } = await sb.from('cliente_pantallas').select('screen_id, cliente_id');
  if (!asignaciones || !asignaciones.length) return;

  const clienteIds = [...new Set(asignaciones.map(a => a.cliente_id))];
  const { data: cls } = await sb.from('clientes').select('id, nombre, empresa').in('id', clienteIds);
  const clientesMap = {};
  (cls || []).forEach(c => clientesMap[c.id] = c.empresa || c.nombre);

  asignaciones.forEach(a => {
    const nombre = clientesMap[a.cliente_id];
    if (!nombre) return;
    (screenClienteMap[a.screen_id] ||= []).push(nombre);
  });
}

async function loadDashboard() {
  const list = document.getElementById('screens-list');
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando pantallas...</div>';

  const [{ data, error }] = await Promise.all([
    sb.rpc('get_dashboard_status'),
    loadScreenClienteMap(),
    loadScreenVpJobMap()
  ]);

  if (error) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Error al cargar</div><div class="empty-sub">${error.message}</div></div>`;
    return;
  }

  const now = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('dashboard-last-update').textContent = 'Actualizado a las ' + now;

  const s = data.summary || {};
  document.getElementById('sum-total').textContent   = s.total   ?? 0;
  document.getElementById('sum-online').textContent  = s.online  ?? 0;
  document.getElementById('sum-offline').textContent = s.offline ?? 0;

  const screens = data.screens || [];
  if (!screens.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📺</div>
      <div class="empty-text">Sin pantallas registradas</div>
      <div class="empty-sub">Las pantallas se registran automáticamente cuando conectan por primera vez.</div>
    </div>`;
    return;
  }

  list.innerHTML = screens.map(sc => renderScreenCard(sc)).join('');
}

function renderScreenCard(sc) {
  const online   = !!sc.online;
  const badgeCls = online ? 'badge-green' : 'badge-red';
  const dotLabel = online ? 'Online' : 'Offline';
  const hb       = sc.last_heartbeat ? timeAgo(sc.last_heartbeat) : 'Nunca';
  const ciudad   = sc.ciudad || '—';
  const playNom  = sc.playlist_nombre || '—';
  const media    = sc.media_actual || '—';
  const ip       = sc.ip_address || '—';
  const storage  = sc.playlist_version || 'Calculando...';
  const nombre   = sc.nombre || sc.uuid?.slice(0,12) || 'Sin nombre';

  // NUEVO: historial simple de errores — última cosa que el watchdog (o un
  // crash de la app) resolvió solo. Se muestra como chip solo si hay algo.
  const errorChip = sc.ultimo_error
    ? `<div class="error-chip" title="${esc(sc.ultimo_error)}">⚠️ ${esc(sc.ultimo_error)}</div>`
    : '';

  // NUEVO: badge de Video Prioritario activo (ver js/11-video-prioritario.js)
  const vpJobId = screenVpJobMap[sc.id];
  const vpChip = vpJobId
    ? `<div class="vp-active-chip">
         <span>🟠 Video prioritario activo</span>
         <button class="btn btn-danger btn-sm" onclick="vpRevertir('${vpJobId}')">🔴 Revertir</button>
       </div>`
    : '';

  const clientesAsignados = screenClienteMap[sc.id] || [];
  const clienteChip = clientesAsignados.length
    ? (clientesAsignados.length === 1
        ? `<span title="Cliente asignado (ve esta pantalla en su dashboard)">👤 ${esc(clientesAsignados[0])}</span>`
        : `<span title="${esc(clientesAsignados.join(', '))}">👤 ${clientesAsignados.length} clientes</span>`)
    : `<span style="color:var(--text2)" title="Ningún cliente ve esta pantalla en su dashboard todavía">👤 Sin cliente</span>`;

  return `
  <div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">${esc(nombre)}</div>
        <div class="card-sub">${esc(ciudad)} · Disco: <strong style="color:var(--blue)">${storage}</strong></div>
      </div>
      <div class="card-actions">
        <span class="badge ${badgeCls}"><span class="dot"></span>${dotLabel}</span>
        <button class="btn btn-ghost btn-sm btn-icon" title="Solicitar captura de pantalla"
                onclick="requestScreenshot('${esc(sc.id)}','${esc(nombre)}')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h2.5L8 5.5h8L17.5 8H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13.5" r="3.5"></circle></svg>
        </button>
        <button class="btn btn-ghost btn-sm btn-icon" title="Enviar mensaje instantáneo"
                onclick="openMessageModal('${esc(sc.id)}','${esc(nombre)}')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-4-1L3 20l1.1-5.5A8.4 8.4 0 0 1 4 12.5 8.38 8.38 0 0 1 12.5 4 8.5 8.5 0 0 1 21 11.5z"></path></svg>
        </button>
        <button class="btn btn-ghost btn-sm btn-icon" title="Editar pantalla"
                onclick="showEditScreenModal('${esc(sc.id)}','${esc(sc.nombre || '')}','${esc(sc.ciudad || '')}','${sc.grupo_base || 'A'}','${sc.playlist_id || ''}')">✏️</button>
      </div>
    </div>
    <div class="card-meta">
      <span>🕐 ${hb}</span>
      <span>📋 ${esc(playNom)}</span>
      <span>▶️ ${esc(media)}</span>
      <span>🌐 ${esc(ip)}</span>
      ${clienteChip}
    </div>
    ${errorChip}
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
      <label class="toggle-pill" for="wd-${sc.id}">
        <input type="checkbox" id="wd-${sc.id}" ${sc.watchdog_activo !== false ? 'checked' : ''}
               onchange="updateWatchdog('${sc.id}', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-label">🐕 Watchdog activo</span>
      </label>
    </div>
  </div>`;
}

// Activa/desactiva el watchdog de señal (monitor-screens) para una pantalla.
// Cuando está desactivado, esa pantalla no cuenta para online/offline en el
// resumen del dashboard ni dispara avisos push si se desconecta.
async function updateWatchdog(screenId, activo) {
  const { error } = await sb.from('screens').update({ watchdog_activo: activo }).eq('id', screenId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(activo ? '🐕 Watchdog activado' : '🐕 Watchdog desactivado', 'success');
  loadDashboard();
}

// ════════════════════════════════════════════════════════════════
//  MODAL: EDITAR PANTALLA
// ════════════════════════════════════════════════════════════════
async function showEditScreenModal(id, nombre, ciudad, grupo, playlistId) {
  // Cargar playlists, clientes y las asignaciones actuales (cliente_pantallas) en paralelo
  const [{ data: pls }, { data: clientesData }, { data: asignaciones }] = await Promise.all([
    sb.from('playlists').select('id, nombre, grupo_base').eq('activa', true).order('nombre'),
    sb.from('clientes').select('id, nombre, empresa, activo').order('nombre'),
    sb.from('cliente_pantallas').select('cliente_id').eq('screen_id', id)
  ]);

  const opts = (pls || []).map(p =>
    `<option value="${p.id}" ${p.id === playlistId ? 'selected' : ''}>${esc(p.nombre)} (${p.grupo_base})</option>`
  ).join('');

  const clientesAsignadosIds = new Set((asignaciones || []).map(a => a.cliente_id));
  const clienteRows = (clientesData || []).map(c => `
    <label class="cliente-check-row" style="display:flex; align-items:center; gap:8px; padding:6px 4px; min-height:26px; border-bottom:1px solid var(--border, #eee); cursor:pointer;">
      <input type="checkbox" class="m-sc-cliente-chk" value="${c.id}" ${clientesAsignadosIds.has(c.id) ? 'checked' : ''}>
      <span style="font-size:13px;">${esc(c.empresa || c.nombre)}${c.activo === false ? ' <span style="color:var(--text2)">(inactivo)</span>' : ''}</span>
    </label>`).join('');

  const html = `
  <div class="modal-header">
    <div class="modal-title">✏️ Editar pantalla</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="field">
    <label>Nombre</label>
    <input id="m-sc-name" value="${esc(nombre)}" placeholder="Farmácia Centro">
  </div>
  <div class="field">
    <label>Ciudad</label>
    <input id="m-sc-city" value="${esc(ciudad)}" placeholder="São Paulo">
  </div>
  <div class="field">
    <label>Grupo base</label>
    <select id="m-sc-grupo">
      <option value="A" ${grupo==='A'?'selected':''}>Grupo A</option>
      <option value="B" ${grupo==='B'?'selected':''}>Grupo B</option>
      <option value="C" ${grupo==='C'?'selected':''}>Grupo C</option>
    </select>
  </div>
  <div class="field">
    <label>Playlist asignada</label>
    <select id="m-sc-playlist">
      <option value="">— Sin playlist —</option>
      ${opts}
    </select>
  </div>
  <div class="field">
    <label>Clientes asignados (ven esta pantalla en su dashboard — hasta 20)</label>
    <input id="m-sc-cliente-search" placeholder="Buscar cliente..." style="margin-bottom:6px;"
           oninput="filterClienteCheckboxes(this.value)">
    <div id="m-sc-cliente-list" style="max-height:148px; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; border:1px solid var(--border, #ddd); border-radius:8px; padding:4px 8px;">
      ${clienteRows || '<div style="padding:8px; color:var(--text2); font-size:13px;">Sin clientes registrados</div>'}
    </div>
    <div id="m-sc-cliente-count" style="font-size:11px; color:var(--text2); margin-top:4px;"></div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-outline btn-sm" style="color:var(--red); border-color:var(--red);"
            onclick="confirmResetDevice('${id}','${esc(nombre)}')">⚙️ Restaurar</button>
    <button class="btn btn-danger btn-sm" onclick="confirmDeleteScreen('${id}','${esc(nombre)}')">🗑 Borrar</button>
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary btn-sm" onclick="saveScreen('${id}')">Guardar</button>
  </div>`;

  openModal(html);
  updateClienteCount();
}

function filterClienteCheckboxes(query) {
  const q = (query || '').trim().toLowerCase();
  document.querySelectorAll('.cliente-check-row').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

function updateClienteCount() {
  const el = document.getElementById('m-sc-cliente-count');
  if (!el) return;
  const checked = document.querySelectorAll('.m-sc-cliente-chk:checked').length;
  el.textContent = `${checked} cliente${checked === 1 ? '' : 's'} seleccionado${checked === 1 ? '' : 's'}`;
  document.querySelectorAll('.m-sc-cliente-chk').forEach(chk => {
    chk.onchange = updateClienteCount;
  });
}

async function saveScreen(id) {
  const nombre     = document.getElementById('m-sc-name').value.trim();
  const ciudad     = document.getElementById('m-sc-city').value.trim();
  const grupo_base = document.getElementById('m-sc-grupo').value;
  const playlist_id = document.getElementById('m-sc-playlist').value || null;
  const clienteIds  = Array.from(document.querySelectorAll('.m-sc-cliente-chk:checked')).map(chk => chk.value);

  const { error } = await sb.from('screens').update({ nombre, ciudad, grupo_base, playlist_id }).eq('id', id);
  if (error) { toast('Error al guardar: ' + error.message, 'error'); return; }

  // Sincronizar cliente_pantallas: se borran todas las asignaciones anteriores de
  // esta pantalla y se insertan las elegidas ahora. Una pantalla puede tener
  // varios clientes asignados (hasta 20).
  const { error: errDelAsig } = await sb.from('cliente_pantallas').delete().eq('screen_id', id);
  if (errDelAsig) {
    toast('Pantalla actualizada, pero falló la asignación de clientes: ' + errDelAsig.message, 'error');
    closeModal();
    loadDashboard();
    return;
  }
  if (clienteIds.length) {
    const rows = clienteIds.map(cliente_id => ({ cliente_id, screen_id: id }));
    const { error: errInsAsig } = await sb.from('cliente_pantallas').insert(rows);
    if (errInsAsig) {
      toast('Pantalla actualizada, pero falló la asignación de clientes: ' + errInsAsig.message, 'error');
      closeModal();
      loadDashboard();
      return;
    }
  }

  toast('Pantalla actualizada ✓', 'success');
  closeModal();
  loadDashboard();
}

function confirmDeleteScreen(id, nombre) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">🗑 Borrar pantalla</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:14px;margin-bottom:20px;line-height:1.6;">
    ¿Estás seguro que querés borrar <strong style="color:var(--text)">"${esc(nombre)}"</strong>?<br>
    Esta acción no se puede deshacer.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger" onclick="deleteScreen('${id}')">🗑 Sí, borrar</button>
  </div>`;
  openModal(html);
}

// ════════════════════════════════════════════════════════════════
//  FIX: deleteScreen — también limpia screen_status_cache
// ════════════════════════════════════════════════════════════════
async function deleteScreen(id) {
  closeModal();

  // Obtener el uuid del dispositivo antes de borrarlo
  const { data: screen } = await sb.from('screens').select('uuid').eq('id', id).single();

  const { error } = await sb.from('screens').delete().eq('id', id);
  if (error) { toast('Error al borrar: ' + error.message, 'error'); return; }

  // Limpiar entradas huérfanas del cache de monitoreo
  if (screen?.uuid) {
    await sb.from('screen_status_cache').delete().eq('screen_uuid', screen.uuid);
  }

  toast('Pantalla eliminada ✓', 'success');
  loadDashboard();
}

function confirmResetDevice(id, nombre) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">⚙️ Restaurar dispositivo</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:14px;margin-bottom:20px;line-height:1.6;">
    ¿Querés forzar la limpieza de <strong style="color:var(--text)">"${esc(nombre)}"</strong>?<br><br>
    Se borrarán todos los videos descargados y se volverán a bajar desde cero. Útil si el video se trabó o querés limpiar el disco.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-danger" onclick="resetDevice('${id}')">⚙️ Sí, Restaurar</button>
  </div>`;
  openModal(html);
}

async function resetDevice(id) {
  closeModal();
  // FIX: el player ya no lee comandos de media_actual (ese campo es lo que
  // el player REPORTA que está reproduciendo, no lo que recibe). Los
  // comandos remotos viajan por comando_remoto desde la actualización del
  // firmware — con el valor viejo, este botón dejaba de funcionar en
  // silencio.
  const { error } = await sb.from('screens').update({ comando_remoto: 'FORCE_RESET' }).eq('id', id);
  if (error) { toast('Error al enviar comando: ' + error.message, 'error'); return; }

  toast('Comando de restauración enviado ✓', 'success');
  loadDashboard();
}

// NUEVO: solicitar captura de pantalla remota. El player la toma en el
// próximo heartbeat, saca el screenshot y lo sube al bucket "screenshots".
async function requestScreenshot(id, nombre) {
  const { error } = await sb.from('screens').update({ comando_remoto: 'SCREENSHOT' }).eq('id', id);
  if (error) { toast('Error al solicitar captura: ' + error.message, 'error'); return; }
  toast(`Captura solicitada a "${nombre}" — puede tardar hasta 30s ✓`, 'success');
}

// NUEVO: mensaje remoto instantáneo — mismo canal comando_remoto, con
// prefijo "MENSAJE:" que el player reconoce y muestra como banner 30s.
function openMessageModal(id, nombre) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">📢 Mensaje a "${esc(nombre)}"</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <p style="color:var(--text2);font-size:13px;margin-bottom:14px;line-height:1.5;">
    Aparece como banner destacado en la pantalla durante 30 segundos, sin tocar la playlist.
  </p>
  <div class="field">
    <label>Mensaje</label>
    <input id="m-msg-text" maxlength="80" placeholder="Ej: Promo especial hoy">
    <div style="font-size:11px;color:var(--text2);margin-top:6px;">Máx. 80 caracteres — para que entre bien en pantalla.</div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="sendRemoteMessage('${id}')">📢 Enviar</button>
  </div>`;
  openModal(html);
  setTimeout(() => document.getElementById('m-msg-text')?.focus(), 50);
}

async function sendRemoteMessage(id) {
  const texto = (document.getElementById('m-msg-text')?.value || '').trim();
  if (!texto) { toast('Escribí un mensaje primero', 'error'); return; }
  closeModal();
  const { error } = await sb.from('screens').update({ comando_remoto: 'MENSAJE:' + texto }).eq('id', id);
  if (error) { toast('Error al enviar mensaje: ' + error.message, 'error'); return; }
  toast('Mensaje enviado ✓', 'success');
}

