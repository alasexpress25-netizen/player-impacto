// ════════════════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════
let sb            = null;   // Supabase client
// Migrado de Hostinger a Cloudflare R2 — sube/borra/lista contra la
// edge function r2-media (Supabase), que firma URLs de R2 con AWS v4.
const R2_MEDIA_FN   = 'https://sdfwredxmyawvolxuifp.supabase.co/functions/v1/r2-media';
const R2_UPLOAD_TOKEN = '_7xnYoKahXsioGuQ2ClleJ_vFbj6B9XNIsGJRuk2LuA';
const COMPROBANTE_BASE_URL = 'https://alasexpress25-netizen.github.io/player-impacto/publicidade/comprobante.html'; // el comprobante ahora vive en /publicidade dentro del mismo repo (GitHub Pages)
let currentTab    = 'dashboard';
let allMedia      = [];     // cache local para el editor de playlist
let allClientes     = [];   // cache local de clientes/anunciantes
let allClientesById = {};   // lookup rápido id -> cliente
let allPlaylists  = [];     // cache local
let editingPlId   = null;   // playlist que se está editando
let editingPlItems = [];    // items actuales de la playlist que se edita
let dashboardTimer = null;

const CFG_KEY = 'ds_admin_cfg';

// ════════════════════════════════════════════════════════════════
//  CONFIG & SCREENS
// ════════════════════════════════════════════════════════════════
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; }
}
function saveConfig(c) {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════
async function init() {
  // Credenciales hardcodeadas — se salta la pantalla de configuración
  const HARDCODED = {
    supabaseUrl: 'https://sdfwredxmyawvolxuifp.supabase.co',
    anonKey:     'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZndyZWR4bXlhd3ZvbHh1aWZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzQ2NzgsImV4cCI6MjA5NTIxMDY3OH0.rzVLfYDRQYk2v7qCVHcBZgJM2nTTKbMfbJ61EHm4HV4',
  };
  saveConfig(HARDCODED);
  const cfg = HARDCODED;

  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

  // Intentar restaurar sesión existente
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    onLoginSuccess(session.user);
  } else {
    showScreen('login');
  }
}

function onLoginSuccess(user) {
  showScreen('app');
  const emailEl = document.getElementById('header-user-email');
  if (emailEl) emailEl.textContent = user.email || '';

  applySidebarModeForViewport();
  setActiveTab('dashboard');
  loadDashboard();
  // Auto-refresh dashboard cada 30s
  if (dashboardTimer) clearInterval(dashboardTimer);
  dashboardTimer = setInterval(() => {
    if (currentTab === 'dashboard') loadDashboard();
  }, 30000);
}

// ════════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════════
function handleConfigSave() {
  const url = document.getElementById('cfg-url').value.trim().replace(/\/$/, '');
  const key = document.getElementById('cfg-key').value.trim();
  if (!url || !key) { toast('Ingresá URL y Anon Key', 'error'); return; }
  if (!url.startsWith('https://')) { toast('La URL debe empezar con https://', 'error'); return; }
  saveConfig({ supabaseUrl: url, anonKey: key });
  init();
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const btn   = document.getElementById('btn-login');
  if (!email || !pass) { toast('Completá email y contraseña', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Ingresando...';

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

  btn.disabled = false;
  btn.textContent = 'Ingresar →';

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  onLoginSuccess(data.user);
}

async function handleLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  if (dashboardTimer) clearInterval(dashboardTimer);
  await sb.auth.signOut();
  showScreen('login');
}

