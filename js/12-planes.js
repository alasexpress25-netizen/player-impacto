// ════════════════════════════════════════════════════════════════
//  PLANES — alta/edición/baja de los planes que muestra
//  publicidade.alastecno.com (tabla public.planes)
//  OJO: el precio que COBRA Mercado Pago sale del link/plan de MP,
//  no de esta tabla. Al cambiar un precio hay que crear el plan nuevo
//  en MP y pegar acá su link de checkout.
// ════════════════════════════════════════════════════════════════
let planesAdmin = [];
let planesSubsCount = {};   // plan_id -> cantidad de suscripciones
let editingPlanId = null;

function fmtBRLAdmin(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadPlanes() {
  const box = document.getElementById('planes-list');
  if (!box) return;
  box.innerHTML = '<div class="loading-center"><div class="spinner"></div> Cargando...</div>';

  const { data, error } = await sb.from('planes').select('*').order('orden');
  if (error) {
    box.innerHTML = `<div class="empty-state">No se pudieron cargar los planes: ${esc(error.message)}</div>`;
    return;
  }
  planesAdmin = data || [];

  // Cantidad de suscripciones por plan (para saber si se puede borrar)
  planesSubsCount = {};
  const { data: subs } = await sb.from('suscripciones').select('plan_id');
  (subs || []).forEach(s => { planesSubsCount[s.plan_id] = (planesSubsCount[s.plan_id] || 0) + 1; });

  renderPlanes();
}

function renderPlanes() {
  const box = document.getElementById('planes-list');
  if (!planesAdmin.length) {
    box.innerHTML = '<div class="empty-state">Todavía no hay planes. Creá el primero con “➕ Nuevo plan”.</div>';
    return;
  }
  box.innerHTML = planesAdmin.map(p => {
    const beneficios = (p.descripcion || '').split('·').map(b => b.trim()).filter(Boolean);
    const subs = planesSubsCount[p.id] || 0;
    const sinMp = !p.mp_checkout_url;
    return `
    <div class="card" style="${p.activo ? '' : 'opacity:.6;'}">
      <div class="card-header">
        <div>
          <div class="card-title">${esc(p.nombre)} · R$ ${fmtBRLAdmin(p.precio_brl)}<small style="font-weight:500;color:var(--text2);">/mês</small></div>
          <div class="card-sub">código: ${esc(p.codigo)} · orden ${p.orden} · ${subs} suscripción(es)</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <span class="badge ${p.activo ? 'badge-green' : ''}">${p.activo ? 'Visible en la web' : 'Oculto'}</span>
          ${sinMp ? '<span class="badge" style="background:rgba(255,160,0,.15);color:#ffa000;">Sin link de MP</span>' : ''}
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:12px;">
        ${beneficios.length ? beneficios.map(b => '✓ ' + esc(b)).join('<br>') : '<i>Sin beneficios cargados</i>'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="showPlanModal('${esc(p.id)}')">✏️ Editar</button>
        <button class="btn btn-ghost btn-sm" onclick="togglePlanActivo('${esc(p.id)}')">${p.activo ? '🙈 Ocultar' : '👁️ Mostrar'}</button>
        <button class="btn btn-danger btn-sm" onclick="deletePlan('${esc(p.id)}')">🗑️ Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function slugPlan(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ─── Crear / editar ────────────────────────────────────────────
function showPlanModal(id) {
  editingPlanId = id || null;
  const p = id ? planesAdmin.find(x => x.id === id) : null;
  if (id && !p) return;
  const beneficios = p ? (p.descripcion || '').split('·').map(b => b.trim()).filter(Boolean).join('\n') : '';
  const siguienteOrden = planesAdmin.length ? Math.max(...planesAdmin.map(x => x.orden || 0)) + 1 : 1;

  openModal(`
  <div class="modal-header">
    <div class="modal-title">${p ? '✏️ Editar plan' : '➕ Nuevo plan'}</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="field">
    <label>Nombre (como se ve en la web)</label>
    <input id="m-plan-nombre" value="${esc(p ? p.nombre : '')}" placeholder="Premium">
  </div>
  <div class="field">
    <label>Código interno ${p ? '(no se puede cambiar)' : '(se genera del nombre)'}</label>
    <input id="m-plan-codigo" value="${esc(p ? p.codigo : '')}" ${p ? 'disabled' : ''} placeholder="premium">
  </div>
  <div class="field">
    <label>Precio mensual (R$)</label>
    <input id="m-plan-precio" type="number" step="0.01" min="0" value="${p ? esc(p.precio_brl) : ''}" placeholder="450.00">
  </div>
  <div class="field">
    <label>Beneficios (uno por línea)</label>
    <textarea id="m-plan-desc" rows="6" placeholder="Spot de 15 a 30s&#10;Arte animada inclusa">${esc(beneficios)}</textarea>
  </div>
  <div class="field">
    <label>Link de checkout de Mercado Pago</label>
    <input id="m-plan-mpurl" value="${esc(p ? p.mp_checkout_url || '' : '')}" placeholder="https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=...">
  </div>
  <div class="field">
    <label>ID del plan en Mercado Pago (opcional)</label>
    <input id="m-plan-mpid" value="${esc(p ? p.mp_preapproval_plan_id || '' : '')}">
  </div>
  <div style="display:flex;gap:12px;">
    <div class="field" style="flex:1;">
      <label>Orden</label>
      <input id="m-plan-orden" type="number" step="1" value="${p ? p.orden : siguienteOrden}">
    </div>
    <div class="field" style="flex:1;">
      <label>Visible en la web</label>
      <select id="m-plan-activo">
        <option value="true" ${!p || p.activo ? 'selected' : ''}>Sí</option>
        <option value="false" ${p && !p.activo ? 'selected' : ''}>No</option>
      </select>
    </div>
  </div>
  <p style="font-size:12px;color:var(--text2);line-height:1.6;">
    ⚠️ Cambiar el precio acá actualiza la web y el contrato, pero <b>Mercado Pago sigue cobrando el valor de su propio plan</b>.
    Si cambiás el precio, creá el plan nuevo en MP y pegá su link arriba.
  </p>
  <div class="modal-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="savePlan()">Guardar</button>
  </div>`);
}

async function savePlan() {
  const nombre = document.getElementById('m-plan-nombre').value.trim();
  const precio = Number(document.getElementById('m-plan-precio').value);
  const orden  = parseInt(document.getElementById('m-plan-orden').value, 10);
  const lineas = document.getElementById('m-plan-desc').value.split('\n').map(l => l.replace(/·/g, '').trim()).filter(Boolean);
  const mpUrl  = document.getElementById('m-plan-mpurl').value.trim();
  const mpId   = document.getElementById('m-plan-mpid').value.trim();
  const activo = document.getElementById('m-plan-activo').value === 'true';

  if (!nombre) { toast('Ingresá el nombre del plan', 'error'); return; }
  if (!(precio >= 0) || document.getElementById('m-plan-precio').value === '') { toast('Ingresá un precio válido', 'error'); return; }
  if (Number.isNaN(orden)) { toast('Ingresá un orden válido', 'error'); return; }
  if (mpUrl && !/^https:\/\//i.test(mpUrl)) { toast('El link de MP debe empezar con https://', 'error'); return; }
  if (activo && !mpUrl && !confirm('Este plan quedaría visible sin link de Mercado Pago: el botón de la web no podría cobrar. ¿Guardar igual?')) return;

  const row = {
    nombre, precio_brl: precio, orden, activo,
    descripcion: lineas.join(' · '),
    mp_checkout_url: mpUrl || null,
    mp_preapproval_plan_id: mpId || null,
  };

  let error;
  if (editingPlanId) {
    const actual = planesAdmin.find(x => x.id === editingPlanId);
    if (actual && Number(actual.precio_brl) !== precio &&
        !confirm(`Vas a cambiar el precio de R$ ${fmtBRLAdmin(actual.precio_brl)} a R$ ${fmtBRLAdmin(precio)}.\n\nMercado Pago seguirá cobrando lo de su plan actual hasta que actualices el link de checkout. ¿Continuar?`)) return;
    ({ error } = await sb.from('planes').update(row).eq('id', editingPlanId));
  } else {
    const codigo = slugPlan(document.getElementById('m-plan-codigo').value || nombre);
    if (!codigo) { toast('No se pudo generar el código', 'error'); return; }
    if (planesAdmin.some(x => x.codigo === codigo)) { toast('Ya existe un plan con ese código', 'error'); return; }
    ({ error } = await sb.from('planes').insert({ ...row, codigo }));
  }

  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast('Plan guardado', 'success');
  closeModal();
  loadPlanes();
}

async function togglePlanActivo(id) {
  const p = planesAdmin.find(x => x.id === id);
  if (!p) return;
  const nuevo = !p.activo;
  if (nuevo && !p.mp_checkout_url && !confirm('Este plan no tiene link de Mercado Pago. ¿Mostrarlo igual en la web?')) return;
  const { error } = await sb.from('planes').update({ activo: nuevo }).eq('id', id);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  toast(nuevo ? 'Plan visible en la web' : 'Plan oculto de la web', 'success');
  loadPlanes();
}

async function deletePlan(id) {
  const p = planesAdmin.find(x => x.id === id);
  if (!p) return;
  const subs = planesSubsCount[id] || 0;
  if (subs > 0) {
    toast(`“${p.nombre}” tiene ${subs} suscripción(es): no se puede eliminar. Ocultalo en su lugar.`, 'error');
    return;
  }
  if (!confirm(`¿Eliminar el plan “${p.nombre}”? No se puede deshacer.`)) return;
  const { error } = await sb.from('planes').delete().eq('id', id);
  if (error) {
    toast(error.code === '23503' ? 'Tiene suscripciones: ocultalo en lugar de eliminarlo.' : 'Error: ' + error.message, 'error');
    return;
  }
  toast('Plan eliminado', 'success');
  loadPlanes();
}
