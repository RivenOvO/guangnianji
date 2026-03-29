let token = localStorage.getItem('token') || '';
let me = null;

const $ = (id) => document.getElementById(id);

function showToast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(()=>{ t.style.display = 'none'; }, 2500);
}

async function api(path, opts={}){
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers||{}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw Object.assign(new Error(data.error||'api_error'), { status: res.status, data });
  return data;
}

function setActiveTab(key){
  document.querySelectorAll('.nav').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.style.display='none');
  document.querySelector(`.nav[data-tab="${key}"]`)?.classList.add('active');
  $('tab-'+key).style.display='block';
}

async function refreshMe(){
  const r = await api('/api/me');
  me = r.user;
  $('me').textContent = `${me.name} (${me.role})`;
  $('logoutBtn').style.display = 'inline-block';

  // role-based UI
  // 前端先按“权限角色”粗略控制；精确权限以服务端为准。
  $('newEmpBtn').style.display = me.role === 'admin' ? 'inline-block' : 'none';
  $('auditTab').style.display = me.role === 'admin' ? 'block' : 'none';
  $('newAnnBtn').style.display = me.role === 'admin' ? 'inline-block' : 'none';
}

async function loadAnnouncements(){
  const r = await api('/api/announcements');
  const el = $('annList');
  el.innerHTML = '';
  r.announcements.forEach(a=>{
    const div = document.createElement('div');
    div.className = 'item';

    const canDelete = me && (me.role === 'admin' || me.role === 'manager');

    div.innerHTML = `<div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <div><b>${escapeHtml(a.title)}</b> <span class="muted">#${a.id}</span></div>
          <div style="margin-top:8px;white-space:pre-wrap">${escapeHtml(a.content)}</div>
          <div class="meta">${a.created_at} · ${escapeHtml(a.created_by_name||'') }</div>
        </div>
        ${canDelete ? `<button class="btn ghost" data-ann-del="${a.id}">删除</button>` : ''}
      </div>`;

    el.appendChild(div);
  });
}

async function loadEmployees(){
  const r = await api('/api/employees');
  const el = $('empList');
  el.innerHTML = '';
  r.employees.forEach(e=>{
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div><b>${escapeHtml(e.name||'')}</b> <span class="muted">${escapeHtml(e.email||'')}</span></div>
      <div class="meta">岗位: ${escapeHtml(e.position||'')} · dept: ${escapeHtml(e.dept||'')} · title: ${escapeHtml(e.title||'')} · phone: ${escapeHtml(e.phone||'')} · emp_no: ${escapeHtml(e.emp_no||'')} · joined: ${escapeHtml(e.joined_at||'')}</div>
      <div class="meta">user_id: ${e.user_id}</div>`;
    el.appendChild(div);
  });
}

async function loadApprovals(){
  const mine = $('apMine').checked ? '1' : '0';
  const r = await api('/api/approvals?mine='+mine);
  const el = $('apList');
  el.innerHTML = '';
  r.approvals.forEach(a=>{
    const div = document.createElement('div');
    div.className = 'item';
    const canDecide = me && a.status === 'pending' && a.assignee_id === me.id;
    div.innerHTML = `<div><b>[${escapeHtml(a.type)}]</b> ${escapeHtml(a.title)} <span class="muted">#${a.id}</span></div>
      <div style="margin-top:8px;white-space:pre-wrap">${escapeHtml(a.content)}</div>
      <div class="meta">status: <b>${escapeHtml(a.status)}</b>${a.amount!=null?` · amount: ${a.amount}`:''}</div>
      <div class="meta">created_by: ${escapeHtml(a.created_by_name||'')} · assignee: ${escapeHtml(a.assignee_name||'')} · created_at: ${a.created_at}</div>
      ${canDecide ? `<div class="row">
          <button class="btn" data-act="approve" data-id="${a.id}">批准</button>
          <button class="btn ghost" data-act="reject" data-id="${a.id}">驳回</button>
        </div>` : ''}
      ${a.decision_note ? `<div class="meta">note: ${escapeHtml(a.decision_note)}</div>` : ''}
    `;
    el.appendChild(div);
  });
}

async function loadAudit(){
  const r = await api('/api/audit');
  const el = $('auditList');
  el.innerHTML = '';
  r.logs.forEach(l=>{
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div><b>${escapeHtml(l.action)}</b></div>
      <div class="meta">${l.created_at} · ${escapeHtml(l.name||'')} ${escapeHtml(l.email||'')}</div>
      <div class="meta">${escapeHtml(JSON.stringify(l.meta||{}))}</div>`;
    el.appendChild(div);
  });
}

function escapeHtml(str){
  return String(str ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function authed(show){
  $('loginView').style.display = show ? 'none' : 'block';
  $('appView').style.display = show ? 'block' : 'none';
  $('logoutBtn').style.display = show ? 'inline-block' : 'none';
}

async function boot(){
  // nav events
  document.querySelectorAll('.nav').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const key = btn.getAttribute('data-tab');
      setActiveTab(key);
      if(key==='ann') await loadAnnouncements();
      if(key==='emp') await loadEmployees();
      if(key==='work') await initWorkGrid();
      if(key==='ap') await loadApprovals();
      if(key==='audit') await loadAudit();
    })
  });

  // login
  $('loginBtn').addEventListener('click', async ()=>{
    $('loginErr').textContent='';
    try{
      const email = $('loginEmail').value.trim();
      const password = $('loginPassword').value;
      const r = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
      token = r.token;
      localStorage.setItem('token', token);
      authed(true);
      await refreshMe();
      setActiveTab('ann');
      await loadAnnouncements();
      showToast('登录成功');
    }catch(e){
      $('loginErr').textContent = `登录失败：${e.data?.error || e.message}`;
    }
  });

  $('logoutBtn').addEventListener('click', ()=>{
    token=''; me=null;
    localStorage.removeItem('token');
    authed(false);
    $('me').textContent='';
  })

  // announcements form
  $('newAnnBtn').addEventListener('click', ()=>{ $('annForm').style.display='block'; })
  $('annCancel').addEventListener('click', ()=>{ $('annForm').style.display='none'; })
  $('annSubmit').addEventListener('click', async ()=>{
    try{
      await api('/api/announcements', { method:'POST', body: JSON.stringify({ title: $('annTitle').value, content: $('annContent').value }) });
      $('annForm').style.display='none';
      $('annTitle').value=''; $('annContent').value='';
      await loadAnnouncements();
      showToast('公告已发布');
    }catch(e){
      showToast('发布失败：'+(e.data?.error||e.message));
    }
  })

  $('annList').addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button[data-ann-del]');
    if(!btn) return;
    const id = btn.getAttribute('data-ann-del');
    if(!confirm(`确定删除公告 #${id} 吗？`)) return;
    try{
      await api(`/api/announcements/${id}`, { method:'DELETE' });
      await loadAnnouncements();
      showToast('已删除');
    }catch(e){
      showToast('删除失败：'+(e.data?.error||e.message));
    }
  });

  // employees form
  $('newEmpBtn').addEventListener('click', ()=>{ $('empForm').style.display='block'; })
  $('empCancel').addEventListener('click', ()=>{ $('empForm').style.display='none'; $('empErr').textContent=''; })
  $('empSubmit').addEventListener('click', async ()=>{
    $('empErr').textContent='';
    try{
      const body = {
        name: $('empName').value,
        email: $('empEmail').value,
        role: 'employee',
        password: $('empPassword').value || 'changeme123',
        emp_no: $('empNo').value,
        dept: $('empDept').value,
        title: $('empTitle').value,
        position: $('empPosition').value,
        phone: $('empPhone').value,
        joined_at: $('empJoined').value,
      };
      await api('/api/employees', { method:'POST', body: JSON.stringify(body) });
      $('empForm').style.display='none';
      await loadEmployees();
      showToast('员工已创建');
    }catch(e){
      $('empErr').textContent = '创建失败：' + (e.data?.error||e.message);
    }
  })

  // work grid events
  $('workRefresh').addEventListener('click', workRefresh);
  $('workAddRow').addEventListener('click', workAddRow);
  $('workSave').addEventListener('click', workSave);

  // approvals form
  $('newApBtn').addEventListener('click', ()=>{ $('apForm').style.display='block'; })
  $('apCancel').addEventListener('click', ()=>{ $('apForm').style.display='none'; $('apErr').textContent=''; })
  $('apSubmit').addEventListener('click', async ()=>{
    $('apErr').textContent='';
    try{
      const amountStr = $('apAmount').value.trim();
      const body = {
        type: 'leave',
        title: $('apTitle').value,
        content: $('apContent').value,
        amount: amountStr ? Number(amountStr) : null,
        assignee_id: Number($('apAssignee').value)
      };
      await api('/api/approvals', { method:'POST', body: JSON.stringify(body) });
      $('apForm').style.display='none';
      await loadApprovals();
      showToast('已发起申请');
    }catch(e){
      $('apErr').textContent = '提交失败：' + (e.data?.error||e.message);
    }
  })

  $('apRefresh').addEventListener('click', loadApprovals);
  $('apMine').addEventListener('change', loadApprovals);

  // decision buttons
  $('apList').addEventListener('click', async (ev)=>{
    const btn = ev.target.closest('button[data-act]');
    if(!btn) return;
    const id = btn.getAttribute('data-id');
    const act = btn.getAttribute('data-act');
    const decision = act === 'approve' ? 'approved' : 'rejected';
    const note = prompt('备注（可留空）：') || '';
    try{
      await api(`/api/approvals/${id}/decision`, { method:'POST', body: JSON.stringify({ decision, note }) });
      await loadApprovals();
      showToast('已处理');
    }catch(e){
      showToast('处理失败：'+(e.data?.error||e.message));
    }
  })

  $('auditRefresh').addEventListener('click', loadAudit);

  // if token exists, auto login
  if(token){
    try{
      authed(true);
      await refreshMe();
      setActiveTab('ann');
      await loadAnnouncements();
    }catch{
      token=''; localStorage.removeItem('token');
      authed(false);
    }
  }
}

boot();
