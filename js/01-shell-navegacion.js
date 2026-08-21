// ════════════════════════════════════════════════════════════════
//  SIDEBAR MÓVIL — esconder/mostrar con badge dorado
// ════════════════════════════════════════════════════════════════
const SIDEBAR_MOBILE_BREAKPOINT = 900;

function toggleSidebarMobile(collapse) {
  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('app-content');
  const badge   = document.getElementById('sidebar-reopen-badge');
  if (!sidebar || !content || !badge) return;

  sidebar.classList.toggle('mobile-collapsed', collapse);
  content.classList.toggle('sidebar-collapsed', collapse);
  badge.classList.toggle('visible', collapse && window.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT);

  try { localStorage.setItem('sidebarMobileCollapsed', collapse ? '1' : '0'); } catch (e) {}
}

function applySidebarModeForViewport() {
  const sidebar = document.getElementById('sidebar');
  const content = document.getElementById('app-content');
  const badge   = document.getElementById('sidebar-reopen-badge');
  if (!sidebar || !content || !badge) return;

  if (window.innerWidth > SIDEBAR_MOBILE_BREAKPOINT) {
    // Desktop: el menú siempre visible, sin badge.
    sidebar.classList.remove('mobile-collapsed');
    content.classList.remove('sidebar-collapsed');
    badge.classList.remove('visible');
    return;
  }

  // Móvil: recuperamos la última preferencia (default: escondido).
  let collapsed = true;
  try { collapsed = localStorage.getItem('sidebarMobileCollapsed') !== '0'; } catch (e) {}
  sidebar.classList.toggle('mobile-collapsed', collapsed);
  content.classList.toggle('sidebar-collapsed', collapsed);
  badge.classList.toggle('visible', collapsed);
}

window.addEventListener('resize', applySidebarModeForViewport);

// ════════════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ════════════════════════════════════════════════════════════════
async function setActiveTab(tab) {
  // Si el editor de playlist está abierto, autoguardamos (nombre/grupo/loop)
  // y lo cerramos antes de navegar, para no perder cambios sin querer.
  const plEditorEl = document.getElementById('pl-editor');
  if (plEditorEl && plEditorEl.classList.contains('active') && editingPlId) {
    await autoSaveAndCloseEditor();
  }

  currentTab = tab;
  document.querySelectorAll('.side-link').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.side-graphic-tile').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + tab);
  });
  // Cargar datos al cambiar tab
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'media')     loadMedia();
  if (tab === 'playlists') loadPlaylists();
  if (tab === 'alertas')   loadAlertas();
  if (tab === 'capturas')  loadCapturas();
  if (tab === 'videovivo') loadVideoVivo();
  if (tab === 'videoprioritario') loadVideoPrioritario();

  // En móvil, cerramos el menú lateral tras elegir una sección para dejar
  // más espacio a la pantalla.
  if (window.innerWidth <= SIDEBAR_MOBILE_BREAKPOINT) toggleSidebarMobile(true);
}

