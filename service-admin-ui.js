(()=>{
  const managerRoles=new Set(['admin','owner','manager','service_manager']);
  const ownerAdminRoles=new Set(['admin','owner']);
  let currentUser=null;

  function ensureAdminUi(user){
    currentUser=user||currentUser;
    if(!managerRoles.has(currentUser?.role))return;
    const canManageUsers=ownerAdminRoles.has(currentUser?.role);
    if(!$('nav [data-view="admin"]')){
      const b=document.createElement('button');b.dataset.view='admin';b.textContent='Admin';$('nav').appendChild(b);b.onclick=()=>showView('admin');
    }
    if(!$('#admin')){
      const s=document.createElement('section');s.id='admin';s.className='view';s.hidden=true;$('main').appendChild(s);
    }
    const s=$('#admin');
    s.innerHTML=canManageUsers
      ? `<div class="row between wrap"><div><h1>Service Admin</h1><p class="muted">Staff accounts, roles, and recent system history.</p></div><button id="adminAddUser">+ Staff Account</button></div><div class="ops-detail-grid"><div class="card"><h2>Staff Accounts</h2><div id="adminUsers" class="list"></div></div><div class="card"><div class="row between wrap"><div><h2>Recent Audit History</h2><p class="muted">Customer, equipment, work order, invoice, payment, warranty and payment-method changes.</p></div><button class="secondary" id="adminRefreshAudit">Refresh</button></div><div id="adminAudit" class="list"></div></div></div>`
      : `<div><h1>Service Admin</h1><p class="muted">Recent service-system history. Staff account creation, role changes and password resets are owner/admin only.</p></div><div class="card"><div class="row between wrap"><div><h2>Recent Audit History</h2><p class="muted">Customer, equipment, work order, invoice, payment, warranty and payment-method changes.</p></div><button class="secondary" id="adminRefreshAudit">Refresh</button></div><div id="adminAudit" class="list"></div></div>`;
    if($('#adminAddUser'))$('#adminAddUser').onclick=openNewUser;
    if($('#adminRefreshAudit'))$('#adminRefreshAudit').onclick=loadAudit;
  }

  const d=document.createElement('dialog');d.id='adminUserDialog';d.innerHTML=`<form method="dialog" class="dialog-form" id="adminUserForm"><h2>New Staff Account</h2><label>Display name<input name="display_name" required></label><label>Username<input name="username" required></label><label>Temporary password<input name="password" type="password" minlength="10" required><span class="muted">At least 10 characters.</span></label><label>Role<select name="role"><option value="technician">Technician</option><option value="staff">Staff</option><option value="service_manager">Service Manager</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><div class="row end"><button value="cancel" class="secondary">Cancel</button><button id="adminSaveUser" value="default">Create Account</button></div></form>`;document.body.appendChild(d);
  function openNewUser(){if(!ownerAdminRoles.has(currentUser?.role))return;$('#adminUserForm').reset();d.showModal()}
  $('#adminSaveUser').onclick=async e=>{e.preventDefault();if(!ownerAdminRoles.has(currentUser?.role))return;try{const b=Object.fromEntries(new FormData($('#adminUserForm')));await api('/admin/users',{method:'POST',body:JSON.stringify(b)});d.close();await loadUsers()}catch(err){alert(err.message)}};

  async function loadUsers(){if(!ownerAdminRoles.has(currentUser?.role)||!$('#adminUsers'))return;try{const rows=await api('/admin/users');$('#adminUsers').innerHTML=rows.map(u=>`<div class="item"><div class="row between wrap"><div><b>${esc(u.display_name)}</b><div class="muted">${esc(u.username)} · ${esc(u.role)}</div></div><span class="pill">${u.active?'Active':'Disabled'}</span></div><div class="row wrap"><button class="secondary" data-admin-toggle="${u.id}" data-active="${u.active?'1':'0'}">${u.active?'Disable':'Enable'}</button><button class="secondary" data-admin-password="${u.id}">Reset Password</button></div></div>`).join('')||'<p class="muted">No staff accounts.</p>';$$('[data-admin-toggle]').forEach(b=>b.onclick=async()=>{try{await api(`/admin/users/${b.dataset.adminToggle}`,{method:'PATCH',body:JSON.stringify({active:b.dataset.active!=='1'})});loadUsers()}catch(e){alert(e.message)}});$$('[data-admin-password]').forEach(b=>b.onclick=async()=>{const p=prompt('Enter a new temporary password (10+ characters):','');if(!p)return;try{await api(`/admin/users/${b.dataset.adminPassword}/password`,{method:'PATCH',body:JSON.stringify({password:p})});alert('Password updated.')}catch(e){alert(e.message)}})}catch(e){$('#adminUsers').innerHTML=`<p class="error">${esc(e.message)}</p>`}}

  async function loadAudit(){try{const rows=await api('/admin/audit?limit=100');$('#adminAudit').innerHTML=rows.map(a=>{const record=a.new_data||a.old_data||{};const person=[record.first_name,record.last_name].filter(Boolean).join(' ');const label=record.work_order_number||record.invoice_number||person||record.description||`Record ${a.record_id||''}`;return `<div class="item"><div class="row between wrap"><b>${esc(a.action)} · ${esc(a.table_name.replace(/^service_/,''))}</b><span class="muted">${dt(a.created_at)}</span></div><div>${esc(label)}</div></div>`}).join('')||'<p class="muted">No audit history yet.</p>'}catch(e){$('#adminAudit').innerHTML=`<p class="error">${esc(e.message)}</p>`}}

  async function loadAdmin(){ensureAdminUi(currentUser);await Promise.all([loadUsers(),loadAudit()])}

  const baseShowView=showView;
  showView=function(id){if(id==='admin'){ensureAdminUi(currentUser);$$('.view').forEach(v=>v.hidden=v.id!=='admin');$$('nav [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view==='admin'));loadAdmin();return}baseShowView(id)};
  const baseShowApp=showApp;
  showApp=function(user){currentUser=user;baseShowApp(user);ensureAdminUi(user)};
  if(token){api('/me').then(x=>{currentUser=x.user;ensureAdminUi(currentUser)}).catch(()=>{})}
})();