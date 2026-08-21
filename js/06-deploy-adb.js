// ════════════════════════════════════════════════════════════════
//  AGENTE ADB LOCAL — Instalar / Desinstalar DS Player en TV
// ════════════════════════════════════════════════════════════════
const ADB_AGENT_KEY = 'adbAgentCfg';
let deployMode           = 'install';   // 'install' | 'uninstall'
let deploySelectedSerial = null;
let deployBusy           = false;
let deployArpBaseline    = null; // [{ip, mac}] capturado antes de prender el TV

function getAgentCfg() {
  try { return JSON.parse(localStorage.getItem(ADB_AGENT_KEY)) || null; }
  catch { return null; }
}
function saveAgentCfg(cfg) {
  localStorage.setItem(ADB_AGENT_KEY, JSON.stringify(cfg));
}
function agentBaseUrl(cfg) {
  return `http://127.0.0.1:${cfg.port}`;
}
async function agentFetch(path, opts = {}) {
  const cfg = getAgentCfg();
  if (!cfg || !cfg.port || !cfg.token) throw new Error('NO_CFG');
  const headers = Object.assign({ 'X-Agent-Token': cfg.token }, opts.headers || {});
  const res  = await fetch(agentBaseUrl(cfg) + path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!data) throw new Error('BAD_RESPONSE');
  return data;
}

function deployTitle() {
  return deployMode === 'install' ? '📲 Instalar DS Player en TV' : '🗑️ Desinstalar DS Player de TV';
}

function openDeployModal(mode) {
  deployMode           = mode;
  deploySelectedSerial = null;
  deployBusy           = false;
  deployArpBaseline    = null;
  const cfg = getAgentCfg();
  if (!cfg || !cfg.port || !cfg.token) {
    renderDeployPairing();
  } else {
    renderDeployLoading();
    checkAgentAndLoadDevices();
  }
}

function renderDeployPairing(errorMsg) {
  const cfg = getAgentCfg() || { port: 5091, token: '' };
  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="deploy-intro">
    Para instalar o desinstalar la app en un TV necesitás tener corriendo el <strong>agente local</strong>
    en tu PC (el mismo que usa el ADB que ya tenés instalado).
  </div>
  ${errorMsg ? `<div class="deploy-error">⚠️ ${esc(errorMsg)}</div>` : ''}
  <div class="field">
    <label>Puerto del agente</label>
    <input id="m-agent-port" type="number" value="${esc(cfg.port || 5091)}" placeholder="5091">
  </div>
  <div class="field">
    <label>Token de emparejamiento</label>
    <input id="m-agent-token" type="text" value="${esc(cfg.token || '')}"
           placeholder="Pegá acá el token que te mostró la ventana negra"
           autocomplete="off" spellcheck="false" style="font-family:monospace;font-size:12px;">
  </div>
  <div class="deploy-hint">¿No tenés el agente corriendo? Abrí <code>iniciar-agente.bat</code> en tu PC y copiá el token que te muestra la ventana.</div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="deployPairAndContinue()">🔗 Conectar agente</button>
  </div>`;
  openModal(html);
}

async function deployPairAndContinue() {
  const port  = parseInt(document.getElementById('m-agent-port')?.value, 10) || 5091;
  const token = document.getElementById('m-agent-token')?.value.trim();
  if (!token) { toast('Pegá el token del agente', 'error'); return; }
  saveAgentCfg({ port, token });
  renderDeployLoading();
  await checkAgentAndLoadDevices();
}

function deployEditPairing() {
  renderDeployPairing();
}

function renderDeployLoading(msg) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="loading-center" style="padding:30px 0;"><div class="spinner"></div> ${esc(msg || 'Conectando con el agente local...')}</div>`;
  openModal(html);
}

function renderDeployAgentDown() {
  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="empty-state">
    <div class="empty-icon">🔌</div>
    <div class="empty-text">El agente no está corriendo</div>
    <div class="empty-sub">Intenté abrirlo automáticamente y no respondió. Abrí "iniciar-agente.bat" en tu PC (o revisá que <code>adbagente://</code> esté registrado), dejalo abierto y volvé a intentar.</div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="deployEditPairing()">⚙️ Cambiar puerto/token</button>
    <button class="btn btn-primary" onclick="checkAgentAndLoadDevices()">🔄 Reintentar</button>
  </div>`;
  openModal(html);
}

async function pingAgentOnce() {
  try {
    const cfg = getAgentCfg();
    if (!cfg || !cfg.port) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(agentBaseUrl(cfg) + '/ping', { signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json().catch(() => null);
    return !!(data && data.ok);
  } catch {
    return false;
  }
}

function tryAutoLaunchAgent() {
  // Dispara el protocolo registrado en Windows (ver adbagente.reg) para que
  // el sistema operativo abra el agente local sin que el usuario lo haga a mano.
  try { window.location.href = 'adbagente://start'; } catch (e) {}
}

async function checkAgentAndLoadDevices() {
  const cfg = getAgentCfg();
  if (!cfg) { renderDeployPairing(); return; }

  let alive = await pingAgentOnce();
  if (!alive) {
    renderDeployLoading('Abriendo el agente local...');
    tryAutoLaunchAgent();
    for (let i = 0; i < 12 && !alive; i++) {
      await new Promise(r => setTimeout(r, 800));
      alive = await pingAgentOnce();
    }
  }
  if (!alive) { renderDeployAgentDown(); return; }

  try {
    const verify = await agentFetch(`/verify?token=${encodeURIComponent(cfg.token)}`);
    if (!verify.ok) { renderDeployPairing('El token no es válido. Volvé a pegarlo desde la ventana del agente.'); return; }
  } catch (e) {
    renderDeployAgentDown();
    return;
  }
  await deployRefreshDevices();
}

async function deployRefreshDevices(lastIp) {
  deploySelectedSerial = null;
  renderDeployLoading('Buscando conexiones ADB...');
  let r;
  try {
    r = await agentFetch('/devices');
  } catch (e) {
    renderDeployAgentDown();
    return;
  }
  if (!r.ok) {
    renderDeployError(r.error || 'No se pudo leer la lista de conexiones ADB.', lastIp);
    return;
  }
  renderDeployDeviceList(r.devices || [], lastIp);
}

function renderDeployError(msg, lastIp) {
  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="empty-state">
    <div class="empty-icon">⚠️</div>
    <div class="empty-text">El agente respondió con un error</div>
    <div class="empty-sub">${esc(msg)}</div>
  </div>
  <div class="deploy-hint">Revisá que ADB esté instalado y que <code>adbPath</code> en <code>config.json</code> apunte al <code>adb.exe</code> correcto.</div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="deployEditPairing()">⚙️ Cambiar puerto/token</button>
    <button class="btn btn-primary" onclick="deployRefreshDevices('${esc(lastIp || '')}')">🔄 Reintentar</button>
  </div>`;
  openModal(html);
}

function renderDeployDeviceList(devices, lastIp) {
  const rows = devices.length
    ? devices.map(d => {
        const selectable = d.state === 'device';
        const stateBadge = selectable
          ? `<span class="badge badge-green">conectado</span>`
          : `<span class="badge badge-red">${esc(d.state || 'offline')}</span>`;
        return `
        <div class="device-row ${!selectable ? 'disabled' : ''}" data-serial="${esc(d.serial)}"
             ${selectable ? `onclick="deploySelectDevice(this, '${esc(d.serial)}')"` : ''}>
          <div class="device-row-main">
            <div class="device-row-serial">${esc(d.serial)}</div>
            <div class="device-row-model">${esc(d.model || 'Modelo desconocido')}</div>
          </div>
          ${stateBadge}
        </div>`;
      }).join('')
    : `<div class="empty-state" style="padding:20px 0;">
         <div class="empty-icon">📡</div>
         <div class="empty-text">Sin conexiones activas</div>
         <div class="empty-sub">Escribí abajo la IP del TV para conectarte.</div>
       </div>`;

  const actionLabel = deployMode === 'install' ? '📲 Instalar en este TV' : '🗑️ Desinstalar de este TV';
  const actionFn    = deployMode === 'install' ? 'deployRunInstall' : 'deployRunUninstall';

  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="deploy-section-label">Conexiones ADB</div>
  <div class="device-list">${rows}</div>

  <div class="deploy-section-label" style="margin-top:16px;">🔍 Encontrar el TV automáticamente</div>
  <div class="deploy-hint" style="margin-bottom:8px;">
    1) Con el TV apagado (o antes de prenderlo) tocá <strong>Capturar lista</strong>.
    2) Prendé el TV y esperá ~10-15s a que tome IP.
    3) Tocá <strong>Comparar</strong>: te muestro el/los IP nuevos que aparecieron, tocá uno para conectarte.
  </div>
  <div class="modal-actions" style="margin:0 0 8px;">
    <button class="btn btn-ghost" onclick="deployArpCapture()">📡 1. Capturar lista</button>
    <button class="btn btn-ghost" onclick="deployArpCompare()">🔎 2. Comparar (TV ya prendido)</button>
  </div>
  <div id="m-arp-status" class="empty-sub" style="margin-bottom:8px;"></div>
  <div id="m-arp-results" class="device-list"></div>

  <div class="uuid-scan-row" style="margin: 14px 0 16px;">
    <div class="field" style="margin-bottom:0">
      <label>Conectar nueva IP</label>
      <input id="m-deploy-ip" type="text" placeholder="192.168.0.34" value="${esc(lastIp || '')}"
             autocomplete="off" spellcheck="false" onkeydown="if(event.key==='Enter'){deployConnectIp();}">
    </div>
    <button class="btn-scan" title="Conectar" onclick="deployConnectIp()">🔗</button>
  </div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="deployRefreshDevices()">🔄 Actualizar lista</button>
    <button class="btn btn-primary" id="m-deploy-action-btn" disabled onclick="${actionFn}()">${actionLabel}</button>
  </div>`;
  openModal(html);
}

function deploySelectDevice(el, serial) {
  deploySelectedSerial = serial;
  document.querySelectorAll('.device-row').forEach(r => r.classList.remove('selected'));
  el.classList.add('selected');
  const btn = document.getElementById('m-deploy-action-btn');
  if (btn) btn.disabled = false;
}

async function deployConnectIp() {
  const ip = document.getElementById('m-deploy-ip')?.value.trim();
  if (!ip) { toast('Escribí la IP del TV', 'error'); return; }
  renderDeployLoading('Conectando a ' + ip + '...');
  try {
    const r = await agentFetch('/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    });
    if (!r.ok) {
      toast('No se pudo conectar: ' + (r.output || r.error || 'error desconocido'), 'error');
      await deployRefreshDevices(ip);
      return;
    }
    toast('Conectado ✓', 'success');
    await deployRefreshDevices(ip);
  } catch (e) {
    renderDeployAgentDown();
  }
}

async function deployArpCapture() {
  const statusEl = document.getElementById('m-arp-status');
  if (statusEl) statusEl.textContent = '⏳ Escaneando la red (puede tardar unos segundos)...';
  try {
    const r = await agentFetch('/arp');
    if (!r.ok) { toast(r.error || 'No se pudo leer la tabla ARP', 'error'); return; }
    deployArpBaseline = r.entries || [];
    if (statusEl) statusEl.textContent = `✓ Lista base capturada (${deployArpBaseline.length} dispositivos). Prendé el TV y después tocá "Comparar".`;
    // Se muestra la lista capturada tal cual, sin filtrar nada, para que la puedas ver vos.
    renderArpList(deployArpBaseline, null, 'Lista capturada (antes de prender el TV)');
    toast(`Lista capturada (${deployArpBaseline.length} dispositivos)`, 'success');
  } catch (e) {
    toast('No pude leer arp -a en el agente', 'error');
  }
}

async function deployArpCompare() {
  const statusEl = document.getElementById('m-arp-status');
  if (!deployArpBaseline) {
    toast('Primero tocá "Capturar lista"', 'error');
    return;
  }
  if (statusEl) statusEl.textContent = '⏳ Escaneando la red (puede tardar unos segundos)...';
  try {
    const r = await agentFetch('/arp');
    if (!r.ok) { toast(r.error || 'No se pudo leer la tabla ARP', 'error'); return; }
    const entradasActuales = r.entries || [];
    const baseKeys = new Set(deployArpBaseline.map(e => e.ip + '|' + e.mac));
    const newKeys  = new Set(entradasActuales.filter(e => !baseKeys.has(e.ip + '|' + e.mac)).map(e => e.ip + '|' + e.mac));
    // Se muestra la lista completa nueva (no solo el filtro), marcando en verde
    // lo que no estaba en la captura base — así el diff lo revisás vos mismo.
    renderArpList(entradasActuales, newKeys, 'Lista actual (comparada contra la capturada)');
    if (statusEl) {
      statusEl.textContent = newKeys.size
        ? `Se encontraron ${newKeys.size} dispositivo(s) nuevo(s), marcados en verde abajo.`
        : 'No hay filas nuevas todavía respecto a la lista capturada. Esperá unos segundos más y volvé a comparar.';
    }
  } catch (e) {
    toast('No pude leer arp -a en el agente', 'error');
  }
}

function renderArpList(entries, newKeys, titulo) {
  const box = document.getElementById('m-arp-results');
  if (!box) return;
  if (!entries || !entries.length) {
    box.innerHTML = `<div class="empty-sub">No se encontraron entradas en la tabla ARP.</div>`;
    return;
  }
  const rows = entries.map(e => {
    const key = e.ip + '|' + e.mac;
    const isNew = newKeys && newKeys.has(key);
    return `
    <div class="device-row" onclick="deployUseArpResult('${esc(e.ip)}')">
      <div class="device-row-main">
        <div class="device-row-serial">${esc(e.ip)}</div>
        <div class="device-row-model">MAC ${esc(e.mac)}</div>
      </div>
      ${isNew ? `<span class="badge badge-green">nuevo · usar esta IP</span>` : `<span class="badge">usar esta IP</span>`}
    </div>`;
  }).join('');
  box.innerHTML = (titulo ? `<div class="deploy-hint" style="margin:4px 0 6px;">${esc(titulo)}</div>` : '') + rows;
}

function deployUseArpResult(ip) {
  const input = document.getElementById('m-deploy-ip');
  if (input) input.value = ip;
  deployConnectIp();
}

function renderDeploySteps(steps, finished, ok) {
  const rows = steps.map(s => `
    <div class="step-row ${s.ok ? 'step-ok' : 'step-fail'}">
      <span class="step-icon">${s.ok ? '✓' : '✕'}</span>
      <div class="step-text">
        <div class="step-name">${esc(s.step)}</div>
        ${s.detail ? `<div class="step-detail">${esc(s.detail)}</div>` : ''}
      </div>
    </div>`).join('');
  const html = `
  <div class="modal-header">
    <div class="modal-title">${deployTitle()}</div>
    ${finished ? `<button class="modal-close" onclick="closeModal()">✕</button>` : ''}
  </div>
  <div class="step-list">${rows}</div>
  ${!finished ? `<div class="loading-center" style="padding:14px 0 4px;"><div class="spinner"></div> Ejecutando...</div>` : ''}
  ${finished ? `
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="deployRefreshDevices()">⬅ Volver a la lista</button>
    <button class="btn btn-primary" onclick="closeModal()">${ok ? '✓ Listo' : 'Cerrar'}</button>
  </div>` : ''}`;
  openModal(html);
}

async function deployRunInstall() {
  if (!deploySelectedSerial || deployBusy) return;
  deployBusy = true;
  renderDeploySteps([{ step: 'Iniciando instalación...', ok: true }], false);
  try {
    const r = await agentFetch('/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: deploySelectedSerial }),
    });
    renderDeploySteps(r.steps || [], true, r.ok);
    toast(r.ok ? 'DS Player instalado ✓' : 'La instalación tuvo errores', r.ok ? 'success' : 'error');
  } catch (e) {
    renderDeployAgentDown();
  } finally {
    deployBusy = false;
  }
}

async function deployRunUninstall() {
  if (!deploySelectedSerial || deployBusy) return;
  deployBusy = true;
  renderDeploySteps([{ step: 'Iniciando desinstalación...', ok: true }], false);
  try {
    const r = await agentFetch('/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial: deploySelectedSerial }),
    });
    renderDeploySteps(r.steps || [], true, r.ok);
    toast(r.ok ? 'DS Player desinstalado ✓' : 'La desinstalación tuvo errores', r.ok ? 'success' : 'error');
  } catch (e) {
    renderDeployAgentDown();
  } finally {
    deployBusy = false;
  }
}

