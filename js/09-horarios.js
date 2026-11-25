// ════════════════════════════════════════════════════════════════
//  HORARIOS — franjas de encendido/apagado por pantalla + watchdog
//
//  Esto reemplaza a js/09-energia.js: se sacó todo lo de Tuya
//  (enchufe, botones encender/apagar, tuya_action_log). Lo único que
//  queda es lo que sigue en uso real: las franjas horarias
//  (screen_schedules) y el toggle de watchdog_activo.
//
//  Esta pantalla es la ÚNICA fuente de horarios que lee
//  monitor-screens (edge function) para decidir si una pantalla
//  "debería estar en línea" ahora mismo y, si no lo está, si
//  corresponde mandar la alerta push o suprimirla.
// ════════════════════════════════════════════════════════════════

async function loadHorarios() {
  await loadHorariosScreens();
}

// Duración de la vuelta de la playlist asignada a cada pantalla
// (screen.id → { nombre, seg, sinDur }). La usa updateHorarioStats().
let horarioLoops = {};

async function loadHorariosScreens() {
  const list = document.getElementById('horarios-screens-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';

  const [{ data, error }, { data: schedulesData, error: errSch }, { data: statusData, error: errStatus }, { data: plData, error: errPl }] = await Promise.all([
    sb.from('screens')
      .select('id, uuid, nombre, ciudad, watchdog_activo, timezone, playlist_id')
      .order('nombre'),
    sb.from('screen_schedules')
      .select('id, screen_id, hora_apertura, hora_cierre, dias_activos')
      .order('hora_apertura'),
    sb.from('screen_status_cache')
      .select('screen_uuid, was_online, last_checked'),
    sb.from('playlists')
      .select('id, nombre, playlist_items(activo, media:media_id(tipo, duracion))'),
  ]);

  if (error) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`;
    return;
  }

  if (errSch)    console.warn('No se pudieron cargar los horarios:', errSch.message);
  if (errStatus) console.warn('No se pudo cargar el estado de señal:', errStatus.message);
  if (errPl)     console.warn('No se pudieron cargar las playlists:', errPl.message);

  // Vuelta de cada playlist → por pantalla (según screens.playlist_id)
  const loopByPlaylist = {};
  (plData || []).forEach(pl => {
    const items = (pl.playlist_items || []).filter(i => i.activo);
    loopByPlaylist[pl.id] = { nombre: pl.nombre, ...plLoopSeconds(items) };
  });
  horarioLoops = {};
  data.forEach(sc => { horarioLoops[sc.id] = sc.playlist_id ? (loopByPlaylist[sc.playlist_id] || null) : null; });

  if (!data?.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📺</div><div class="empty-text">Sin pantallas registradas</div></div>`;
    return;
  }

  // Agrupar franjas horarias por pantalla
  const schedulesByScreen = {};
  (schedulesData || []).forEach(s => {
    (schedulesByScreen[s.screen_id] ||= []).push(s);
  });

  // Estado de señal por pantalla (mismo dato que usan Pantallas y Alertas)
  const signalByUuid = {};
  (statusData || []).forEach(r => { signalByUuid[r.screen_uuid] = r; });

  list.innerHTML = data.map(sc =>
    renderHorarioScreenCard(sc, schedulesByScreen[sc.id] || [], signalByUuid[sc.uuid])
  ).join('');

  data.forEach(sc => updateHorarioStats(sc.id));
}

const DIAS = ['mon','tue','wed','thu','fri','sat','sun'];
const DIAS_ES = { mon:'Lun', tue:'Mar', wed:'Mié', thu:'Jue', fri:'Vie', sat:'Sáb', sun:'Dom' };

// Renderiza una franja horaria individual (fila) dentro de una pantalla.
function renderFranjaRow(screenId, rowId, franja) {
  const diasActivos = franja?.dias_activos || ['mon','tue','wed','thu','fri','sat'];
  const horaOn  = (franja?.hora_apertura || '09:00:00').slice(0,5);
  const horaOff = (franja?.hora_cierre  || '21:00:00').slice(0,5);
  const diaChips = DIAS.map(d => `
    <span class="dia-chip ${diasActivos.includes(d) ? 'active' : ''}"
          onclick="this.classList.toggle('active'); updateHorarioStats('${screenId}')">${DIAS_ES[d]}</span>
  `).join('');

  return `
  <div class="franja-row" id="franja-${screenId}-${rowId}">
    <div class="energia-time-row">
      <div class="field">
        <label>🌅 Apertura</label>
        <input type="time" class="franja-on" value="${horaOn}" oninput="updateHorarioStats('${screenId}')">
      </div>
      <div class="field">
        <label>🌙 Cierre</label>
        <input type="time" class="franja-off" value="${horaOff}" oninput="updateHorarioStats('${screenId}')">
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
  updateHorarioStats(screenId);
}

function removeFranja(screenId, rowId) {
  const row = document.getElementById(`franja-${screenId}-${rowId}`);
  if (row) row.remove();
  updateHorarioStats(screenId);
}

// ─── Rotación estimada: cuántas veces se ve cada anuncio por día ──
// Cada anuncio suena UNA vez por vuelta de la playlist (dure 20, 30 o
// 50s), así que: veces/día = segundos encendida por día ÷ segundos de
// la vuelta. Se calcula en vivo leyendo las franjas del formulario
// (aunque todavía no estén guardadas). Una franja que cruza la
// medianoche cuenta completa para el día en que abre.
function updateHorarioStats(screenId) {
  const el = document.getElementById(`hstats-${screenId}`);
  if (!el) return;

  const container = document.getElementById(`franjas-${screenId}`);
  const rows = container ? Array.from(container.querySelectorAll('.franja-row')) : [];
  const segPorDia = {};
  rows.forEach(row => {
    const on  = row.querySelector('.franja-on')?.value;
    const off = row.querySelector('.franja-off')?.value;
    if (!on || !off || on === off) return;
    const [h1, m1] = on.split(':').map(Number);
    const [h2, m2] = off.split(':').map(Number);
    const min = ((h2 * 60 + m2) - (h1 * 60 + m1) + 1440) % 1440;
    Array.from(row.querySelectorAll('.dia-chip.active')).forEach(chip => {
      const d = Object.entries(DIAS_ES).find(([, v]) => v === chip.textContent.trim())?.[0];
      if (d) segPorDia[d] = (segPorDia[d] || 0) + min * 60;
    });
  });

  const valores = Object.values(segPorDia);
  const loop = horarioLoops[screenId];
  const st = 'font-size:12px;color:var(--text2);line-height:1.6;';

  if (!valores.length) {
    el.innerHTML = `<div style="${st}">📊 Sin días/horas activas — no se puede calcular la rotación.</div>`;
    return;
  }

  const promSeg = valores.reduce((a, b) => a + b, 0) / valores.length;
  const minSeg  = Math.min(...valores);
  const maxSeg  = Math.max(...valores);
  const encendida = `🕒 Encendida: <strong>${fmtDur(promSeg)}</strong> por día` +
    (maxSeg - minSeg > 60 ? ` (entre ${fmtDur(minSeg)} y ${fmtDur(maxSeg)})` : '');

  let rotacion;
  if (!loop) {
    rotacion = `🔁 Sin playlist asignada a esta pantalla.`;
  } else if (loop.seg <= 0) {
    rotacion = `🔁 La playlist "${esc(loop.nombre)}" no tiene duración calculable.`;
  } else {
    const prom = promSeg / loop.seg;
    const rango = (maxSeg - minSeg > 60)
      ? ` (entre ${Math.round(minSeg / loop.seg)} y ${Math.round(maxSeg / loop.seg)} según el día)` : '';
    rotacion = `🔁 Vuelta de "${esc(loop.nombre)}": <strong>${fmtDur(loop.seg)}</strong>` +
      ` · 📺 Cada anuncio se ve ≈ <strong>${Math.round(prom)} veces por día</strong>${rango}` +
      (loop.sinDur ? ` <span style="color:var(--warning,#e0a800)">⚠️ ${loop.sinDur} video(s) sin duración: el cálculo es aproximado</span>` : '');
  }

  el.innerHTML = `<div style="${st}">${encendida}<br>${rotacion}</div>`;
}

function renderHorarioScreenCard(sc, franjas, signalInfo) {
  const franjasHtml = (franjas && franjas.length)
    ? franjas.map((f, i) => renderFranjaRow(sc.id, i, f)).join('')
    : renderFranjaRow(sc.id, 0, null);

  // Estado de señal: mismo dato que ya usan las pestañas "Pantallas" y
  // "Alertas" (screen_status_cache.was_online).
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
      </div>
    </div>

    <!-- Horarios (múltiples franjas encendido/apagado) -->
    <div style="font-size:12px;color:var(--text2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;font-weight:500;">Horarios</div>
    <div class="franjas-container" id="franjas-${sc.id}">${franjasHtml}</div>
    <button class="btn btn-outline btn-sm" style="width:100%;margin-top:4px;" onclick="addFranja('${sc.id}')">+ Agregar horario</button>

    <!-- Rotación estimada (se calcula en vivo con las franjas de arriba) -->
    <div id="hstats-${sc.id}" style="margin-top:10px;padding:8px 10px;border:1px dashed var(--border);border-radius:8px;"></div>

    <!-- Watchdog toggle -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
      <label class="toggle-pill" for="wd-${sc.id}">
        <input type="checkbox" id="wd-${sc.id}" ${sc.watchdog_activo ? 'checked' : ''}
               onchange="updateWatchdog('${sc.id}', this.checked)">
        <span class="toggle-track"></span>
        <span class="toggle-label">🐕 Watchdog activo</span>
      </label>
      <button class="btn btn-primary btn-sm" onclick="saveHorarioScreen('${sc.id}')">Guardar</button>
    </div>
  </div>`;
}

async function updateWatchdog(screenId, activo) {
  const { error } = await sb.from('screens').update({ watchdog_activo: activo }).eq('id', screenId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(activo ? '🐕 Watchdog activado' : '🐕 Watchdog desactivado', 'success');
}

async function saveHorarioScreen(screenId) {
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

  // Validación: se permite que el cierre sea menor que la apertura (franja que
  // cruza la medianoche, ej. 18:05–00:02, cierra al día siguiente). Lo único
  // inválido es apertura == cierre, porque no define ninguna duración.
  for (const f of franjas) {
    if (f.horaOn === f.horaOff) {
      toast(`⚠️ Horario inválido (${f.horaOn}–${f.horaOff}): la apertura y el cierre no pueden ser iguales`, 'error');
      return;
    }
  }

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

  toast('✅ Horarios guardados', 'success');
  loadHorariosScreens();
}
