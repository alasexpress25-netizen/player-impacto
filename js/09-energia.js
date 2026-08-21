// ════════════════════════════════════════════════════════════════
//  ENERGÍA — TUYA CONTROL
// ════════════════════════════════════════════════════════════════

// URL de la Edge Function (ajustá a tu URL de Supabase)
function getTuyaEdgeUrl() {
  return (loadConfig()?.supabaseUrl ?? '') + '/functions/v1/tuya-control';
}

async function callTuyaEdge(action, screenId = null) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Sesión expirada, reingresá', 'error'); return null; }

  const body = { action };
  if (screenId) body.screen_id = screenId;

  const res = await fetch(getTuyaEdgeUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + session.access_token
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function tuyaGlobalAction(action) {
  const btnOn  = document.getElementById('btn-global-on');
  const btnOff = document.getElementById('btn-global-off');
  if (btnOn)  btnOn.disabled  = true;
  if (btnOff) btnOff.disabled = true;

  const label = action === 'on' ? '⚡ Encendiendo ...' : '🔌 Apagando ...';
  const btn   = action === 'on' ? btnOn : btnOff;
  if (btn) btn.innerHTML = `<div class="spinner"></div> ${label}`;

  // La plaqueta es un relé-botón: hay que apretar y soltar (pulse_on/pulse_off),
  // igual que hace el scheduler y el watchdog. Un 'on'/'off' crudo deja el relé
  // apretado y trabado.
  const edgeAction = action === 'on' ? 'pulse_on' : 'pulse_off';

  try {
    const result = await callTuyaEdge(edgeAction);
    if (result?.ok) {
      toast(action === 'on' ? '⚡ Comando de encendido enviado ✓' : '🔌 Comando de apagado enviado ✓', 'success');
      loadTuyaLog();
    } else {
      toast('Error al comunicar con Tuya', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btnOn)  { btnOn.disabled  = false; btnOn.innerHTML  = '<span>⚡</span> Encender todos'; }
    if (btnOff) { btnOff.disabled = false; btnOff.innerHTML = '<span>🔌</span> Apagar todos'; }
  }
}

async function runSchedulerNow() {
  const btn = document.getElementById('btn-run-scheduler');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Ejecutando...'; }

  try {
    toast('▶ Ejecutando lógica de horarios...', 'info');
    // Corre la misma función SQL que dispara el cron cada 2 minutos.
    // Solo actúa sobre pantallas cuyo estado calculado (on/off) cambió
    // respecto al último guardado — si ya está "en sync" no hace nada.
    const { error } = await sb.rpc('tuya_check_schedules');
    if (error) { toast('Error al ejecutar scheduler: ' + error.message, 'error'); return; }
    toast('✅ Scheduler ejecutado', 'success');
    await loadEnergia();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

const TUYA_ACTION_LABELS = {
  on:           { doing: '⚡ Encendiendo...', done: '⚡ TV encendido ✓' },
  off:          { doing: '🔌 Apagando ...',    done: '🔌 TV apagado ✓' },
};

async function tuyaScreenAction(screenId, action) {
  const labels = TUYA_ACTION_LABELS[action] || { doing: 'Ejecutando...', done: 'Listo ✓' };
  // La plaqueta simula el dedo apretando el botón físico de power: para encender
  // hay que apretar y soltar 15s (pulse_on), para apagar 30s (pulse_off). Mismo
  // mecanismo que usan el scheduler y el watchdog — nada de power_cycle ni on/off crudo.
  const edgeAction = action === 'on' ? 'pulse_on' : 'pulse_off';

  try {
    toast(labels.doing, 'info');
    const result = await callTuyaEdge(edgeAction, screenId);
    if (result?.ok) {
      toast(labels.done, 'success');
      loadTuyaLog();
    } else {
      toast('Error al comunicar con Tuya', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function loadEnergia() {
  await Promise.all([loadEnergiaScreens(), loadTuyaLog()]);
}

async function loadEnergiaScreens() {
  const list = document.getElementById('energia-screens-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';

  const [{ data, error }, { data: schedulesData, error: errSch }, { data: statusData, error: errStatus }] = await Promise.all([
    sb.from('screens')
      .select('id, uuid, nombre, ciudad, tuya_device_id, watchdog_activo, timezone')
      .order('nombre'),
    sb.from('screen_schedules')
      .select('id, screen_id, hora_apertura, hora_cierre, dias_activos')
      .order('hora_apertura'),
    sb.from('screen_status_cache')
      .select('screen_uuid, was_online, last_checked'),
  ]);

  if (error) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`;
    return;
  }

  if (errSch) {
    console.warn('No se pudieron cargar los horarios:', errSch.message);
  }
  if (errStatus) {
    console.warn('No se pudo cargar el estado de señal:', errStatus.message);
  }

  if (!data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div><div class="empty-text">Sin pantallas registradas</div></div>`;
    return;
  }

  // Agrupar franjas horarias por pantalla
  const schedulesByScreen = {};
  (schedulesData || []).forEach(s => {
    (schedulesByScreen[s.screen_id] ||= []).push(s);
  });

  // Estado de señal por pantalla (mismo dato que usa el watchdog / la
  // pestaña Pantallas y Alertas: screen_status_cache.was_online), cruzado
  // por uuid.
  const signalByUuid = {};
  (statusData || []).forEach(r => { signalByUuid[r.screen_uuid] = r; });

  list.innerHTML = data.map(sc =>
    renderEnergiaScreenCard(sc, schedulesByScreen[sc.id] || [], signalByUuid[sc.uuid])
  ).join('');
}

const DIAS = ['mon','tue','wed','thu','fri','sat','sun'];
const DIAS_ES = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

// Renderiza una franja horaria individual (fila) dentro de una pantalla.
// rowId es un identificador único dentro de la card (índice inicial al cargar,
// o un id generado al agregar una franja nueva con el botón "+ Agregar horario").
function renderFranjaRow(screenId, rowId, franja) {
  const diasActivos = franja?.dias_activos || ['mon','tue','wed','thu','fri','sat'];
  const horaOn  = (franja?.hora_apertura || '09:00:00').slice(0,5);
  const horaOff = (franja?.hora_cierre  || '21:00:00').slice(0,5);
  const diaChips = DIAS.map(d => `
    <span class="dia-chip ${diasActivos.includes(d) ? 'active' : ''}"
          onclick="this.classList.toggle('active')">${DIAS_ES[d]}</span>
  `).join('');

  return `
  <div class="franja-row" id="franja-${screenId}-${rowId}">
    <div class="energia-time-row">
      <div class="field">
        <label>🌅 Apertura</label>
        <input type="time" class="franja-on" value="${horaOn}">
      </div>
      <div class="field">
        <label>🌙 Cierre</label>
        <input type="time" class="franja-off" value="${horaOff}">
      </div>
    </div>
    <div class="dia-chips franja-dias">${diaChips}</div>
    <button class="btn btn-ghost btn-sm franja-remove" onclick="removeFranja('${screenId}','${rowId}')">🗑 Quitar este horario</button>
  </div>`;
}

function addFranja(screenId) {
  const container = document.getElementById(`franjas-${screenId}`);
  if (!container) return;
  const rowId = 'n' + Date.now() + Math.floor(Math.random() * 1000);
  container.insertAdjacentHTML('beforeend', renderFranjaRow(screenId, rowId, null));
}

function removeFranja(screenId, rowId) {
  const row = document.getElementById(`franja-${screenId}-${rowId}`);
  if (row) row.remove();
}

function renderEnergiaScreenCard(sc, franjas, signalInfo) {
  const franjasHtml = (franjas && franjas.length)
    ? franjas.map((f, i) => renderFranjaRow(sc.id, i, f)).join('')
    : renderFranjaRow(sc.id, 0, null);

  const hasTuya   = !!sc.tuya_device_id;
  const deviceTag = hasTuya
    ? `<span class="badge badge-green"><span class="dot"></span>Enchufe vinculado</span>`
    : `<span class="badge badge-yellow">Sin enchufe</span>`;

  // Estado de señal: viene del mismo watchdog/monitor que ya usan las
  // pestañas "Pantallas" y "Alertas" (screen_status_cache.was_online),
  // en vez de consultar el estado eléctrico real del enchufe Tuya.
  const lastCheckTxt = signalInfo?.last_checked ? timeAgo(signalInfo.last_checked) : null;
  const ledTag = !sc.watchdog_activo
    ? `<span class="badge badge-gray" title="Watchdog de señal desactivado para esta pantalla — no se está monitoreando"><span class="dot"></span>Sin información</span>`
    : !signalInfo
      ? `<span class="badge badge-gray" title="El monitor de señal aún no reportó datos"><span class="dot"></span>Sin datos</span>`
      : signalInfo.was_online
        ? `<span class="badge badge-green" title="Última señal: ${lastCheckTxt}"><span class="dot"></span>Con señal</span>`
        : `<span class="badge badge-red" title="Última señal: ${lastCheckTxt}"><span class="dot"></span>Sin señal</span>`;

  return `
  <div class="energia-screen-card" id="esc-${sc.id}">
    <div class="sc-header">
      <div>
        <div class="card-title">${esc(sc.nombre || sc.id)}</div>
        <div class="card-sub">${esc(sc.ciudad || '—')}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        ${ledTag}
        ${deviceTag}
      </div>
    </div>

    <!-- Tuya Device ID -->
    <div class="field" style="margin-bottom:10px;">
      <label>ID Enchufe EKAZA (Tuya Device ID)</label>
      <input id="tuya-id-${sc.id}" value="${esc(sc.tuya_device_id || '')}"
             placeholder="bf1a2b3c4d5e..." style="font-family:monospace;font-size:13px;">
    </div>

    <!-- Horarios (múltiples franjas encendido/apagado) -->
    <div style="font-size:12px;color:var(--text2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;font-weight:500;">Horarios</div>
    <div class="franjas-container" id="franjas-${sc.id}">${franjasHtml}</div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:4px;" onclick="addFranja('${sc.id}')">+ Agregar horario</button>

    <!-- Watchdog toggle -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
      <label class="toggle-pill" for="wd-${sc.id}">
        <input type="checkbox" id="wd-${sc.id}" ${sc.watchdog_activo ? 'checked' : ''}
               onchange="updateWatchdog('${sc.id}', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-label">🐕 Watchdog activo</span>
      </label>
      <div style="display:flex;gap:6px;">
        ${hasTuya ? `
        <button class="btn btn-outline btn-sm" onclick="tuyaScreenAction('${sc.id}','on')" title="Encender este enchufe">⚡</button>
        <button class="btn btn-danger btn-sm"  onclick="tuyaScreenAction('${sc.id}','off')" title="Apagar este enchufe">🔌</button>
        ` : ''}
        <button class="btn btn-primary btn-sm" onclick="saveEnergiaScreen('${sc.id}')">Guardar</button>
      </div>
    </div>
  </div>`;
}

async function updateWatchdog(screenId, activo) {
  const { error } = await sb.from('screens').update({ watchdog_activo: activo }).eq('id', screenId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(activo ? '🐕 Watchdog activado' : '🐕 Watchdog desactivado', 'success');
}

async function saveEnergiaScreen(screenId) {
  const tuyaId    = document.getElementById(`tuya-id-${screenId}`)?.value.trim() || null;
  const container = document.getElementById(`franjas-${screenId}`);
  const rows      = container ? Array.from(container.querySelectorAll('.franja-row')) : [];

  const franjas = rows.map(row => {
    const horaOn  = row.querySelector('.franja-on')?.value;
    const horaOff = row.querySelector('.franja-off')?.value;
    const dias = Array.from(row.querySelectorAll('.dia-chip.active')).map(el => {
      const txt = el.textContent.trim();
      return Object.entries(DIAS_ES).find(([,v]) => v === txt)?.[0];
    }).filter(Boolean);
    return { horaOn, horaOff, dias };
  }).filter(f => f.horaOn && f.horaOff);

  // Validación simple: cada franja debe tener apertura antes que cierre
  for (const f of franjas) {
    if (f.horaOn >= f.horaOff) {
      toast(`⚠️ Horario inválido (${f.horaOn}–${f.horaOff}): la apertura debe ser antes del cierre`, 'error');
      return;
    }
  }

  const { error: errScreen } = await sb.from('screens')
    .update({ tuya_device_id: tuyaId })
    .eq('id', screenId);
  if (errScreen) { toast('Error al guardar: ' + errScreen.message, 'error'); return; }

  // Estrategia simple: reemplazar todas las franjas de esta pantalla
  const { error: errDel } = await sb.from('screen_schedules').delete().eq('screen_id', screenId);
  if (errDel) { toast('Error al guardar horarios: ' + errDel.message, 'error'); return; }

  if (franjas.length) {
    const { error: errIns } = await sb.from('screen_schedules').insert(
      franjas.map(f => ({
        screen_id:      screenId,
        hora_apertura:  f.horaOn  + ':00',
        hora_cierre:    f.horaOff + ':00',
        dias_activos:   f.dias,
      }))
    );
    if (errIns) { toast('Error al guardar horarios: ' + errIns.message, 'error'); return; }
  }

  toast('✅ Configuración de energía guardada', 'success');
  loadEnergiaScreens();
}

async function loadTuyaLog() {
  const el = document.getElementById('energia-log-list');
  if (!el) return;

  const [{ data, error }, { data: screensForLog }] = await Promise.all([
    sb.from('tuya_action_log')
      .select('id, created_at, action, triggered_by, screen_id, result, device_ids')
      .order('created_at', { ascending: false })
      .limit(30),
    sb.from('screens').select('id, nombre, tuya_device_id')
  ]);

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>
      <div class="empty-text">Sin acciones registradas aún</div>
      <div class="empty-sub">Las acciones manuales y del watchdog aparecen aquí.</div></div>`;
    return;
  }

  // Mapas para poder mostrar el nombre de la pantalla en vez de solo el id/device_id.
  const nameByScreenId = {};
  const nameByDeviceId = {};
  (screensForLog || []).forEach(s => {
    const nombre = s.nombre || s.id;
    nameByScreenId[s.id] = nombre;
    if (s.tuya_device_id) nameByDeviceId[s.tuya_device_id] = nombre;
  });

  const actionEmoji = { on: '⚡', off: '🔌', status: '📡', watchdog: '🐕' };
  const triggerBadge = { manual: 'badge-blue', cron: 'badge-yellow', watchdog: 'badge-green' };

  el.innerHTML = data.map(row => {
    const emoji = actionEmoji[row.action] || '•';
    const ago   = timeAgo(row.created_at);
    const trig  = row.triggered_by || 'manual';
    const badge = triggerBadge[trig] || 'badge-gray';
    let resultStr = '';
    try {
      const r = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
      if (r?.devices) resultStr = `${r.devices.filter(d=>d.success).length}/${r.devices.length} OK`;
      else if (r?.group) resultStr = r.success ? 'Grupo OK' : 'Error';
    } catch {}

    // Qué pantalla(s) corresponde a esta fila del log.
    let targetLabel;
    if (row.screen_id && nameByScreenId[row.screen_id]) {
      targetLabel = esc(nameByScreenId[row.screen_id]);
    } else if (Array.isArray(row.device_ids) && row.device_ids.length) {
      const nombres = row.device_ids.map(id => nameByDeviceId[id] || id);
      targetLabel = nombres.length > 2
        ? `${nombres.length} pantallas`
        : nombres.map(esc).join(', ');
    } else {
      targetLabel = 'Todas las pantallas';
    }

    return `
    <div class="card" style="margin-bottom:6px;padding:10px 14px;">
      <div class="card-header" style="margin-bottom:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">${emoji}</span>
          <div>
            <div style="font-size:13px;font-weight:600;">${row.action.toUpperCase()} ${resultStr ? '· ' + resultStr : ''} <span style="font-weight:400;color:var(--text2);">· ${targetLabel}</span></div>
            <div class="card-sub">${ago}</div>
          </div>
        </div>
        <span class="badge ${badge}">${trig}</span>
      </div>
    </div>`;
  }).join('');
}

