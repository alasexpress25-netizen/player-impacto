// ════════════════════════════════════════════════════════════════
//  MODAL UTILITIES
// ════════════════════════════════════════════════════════════════
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  document.body.style.overflow = '';
  // Si había un player de "Video en vivo" corriendo, lo detenemos también
  if (typeof vivoPlayerTimer !== 'undefined') clearTimeout(vivoPlayerTimer);
  const vivoVideo = document.querySelector('#vivo-stage video');
  if (vivoVideo) vivoVideo.pause();
  // Detiene cualquier <video>/<audio> que haya quedado reproduciendo dentro
  // del modal (ej. el preview de Media) — pausar solo no basta porque el
  // navegador puede seguir bufferizando/consumiendo red; se limpia el src.
  document.querySelectorAll('#modal-content video, #modal-content audio').forEach(el => {
    el.pause();
    el.removeAttribute('src');
    el.load();
  });
  document.getElementById('modal-content').innerHTML = '';
}
function handleModalOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ════════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const icons = { success: '✓', error: '⚠️', info: 'ℹ' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function timeAgo(ts) {
  if (!ts) return 'nunca';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)   return 'hace ' + diffSec + 's';
  if (diffSec < 3600) return 'hace ' + Math.floor(diffSec / 60) + ' min';
  if (diffSec < 86400) return 'hace ' + Math.floor(diffSec / 3600) + ' h';
  return 'hace ' + Math.floor(diffSec / 86400) + ' días';
}

function sanitizeFilename(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

// ════════════════════════════════════════════════════════════════
//  REGISTRAR PANTALLA (con escáner QR)
// ════════════════════════════════════════════════════════════════
function showRegisterScreenModal() {
  const html = `
  <div class="modal-header">
    <div class="modal-title">➕ Registrar pantalla</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="uuid-scan-row" style="margin-bottom:16px;">
    <div class="field" style="margin-bottom:0">
      <label>UUID de la pantalla</label>
      <input id="m-reg-uuid" type="text" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
             autocomplete="off" spellcheck="false"
             style="font-family:monospace;font-size:13px;">
    </div>
    <button class="btn-scan" title="Escanear QR de la pantalla" onclick="openScanner('m-reg-uuid')">📷</button>
  </div>
  <div class="field">
    <label>Nombre / Ubicación</label>
    <input id="m-reg-nombre" placeholder="Ej: Recepción piso 2">
  </div>
  <div class="field">
    <label>Grupo base</label>
    <select id="m-reg-grupo">
      <option value="A">Grupo A</option>
      <option value="B">Grupo B</option>
      <option value="C">Grupo C</option>
    </select>
  </div>
  <div class="field">
    <label>Ciudad</label>
    <input id="m-reg-ciudad" placeholder="Ej: Buenos Aires">
  </div>
  <div style="display:flex;gap:10px;">
    <div class="field" style="flex:1">
      <label>Latitud</label>
      <input id="m-reg-lat" placeholder="-34.61">
    </div>
    <div class="field" style="flex:1">
      <label>Longitud</label>
      <input id="m-reg-lon" placeholder="-58.38">
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="registerScreen()">💾 Registrar</button>
  </div>`;
  openModal(html);
}

async function registerScreen() {
  const uuid   = document.getElementById('m-reg-uuid')?.value.trim();
  const nombre = document.getElementById('m-reg-nombre')?.value.trim();
  const grupo  = document.getElementById('m-reg-grupo')?.value;
  const ciudad = document.getElementById('m-reg-ciudad')?.value.trim();
  const lat    = document.getElementById('m-reg-lat')?.value.trim();
  const lon    = document.getElementById('m-reg-lon')?.value.trim();

  if (!uuid)   { toast('El UUID es obligatorio', 'error'); return; }
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  if (!isUUID(uuid)) { toast('UUID inválido. Usá el formato correcto o escaneá el QR', 'error'); return; }

  const payload = {
    uuid,
    nombre,
    grupo_base:  grupo,
    ciudad:      ciudad || null,
    lat:         lat ? parseFloat(lat) : null,
    lon:         lon ? parseFloat(lon) : null,
  };

  const { error } = await sb.from('screens').insert(payload);
  if (error) { toast('Error al registrar: ' + error.message, 'error'); return; }

  toast('Pantalla registrada ✓', 'success');
  closeModal();
  loadDashboard();
}

// ════════════════════════════════════════════════════════════════
//  QR SCANNER
// ════════════════════════════════════════════════════════════════
let scanStream  = null;
let scanRafId   = null;
let scanCanvas  = null;
let scanCtx     = null;
let scanTargetId = null;

function openScanner(targetInputId) {
  scanTargetId = targetInputId || 'm-reg-uuid';
  const modal  = document.getElementById('scanner-modal');
  const video  = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');

  status.textContent = 'Iniciando cámara…';
  status.className   = 'scanner-status';
  modal.classList.add('open');

  scanCanvas = document.createElement('canvas');
  scanCtx    = scanCanvas.getContext('2d', { willReadFrequently: true });

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
  }).then(stream => {
    scanStream = stream;
    video.srcObject = stream;
    video.play();
    status.textContent = 'Buscando QR…';
    video.addEventListener('loadedmetadata', startScanLoop, { once: true });
  }).catch(err => {
    status.textContent = 'Error de cámara: ' + err.message;
    tryBarcodeDetector(video, status);
  });
}

function startScanLoop() {
  const video  = document.getElementById('scanner-video');
  const status = document.getElementById('scanner-status');

  function tick() {
    if (!scanStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      scanCanvas.width  = video.videoWidth;
      scanCanvas.height = video.videoHeight;
      scanCtx.drawImage(video, 0, 0);
      const imgData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
      if (code && isUUID(code.data)) {
        onQrDetected(code.data, status);
        return;
      }
    }
    scanRafId = requestAnimationFrame(tick);
  }
  scanRafId = requestAnimationFrame(tick);
}

function tryBarcodeDetector(video, status) {
  if (!('BarcodeDetector' in window)) return;
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  status.textContent = 'Usando BarcodeDetector…';
  function poll() {
    if (!scanStream) return;
    detector.detect(video).then(codes => {
      for (const c of codes) {
        if (isUUID(c.rawValue)) { onQrDetected(c.rawValue, status); return; }
      }
      setTimeout(poll, 300);
    }).catch(() => setTimeout(poll, 500));
  }
  poll();
}

function onQrDetected(uuid, status) {
  status.textContent = '✅ QR detectado: ' + uuid;
  status.className   = 'scanner-status found';
  const input = document.getElementById(scanTargetId);
  if (input) input.value = uuid;
  toast('UUID escaneado ✓', 'success');
  setTimeout(closeScanner, 800);
}

function closeScanner() {
  cancelAnimationFrame(scanRafId);
  if (scanStream) {
    scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
  }
  const video = document.getElementById('scanner-video');
  if (video) video.srcObject = null;
  document.getElementById('scanner-modal').classList.remove('open');
}

document.getElementById('scanner-modal').addEventListener('click', function(e) {
  if (e.target === this) closeScanner();
});

function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((str || '').trim());
}

