// ════════════════════════════════════════════════════════════════
//  ONESIGNAL — INIT
// ════════════════════════════════════════════════════════════════
const ONESIGNAL_APP_ID = 'af9a2188-149d-4c2b-8732-3737510b6e70';
let oneSignalInstance = null;
let oneSignalInitError = null;
let oneSignalInitPromise = null;

window.OneSignalDeferred = window.OneSignalDeferred || [];

function initOneSignalSDK() {
  if (oneSignalInitPromise) return oneSignalInitPromise;

  oneSignalInitPromise = new Promise((resolve) => {
    try {
      window.OneSignalDeferred.push(async function(OneSignal) {
        try {
          await OneSignal.init({
            appId: ONESIGNAL_APP_ID,
            notifyButton: { enable: false },
            allowLocalhostAsSecureOrigin: true,
          });
          oneSignalInstance = OneSignal;
          oneSignalInitError = null;
          resolve({ instance: OneSignal, error: null });
        } catch (err) {
          oneSignalInitError = err;
          console.warn('OneSignal no está habilitado en este origen (' + window.location.origin + '):', err?.message || err);
          resolve({ instance: null, error: err });
        }
      });
    } catch (err) {
      oneSignalInitError = err;
      resolve({ instance: null, error: err });
    }
  });

  return oneSignalInitPromise;
}

// Inicializar de forma segura
initOneSignalSDK();

// Respaldo: si el SDK de OneSignal no llega a registrar el service worker
// (bloqueador de anuncios, red lenta, etc.), lo registramos igual para que
// el PWA quede instalable y funcione offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistration('./').then((reg) => {
      if (!reg) {
        navigator.serviceWorker.register('OneSignalSDKWorker.js').catch((err) => {
          console.warn('SW registration info:', err?.message || err);
        });
      }
    }).catch(() => {});
  });
}

async function getOneSignal() {
  const res = await initOneSignalSDK();
  if (res.error || !res.instance) {
    throw new Error(res.error?.message || 'OneSignal sólo está disponible en https://player.alastecno.com');
  }
  return res.instance;
}

// ════════════════════════════════════════════════════════════════
//  TAB ALERTAS
// ════════════════════════════════════════════════════════════════
async function loadAlertas() {
  renderDeviceCard();
  loadSubsList();
  loadAlertLog();
}

async function renderDeviceCard() {
  const statusEl = document.getElementById('alert-device-status');
  const actionEl = document.getElementById('alert-device-action');
  if (!statusEl || !actionEl) return;

  try {
    const os = await getOneSignal();
    const permission = await os.Notifications.permission;
    const isSubscribed = await os.User.PushSubscription.optedIn;

    if (!permission || !isSubscribed) {
      statusEl.textContent = '⚠️ Sin suscripción activa';
      actionEl.innerHTML = `<button class="btn btn-primary btn-sm" onclick="suscribirDispositivo()">🔔 Activar notificaciones</button>`;
    } else {
      const playerId = os.User.PushSubscription.id;
      const { data } = await sb.from('admin_suscriptores')
        .select('id, activo')
        .eq('onesignal_player_id', playerId)
        .maybeSingle();

      if (!data) {
        statusEl.textContent = '⚠️ Suscripto al navegador pero no registrado en DB';
        actionEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="registrarEnDB()">💾 Registrar</button>`;
      } else if (!data.activo) {
        statusEl.textContent = '⏸ Suscripción pausada';
        actionEl.innerHTML = `<button class="btn btn-outline btn-sm" onclick="toggleSub('${data.id}', true)">▶️ Reactivar</button>`;
      } else {
        statusEl.textContent = '✅ Notificaciones activas en este dispositivo';
        actionEl.innerHTML = `<button class="btn btn-ghost btn-sm" onclick="desuscribirDispositivo('${data.id}')">🔕 Desactivar</button>`;
      }
    }
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--text-muted, #888); font-size:13px;">ℹ️ Web Push OneSignal: ${e?.message || 'Configurado para el dominio activo.'}</span>`;
    actionEl.innerHTML = '';
  }
}

async function suscribirDispositivo() {
  try {
    const os = await getOneSignal();
    await os.Notifications.requestPermission();
    const optedIn = await os.User.PushSubscription.optedIn;
    if (!optedIn) { toast('No se otorgó permiso de notificaciones', 'error'); return; }
    await registrarEnDB();
    renderDeviceCard();
    loadSubsList();
  } catch(e) {
    toast('Error al suscribir: ' + e.message, 'error');
  }
}

async function registrarEnDB() {
  try {
    const os = await getOneSignal();
    const playerId = os.User.PushSubscription.id;
    if (!playerId) { toast('No se pudo obtener el Player ID', 'error'); return; }

    const { error } = await sb.from('admin_suscriptores')
      .upsert({ onesignal_player_id: playerId, activo: true }, { onConflict: 'onesignal_player_id' });

    if (error) { toast('Error al guardar: ' + error.message, 'error'); return; }
    toast('✅ Dispositivo registrado para alertas', 'success');
    renderDeviceCard();
    loadSubsList();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function desuscribirDispositivo(dbId) {
  if (!confirm('¿Desactivar alertas en este dispositivo?')) return;
  await toggleSub(dbId, false);
  toast('Alertas desactivadas en este dispositivo', 'info');
  renderDeviceCard();
  loadSubsList();
}

async function toggleSub(dbId, activo) {
  const { error } = await sb.from('admin_suscriptores').update({ activo }).eq('id', dbId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  renderDeviceCard();
  loadSubsList();
}

async function deleteSub(dbId) {
  if (!confirm('¿Eliminar este dispositivo de la lista de alertas?')) return;
  const { error } = await sb.from('admin_suscriptores').delete().eq('id', dbId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Dispositivo eliminado ✓', 'success');
  loadSubsList();
}

async function loadSubsList() {
  const el = document.getElementById('alertas-subs-list');
  if (!el) return;

  const { data, error } = await sb.from('admin_suscriptores')
    .select('id, onesignal_player_id, activo, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">${error.message}</div></div>`;
    return;
  }

  if (!data?.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><div class="empty-text">Sin dispositivos registrados</div><div class="empty-sub">Activá las notificaciones en este dispositivo para empezar.</div></div>`;
    return;
  }

  el.innerHTML = data.map(s => {
    const shortId = s.onesignal_player_id?.slice(0, 16) + '...';
    const fecha = s.created_at ? new Date(s.created_at).toLocaleDateString('es-AR') : '—';
    const badgeCls = s.activo ? 'badge-green' : 'badge-gray';
    const badgeTxt = s.activo ? 'Activo' : 'Pausado';
    return `
    <div class="card" style="margin-bottom:8px;">
      <div class="card-header">
        <div>
          <div class="card-title" style="font-size:13px;font-family:monospace;">${shortId}</div>
          <div class="card-sub">Registrado: ${fecha}</div>
        </div>
        <div class="card-actions">
          <span class="badge ${badgeCls}"><span class="dot"></span>${badgeTxt}</span>
          <button class="btn btn-ghost btn-sm btn-icon" title="${s.activo ? 'Pausar' : 'Reactivar'}"
                  onclick="toggleSub('${s.id}', ${!s.activo})">${s.activo ? '⏸' : '▶️'}</button>
          <button class="btn btn-danger btn-sm btn-icon" title="Eliminar"
                  onclick="deleteSub('${s.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
//  FIX: loadAlertLog — filtra solo pantallas activas + muestra nombre real
// ════════════════════════════════════════════════════════════════
async function loadAlertLog() {
  const el = document.getElementById('alertas-log-list');
  if (!el) return;

  // 1. Traer pantallas activas para cruzar UUID → nombre
  const { data: screens } = await sb.from('screens').select('uuid, nombre, ciudad');
  const activeScreenMap = new Map((screens || []).map(s => [s.uuid, s]));

  // 2. Traer el cache — pedimos más registros para compensar el filtrado
  const { data, error } = await sb.from('screen_status_cache')
    .select('screen_uuid, was_online, last_checked, last_alert_offline, last_alert_online')
    .order('last_checked', { ascending: false })
    .limit(50);

  if (error || !data?.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">Sin datos de monitoreo aún</div>
      <div class="empty-sub">El monitor corre cada 2 minutos automáticamente.</div>
    </div>`;
    return;
  }

  // 3. Filtrar solo pantallas que existen actualmente
  const filtered = data.filter(r => activeScreenMap.has(r.screen_uuid)).slice(0, 20);

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">Sin datos aún</div>
      <div class="empty-sub">Las pantallas registradas aún no tienen historial de monitoreo.</div>
    </div>`;
    return;
  }

  el.innerHTML = filtered.map(r => {
    const screen = activeScreenMap.get(r.screen_uuid);
    const nombre = screen?.nombre || r.screen_uuid?.slice(0, 12) + '...';
    const ciudad = screen?.ciudad ? ` · ${esc(screen.ciudad)}` : '';
    const estado = r.was_online
      ? `<span class="badge badge-green"><span class="dot"></span>Online</span>`
      : `<span class="badge badge-red"><span class="dot"></span>Offline</span>`;
    const lastCheck    = r.last_checked       ? timeAgo(r.last_checked)       : '—';
    const lastOffAlert = r.last_alert_offline ? timeAgo(r.last_alert_offline) : 'nunca';
    const lastOnAlert  = r.last_alert_online  ? timeAgo(r.last_alert_online)  : 'nunca';

    return `
    <div class="card" style="margin-bottom:8px;">
      <div class="card-header">
        <div>
          <div class="card-title" style="font-size:13px;">${esc(nombre)}${ciudad}</div>
          <div class="card-sub">Revisado ${lastCheck}</div>
        </div>
        ${estado}
      </div>
      <div class="card-meta" style="margin-top:6px;">
        <span>📴 Alerta offline: ${lastOffAlert}</span>
        <span>📶 Alerta online: ${lastOnAlert}</span>
      </div>
    </div>`;
  }).join('');
}

