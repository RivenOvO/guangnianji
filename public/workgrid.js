// AG Grid-based "cloud spreadsheet" for work logs

let gridApi = null;
let originalById = new Map();
let createdRows = []; // rows without id

function todayStr(){
  const d = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function normalizeRow(r){
  return {
    id: r.id ?? null,
    work_date: r.work_date || todayStr(),
    user_name: r.user_name || '',
    project: r.project || '',
    content: r.content || '',
    blockers: r.blockers || '',
    hours: r.hours ?? null,
    tags: r.tags || ''
  };
}

async function initWorkGrid(){
  if(!window.agGrid){
    $('workErr').textContent = 'ag-grid 脚本未加载（window.agGrid 不存在）。请按 Ctrl+F5 强制刷新；如果仍不行，请在 Network 里确认 /vendor/ag-grid/ag-grid-community.min.js 返回 200，并把 Console 报错截图发我。';
    return;
  }
  const Grid = agGrid.Grid;
  const colDefs = [
    { field: 'work_date', headerName: '日期', editable: true, width: 120 },
    { field: 'user_name', headerName: '员工', editable: false, width: 120 },
    { field: 'project', headerName: '项目', editable: true, width: 140 },
    { field: 'content', headerName: '今日内容', editable: true, flex: 1, minWidth: 220 },
    { field: 'blockers', headerName: '阻塞/风险', editable: true, flex: 1, minWidth: 180 },
    { field: 'hours', headerName: '工时', editable: true, width: 100 },
    { field: 'tags', headerName: '标签', editable: true, width: 140 },
  ];

  const gridOptions = {
    columnDefs: colDefs,
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: true,
    },
    rowData: [],
    getRowId: params => params.data.id ? String(params.data.id) : undefined,
    onGridReady: (params) => {
      gridApi = params.api;
      gridApi.sizeColumnsToFit();
    },
    singleClickEdit: true,
    stopEditingWhenCellsLoseFocus: true,
    enableCellTextSelection: true,
    copyHeadersToClipboard: true,
    undoRedoCellEditing: true,
    undoRedoCellEditingLimit: 50,
  };

  const eGridDiv = document.getElementById('workGrid');
  eGridDiv.innerHTML = '';
  agGrid.createGrid(eGridDiv, gridOptions);

  await workRefresh();
}

async function workRefresh(){
  $('workErr').textContent = '';
  createdRows = [];
  originalById = new Map();
  try{
    const from = $('workFrom').value.trim();
    const to = $('workTo').value.trim();
    const qs = new URLSearchParams();
    if(from) qs.set('from', from);
    if(to) qs.set('to', to);
    const r = await api('/api/worklogs' + (qs.toString()?`?${qs}`:''));
    const rows = r.worklogs.map(normalizeRow);
    rows.forEach(row=>{ if(row.id) originalById.set(row.id, JSON.stringify(row)); });
    gridApi.setGridOption('rowData', rows);
    showToast('已刷新');
  }catch(e){
    $('workErr').textContent = '加载失败：' + (e.data?.error||e.message);
  }
}

function workAddRow(){
  $('workErr').textContent = '';
  if(!gridApi){
    $('workErr').textContent = '表格尚未初始化：请先点一次左侧「云表格（日报）」进入后等待 1-2 秒，或按 Ctrl+F5 强制刷新。若仍不行，把 Console 报错截图发我。';
    return;
  }
  const row = {
    id: null,
    work_date: todayStr(),
    user_name: me?.name || '',
    project: '',
    content: '',
    blockers: '',
    hours: null,
    tags: ''
  };
  createdRows.push(row);
  const current = [];
  gridApi.forEachNode(n => current.push(n.data));
  current.unshift(row);
  gridApi.setGridOption('rowData', current);
  showToast('已新增一行（未保存）');
}

function getDirtyPayloads(){
  const updates = [];
  const creates = [];
  gridApi.forEachNode(n => {
    const r = n.data;
    if(!r) return;
    // normalize
    const payload = {
      work_date: String(r.work_date||'').trim(),
      project: (r.project||'').trim() || null,
      content: String(r.content||'').trim(),
      blockers: (r.blockers||'').trim() || null,
      hours: r.hours === '' || r.hours == null ? null : Number(r.hours),
      tags: (r.tags||'').trim() || null,
    };

    if(!r.id){
      // only save if has content
      if(payload.content) creates.push(payload);
      return;
    }
    const before = originalById.get(r.id);
    const after = JSON.stringify(normalizeRow({ ...r, ...payload, id: r.id, user_name: r.user_name }));
    if(before && before !== after) updates.push({ id: r.id, payload });
  });
  return { creates, updates };
}

async function workSave(){
  $('workErr').textContent = '';
  try{
    const { creates, updates } = getDirtyPayloads();
    if(creates.length === 0 && updates.length === 0){
      showToast('没有改动');
      return;
    }

    // serialize requests (simple & safe)
    for(const c of creates){
      await api('/api/worklogs', { method:'POST', body: JSON.stringify(c) });
    }
    for(const u of updates){
      await api(`/api/worklogs/${u.id}`, { method:'PUT', body: JSON.stringify(u.payload) });
    }

    await workRefresh();
    showToast(`已保存：新增${creates.length}，更新${updates.length}`);
  }catch(e){
    $('workErr').textContent = '保存失败：' + (e.data?.error||e.message);
  }
}
