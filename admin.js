(() => {
  'use strict';

  const STORAGE_KEY = 'terminalManagementSystem.v1';
  const SESSION_KEY = 'tms.session.v1';

  const $ = (sel) => document.querySelector(sel);
  const terminalsList = $('#terminalsList');
  const historyList = $('#historyList');
  const emptyTerminals = $('#emptyTerminals');
  const emptyHistory = $('#emptyHistory');
  const statOut = $('#statOut');
  const statToday = $('#statToday');
  const statInventory = $('#statInventory');
  const inventoryList = $('#inventoryList');
  const emptyInventory = $('#emptyInventory');
  const importBtn = $('#importBtn');
  const importFileInput = $('#importFileInput');
  const importStatus = $('#importStatus');

  // ---------- Confirm dialog ----------
  const confirmModal = $('#confirmModal');
  const confirmText = $('#confirmText');
  const confirmOk = $('#confirmOk');
  const confirmCancel = $('#confirmCancel');
  let pendingConfirm = null;

  function confirmAction(text, onConfirm, okLabel = 'מחק', highlightName = '') {
    confirmText.textContent = '';
    const idx = highlightName ? text.indexOf(highlightName) : -1;
    if (idx >= 0) {
      const mark = document.createElement('strong');
      mark.className = 'confirm-highlight';
      mark.textContent = highlightName;
      confirmText.append(text.slice(0, idx), mark, text.slice(idx + highlightName.length));
    } else {
      confirmText.textContent = text;
    }
    confirmOk.textContent = okLabel;
    pendingConfirm = onConfirm;
    confirmModal.classList.remove('hidden');
  }

  function closeConfirm() {
    pendingConfirm = null;
    confirmModal.classList.add('hidden');
  }

  confirmOk.addEventListener('click', () => {
    const fn = pendingConfirm;
    closeConfirm();
    if (fn) fn();
  });

  confirmCancel.addEventListener('click', closeConfirm);

  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirm();
  });

  const signatureModal = $('#signatureModal');
  const sigViewTitle = $('#sigViewTitle');
  const sigViewMeta = $('#sigViewMeta');
  const sigViewImage = $('#sigViewImage');
  const sigViewEmpty = $('#sigViewEmpty');
  const sigViewClose = $('#sigViewClose');

  function loadState() {
    let data = {};
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {}
    if (!Array.isArray(data.meds)) data.meds = [];
    if (!Array.isArray(data.history)) data.history = [];
    if (!Array.isArray(data.inventory)) data.inventory = [];
    if (!Array.isArray(data.employees)) data.employees = [];
    if (!Array.isArray(data.removedEmployees)) data.removedEmployees = [];
    return data;
  }

  function saveState(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function buildTerminalIconSVG() {
    return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect x="12" y="4" width="24" height="40" rx="4" fill="#dce3e9" stroke="#2b3944" stroke-width="1.6"/>
      <rect x="16" y="9" width="16" height="11" rx="1.5" fill="#3c4d5c"/>
      <rect x="16" y="24" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="21.75" y="24" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="27.5" y="24" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="16" y="30" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="21.75" y="30" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="27.5" y="30" width="4.5" height="4" rx="1" fill="#a9b8c4"/>
      <rect x="16" y="36" width="16" height="4" rx="1" fill="#8fa3b3"/>
    </svg>`;
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `${date} בשעה ${time}`;
  }

  // code → employee record, so old records saved without a name still show the employee's details
  let employeeByCode = new Map();

  function refreshEmployeeNames(state) {
    employeeByCode = new Map();
    state.employees.forEach((e) => {
      if (e.code) employeeByCode.set(e.code, e);
    });
  }

  function employeeName(emp) {
    if (!emp || (!emp.name && !emp.code)) return 'מחלקה לא מזוהה';
    const rec = emp.code && employeeByCode.get(emp.code);
    return emp.name || (rec && rec.name) || 'מחלקה לא מזוהה';
  }

  function employeeLabel(emp) {
    return employeeName(emp);
  }

  function openSignatureView(title, meta, signature) {
    sigViewTitle.textContent = title;
    sigViewMeta.textContent = meta;
    if (signature) {
      sigViewImage.src = signature;
      sigViewImage.classList.remove('hidden');
      sigViewEmpty.classList.add('hidden');
    } else {
      sigViewImage.removeAttribute('src');
      sigViewImage.classList.add('hidden');
      sigViewEmpty.classList.remove('hidden');
    }
    signatureModal.classList.remove('hidden');
  }

  function closeSignatureView() {
    signatureModal.classList.add('hidden');
  }

  function render() {
    const state = loadState();
    syncEmployeesFromActivity(state);
    refreshEmployeeNames(state);
    renderAllTerminals(state);
    renderStats(state);
    renderTerminals(state);
    renderHistory(state);
    renderInventory(state);
    renderReports(state);
    renderEmployees(state);
  }

  // ---------- Employees ----------
  const employeesTbody = $('#employeesTbody');
  const employeesTable = $('#employeesTable');
  const emptyEmployees = $('#emptyEmployees');
  const importEmpBtn = $('#importEmpBtn');
  const importEmpFileInput = $('#importEmpFileInput');
  const addEmployeeForm = $('#addEmployeeForm');
  const newEmpName = $('#newEmpName');
  const newEmpCode = $('#newEmpCode');
  const empStatus = $('#empStatus');

  // Employees who took/returned terminals are added to the list automatically,
  // except those a manager deleted (removedEmployees) — they stay out until re-added manually
  function syncEmployeesFromActivity(state) {
    const known = new Set(state.employees.map((e) => `${e.code}|${e.name}`));
    const removedCodes = new Set(state.removedEmployees.map((r) => r.code).filter(Boolean));
    const removedKeys = new Set(state.removedEmployees.map((r) => `${r.code}|${r.name}`));
    let changed = false;
    const seen = [];
    state.meds.forEach((m) => m.employee && seen.push(m.employee));
    state.history.forEach((h) => h.employee && seen.push(h.employee));
    seen.forEach((emp) => {
      const code = (emp.code || '').trim();
      const name = (emp.name || '').trim();
      if (!code && !name) return;
      if ((code && removedCodes.has(code)) || removedKeys.has(`${code}|${name}`)) return;
      const byCode = code && state.employees.some((e) => e.code === code);
      if (byCode || known.has(`${code}|${name}`)) return;
      known.add(`${code}|${name}`);
      state.employees.push({ id: uid(), code, name, active: true, addedAt: Date.now() });
      changed = true;
    });
    if (changed) saveState(state);
  }

  // A manually re-added employee should no longer be blocked by an old deletion
  function clearRemovalMark(data, code, name) {
    data.removedEmployees = data.removedEmployees.filter(
      (r) => !(code && r.code === code) && `${r.code}|${r.name}` !== `${code}|${name}`
    );
  }

  function buildTrashIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>`;
  }

  function buildPersonIconSVG() {
    return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="21" fill="#dce3e9" stroke="#2b3944" stroke-width="1.6"/>
      <circle cx="24" cy="19" r="7" fill="#3c4d5c"/>
      <path d="M 10 40 a 14 11 0 0 1 28 0 Z" fill="#3c4d5c"/>
    </svg>`;
  }

  function showEmpStatus(text, isError) {
    empStatus.textContent = text;
    empStatus.classList.remove('hidden');
    empStatus.classList.toggle('error', !!isError);
  }

  addEmployeeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = newEmpName.value.trim();
    const code = newEmpCode.value.trim();
    if (!name && !code) {
      showEmpStatus('יש להזין שם או קוד מחלקה', true);
      return;
    }
    const data = loadState();
    if (code && data.employees.some((emp) => emp.code === code)) {
      showEmpStatus(`קוד מחלקה ${code} כבר קיים ברשימה`, true);
      return;
    }
    clearRemovalMark(data, code, name);
    data.employees.push({ id: uid(), code, name, active: true, addedAt: Date.now() });
    saveState(data);
    addEmployeeForm.reset();
    showEmpStatus(`המחלקה ${name || code} נוספה לרשימה`, false);
    render();
  });

  function renderEmployees(state) {
    employeesTbody.innerHTML = '';
    const hasEmployees = state.employees.length > 0;
    employeesTable.classList.toggle('hidden', !hasEmployees);
    emptyEmployees.classList.toggle('hidden', hasEmployees);
    if (!hasEmployees) return;

    const holdingByEmp = new Map();
    state.meds.forEach((m) => {
      const key = empKey(m.employee);
      holdingByEmp.set(key, (holdingByEmp.get(key) || 0) + 1);
    });

    const sorted = [...state.employees].sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code, 'he'));

    sorted.forEach((emp) => {
      const tr = document.createElement('tr');
      if (emp.active === false) tr.className = 'inactive';

      const nameTd = document.createElement('td');
      nameTd.className = 'cell-name';
      nameTd.textContent = emp.name || 'ללא שם';

      const codeTd = document.createElement('td');
      codeTd.className = 'cell-num';
      codeTd.textContent = emp.code || '—';

      const holdsTd = document.createElement('td');
      holdsTd.className = 'cell-num';
      holdsTd.textContent = holdingByEmp.get(`${emp.code || ''}|${emp.name || ''}`) || 0;

      const statusTd = document.createElement('td');
      statusTd.className = 'cell-status';

      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'switch';
      toggle.checked = emp.active !== false;
      toggle.setAttribute('aria-label', `מחלקה ${emp.active === false ? 'לא פעילה' : 'פעילה'}`);
      toggle.addEventListener('change', () => {
        const data = loadState();
        const rec = data.employees.find((x) => x.id === emp.id);
        if (rec) {
          rec.active = toggle.checked;
          saveState(data);
        }
        render();
      });

      const statusLabel = document.createElement('span');
      statusLabel.className = 'status-chip' + (emp.active === false ? ' inactive-chip' : '');
      statusLabel.textContent = emp.active === false ? 'לא פעיל' : 'פעיל';

      statusTd.append(toggle, statusLabel);

      const delTd = document.createElement('td');
      delTd.className = 'cell-actions';
      const del = document.createElement('button');
      del.className = 'history-delete';
      del.setAttribute('aria-label', 'הסר מחלקה');
      del.innerHTML = buildTrashIconSVG();
      del.addEventListener('click', () => {
        const label = emp.name || `קוד ${emp.code}`;
        confirmAction(`להסיר את ${label} מרשימת המחלקות?`, () => {
          const data = loadState();
          data.employees = data.employees.filter((x) => x.id !== emp.id);
          data.removedEmployees.push({ code: emp.code || '', name: emp.name || '' });
          saveState(data);
          render();
        }, 'הסר', label);
      });
      delTd.append(del);

      tr.append(nameTd, codeTd, holdsTd, statusTd, delTd);
      employeesTbody.append(tr);
    });
  }

  // ---------- Employees import from Excel ----------
  function isEmpHeaderRow(row) {
    const joined = row.join(' ');
    return /שם|קוד|עובד|מחלקה|name|code|employee|department|dept/i.test(joined) && !/\d{3,}/.test(joined);
  }

  function importEmployeeRows(rows) {
    const data = loadState();
    const existingCodes = new Set(data.employees.map((e) => e.code).filter(Boolean));
    const existingNames = new Set(data.employees.map((e) => `${e.code}|${e.name}`));
    let added = 0;
    let skipped = 0;
    rows.forEach((row, idx) => {
      const name = (row[0] || '').toString().trim();
      const code = (row[1] || '').toString().trim();
      if (!name && !code) return;
      if (idx === 0 && isEmpHeaderRow(row)) return;
      if ((code && existingCodes.has(code)) || existingNames.has(`${code}|${name}`)) {
        skipped++;
        return;
      }
      if (code) existingCodes.add(code);
      existingNames.add(`${code}|${name}`);
      clearRemovalMark(data, code, name);
      data.employees.push({ id: uid(), code, name, active: true, addedAt: Date.now() });
      added++;
    });
    saveState(data);
    return { added, skipped };
  }

  importEmpBtn.addEventListener('click', () => importEmpFileInput.click());

  importEmpFileInput.addEventListener('change', async () => {
    const file = importEmpFileInput.files && importEmpFileInput.files[0];
    importEmpFileInput.value = '';
    if (!file) return;
    showEmpStatus('קורא את הקובץ...', false);
    try {
      const rows = await parseImportFile(file);
      const { added, skipped } = importEmployeeRows(rows);
      let msg = added > 0 ? `נוספו ${added} מחלקות לרשימה` : 'לא נוספו מחלקות חדשות';
      if (skipped > 0) msg += ` · ${skipped} דולגו (מחלקה שכבר קיימת)`;
      showEmpStatus(msg, added === 0);
      render();
    } catch (err) {
      showEmpStatus('שגיאה בקריאת הקובץ: ' + (err && err.message ? err.message : 'קובץ לא נתמך'), true);
    }
  });

  // ---------- Reports ----------
  const repTaken = $('#repTaken');
  const repReturned = $('#repReturned');
  const repActiveEmp = $('#repActiveEmp');
  const repByEmployee = $('#repByEmployee');
  const repByEmployeeEmpty = $('#repByEmployeeEmpty');
  const repOverdue = $('#repOverdue');
  const repOverdueEmpty = $('#repOverdueEmpty');
  const repEmpChart = $('#repEmpChart');
  const repViewToggle = $('#repViewToggle');
  const repHistoryTbody = $('#repHistoryTbody');
  const repHistoryWrap = $('#repHistoryTbody') && $('#repHistoryTbody').closest('.table-wrap');
  const repHistoryEmpty = $('#repHistoryEmpty');
  const OVERDUE_DAYS = 3;
  const CHART_MIN_EMPLOYEES = 8; // with this many employees the report switches to a chart
  let reportDays = 1; // 0 = all time
  let reportView = 'auto'; // 'auto' | 'chart' | 'list'

  repViewToggle.querySelectorAll('.report-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportView = btn.dataset.view;
      renderReports(loadState());
    });
  });

  document.querySelectorAll('.report-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-range').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      reportDays = Number(btn.dataset.days);
      renderReports(loadState());
    });
  });

  function reportCutoff() {
    if (reportDays === 0) return 0;
    if (reportDays === 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    return Date.now() - reportDays * 24 * 60 * 60 * 1000;
  }

  function empKey(emp) {
    if (!emp || (!emp.name && !emp.code)) return '__unknown__';
    return `${emp.code || ''}|${emp.name || ''}`;
  }

  function renderReports(state) {
    const cutoff = reportCutoff();
    const entries = state.history.filter((h) => h.takenAt >= cutoff);

    const takenCount = entries.filter((h) => h.action === 'נלקח').length;
    const returnedCount = entries.filter((h) => h.action === 'הוחזר').length;
    repTaken.textContent = takenCount;
    repReturned.textContent = returnedCount;

    // Activity per employee
    const byEmp = new Map();
    entries.forEach((h) => {
      const key = empKey(h.employee);
      if (!byEmp.has(key)) byEmp.set(key, { employee: h.employee, taken: 0, returned: 0 });
      const rec = byEmp.get(key);
      if (h.action === 'נלקח') rec.taken++;
      if (h.action === 'הוחזר') rec.returned++;
    });
    // Currently holding, per employee (regardless of the period filter)
    const holding = new Map();
    state.meds.forEach((m) => {
      const key = empKey(m.employee);
      holding.set(key, (holding.get(key) || 0) + 1);
      if (!byEmp.has(key)) byEmp.set(key, { employee: m.employee, taken: 0, returned: 0 });
    });

    repActiveEmp.textContent = byEmp.size;

    repByEmployee.innerHTML = '';
    repEmpChart.innerHTML = '';
    const empRows = [...byEmp.values()].sort((a, b) => (b.taken + b.returned) - (a.taken + a.returned));
    repByEmployeeEmpty.classList.toggle('hidden', empRows.length > 0);

    // Many employees → a bar chart reads better than a long list
    repViewToggle.classList.toggle('hidden', empRows.length < 2);
    const useChart = empRows.length > 0 &&
      (reportView === 'chart' || (reportView === 'auto' && empRows.length >= CHART_MIN_EMPLOYEES));
    repViewToggle.querySelectorAll('.report-view-btn').forEach((b) => {
      b.classList.toggle('selected', (b.dataset.view === 'chart') === useChart);
    });
    repEmpChart.classList.toggle('hidden', !useChart);
    repByEmployee.classList.toggle('hidden', useChart);
    if (useChart) renderEmpChart(empRows, holding);

    empRows.forEach((rec) => {
      const li = document.createElement('li');
      li.className = 'report-row';

      const name = document.createElement('span');
      name.className = 'report-row-name';
      name.textContent = employeeLabel(rec.employee);

      const stats = document.createElement('span');
      stats.className = 'report-row-stats';
      const holds = holding.get(empKey(rec.employee)) || 0;
      stats.textContent = `לקיחות: ${rec.taken} · החזרות: ${rec.returned} · מחזיק כעת: ${holds}`;

      li.append(name, stats);
      repByEmployee.append(li);
    });

    // Detail table: who took / returned, from which department and when
    repHistoryTbody.innerHTML = '';
    const detail = [...entries].sort((a, b) => b.takenAt - a.takenAt);
    repHistoryWrap.classList.toggle('hidden', detail.length === 0);
    repHistoryEmpty.classList.toggle('hidden', detail.length > 0);
    detail.forEach((h) => {
      const tr = document.createElement('tr');

      const timeTd = document.createElement('td');
      timeTd.className = 'cell-num';
      timeTd.textContent = formatDateTime(h.takenAt);

      const actionTd = document.createElement('td');
      const action = document.createElement('span');
      const actionClass = { 'נלקח': 'action-taken', 'הוחזר': 'action-returned', 'הועבר': 'action-transferred' }[h.action] || '';
      action.className = 'action-label ' + actionClass;
      action.textContent = h.action || '—';
      actionTd.append(action);

      const serialTd = document.createElement('td');
      serialTd.className = 'cell-num';
      serialTd.textContent = h.name || '—';

      const nameTd = document.createElement('td');
      nameTd.className = 'cell-name';
      nameTd.textContent = h.action === 'הועבר' && h.fromEmployee
        ? `${employeeName(h.fromEmployee)} ← ${employeeName(h.employee)}`
        : employeeName(h.employee);

      const recvTd = document.createElement('td');
      recvTd.className = 'cell-name';
      recvTd.textContent = h.receiver && h.receiver.name
        ? `${h.receiver.name}${h.receiver.empNo ? ` (${h.receiver.empNo})` : ''}`
        : '—';

      const issuerTd = document.createElement('td');
      issuerTd.className = 'cell-name';
      issuerTd.textContent = h.issuer ? employeeName(h.issuer) : '—';

      tr.append(timeTd, actionTd, serialTd, nameTd, recvTd, issuerTd);
      repHistoryTbody.append(tr);
    });

    // Terminals out for too long
    repOverdue.innerHTML = '';
    renderOverdue(state);
  }

  // Horizontal grouped bar chart: takes vs. returns per employee
  function renderEmpChart(empRows, holding) {
    const max = Math.max(1, ...empRows.map((r) => Math.max(r.taken, r.returned)));

    const legend = document.createElement('div');
    legend.className = 'emp-chart-legend';
    [['taken', 'לקיחות'], ['returned', 'החזרות']].forEach(([key, label]) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = `legend-swatch bar-${key}`;
      item.append(swatch, label);
      legend.append(item);
    });
    repEmpChart.append(legend);

    empRows.forEach((rec) => {
      const row = document.createElement('div');
      row.className = 'emp-chart-row';
      const holds = holding.get(empKey(rec.employee)) || 0;
      row.title = `${employeeLabel(rec.employee)} — לקיחות: ${rec.taken} · החזרות: ${rec.returned} · מחזיק כעת: ${holds}`;

      const name = document.createElement('span');
      name.className = 'emp-chart-name';
      name.textContent = employeeLabel(rec.employee);

      const bars = document.createElement('div');
      bars.className = 'emp-chart-bars';
      [['taken', rec.taken], ['returned', rec.returned]].forEach(([key, val]) => {
        const track = document.createElement('div');
        track.className = 'emp-chart-track';
        const bar = document.createElement('div');
        bar.className = `emp-chart-bar bar-${key}`;
        bar.style.width = `${(val / max) * 85}%`;
        const num = document.createElement('span');
        num.className = 'emp-chart-val' + (val === 0 ? ' zero' : '');
        num.textContent = val;
        track.append(bar, num);
        bars.append(track);
      });

      row.append(name, bars);
      repEmpChart.append(row);
    });
  }

  function renderOverdue(state) {
    const now = Date.now();
    const overdue = state.meds
      .filter((m) => now - (m.createdAt || now) > OVERDUE_DAYS * 24 * 60 * 60 * 1000)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    repOverdueEmpty.classList.toggle('hidden', overdue.length > 0);
    overdue.forEach((m) => {
      const li = document.createElement('li');
      li.className = 'report-row overdue';

      const name = document.createElement('span');
      name.className = 'report-row-name';
      name.textContent = `${m.name} · ${employeeLabel(m.employee)}`;

      const days = Math.floor((now - (m.createdAt || now)) / (24 * 60 * 60 * 1000));
      const stats = document.createElement('span');
      stats.className = 'report-row-stats';
      stats.textContent = `בשטח ${days} ימים (נלקח ${formatDateTime(m.createdAt || now)})`;

      li.append(name, stats);
      repOverdue.append(li);
    });
  }

  // ---------- Excel export ----------
  const EXPORT_NAME = 'דו״ח מסופונים שבועי';

  function buildExportRows(state) {
    const header = ['תאריך ושעה', 'פעולה', 'מספר סידורי', 'מחלקה', 'קוד מחלקה', 'שם מקבל', 'מס\' עובד מקבל', 'מנפק', 'הועבר ממחלקה'];
    const rows = [...state.history]
      .sort((a, b) => b.takenAt - a.takenAt)
      .map((h) => [
        formatDateTime(h.takenAt),
        h.action || '',
        h.name || '',
        employeeName(h.employee),
        (h.employee && h.employee.code) || '',
        (h.receiver && h.receiver.name) || '',
        (h.receiver && h.receiver.empNo) || '',
        h.issuer ? employeeName(h.issuer) : '',
        h.fromEmployee ? employeeName(h.fromEmployee) : '',
      ]);
    return [header, ...rows];
  }

  $('#exportCsvBtn').addEventListener('click', async () => {
    const state = loadState();
    refreshEmployeeNames(state);
    const rows = buildExportRows(state);
    try {
      await loadSheetJS();
      const ws = window.XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 18 }];
      const wb = window.XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      window.XLSX.utils.book_append_sheet(wb, ws, 'דוח מסופונים');
      window.XLSX.writeFile(wb, `${EXPORT_NAME}.xlsx`);
    } catch {
      // Offline fallback: the same report as CSV (Excel opens it too)
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${EXPORT_NAME}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  });

  function renderStats(state) {
    statOut.textContent = state.meds.length;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    statToday.textContent = state.history.filter((h) => h.takenAt >= startOfDay.getTime()).length;
    statInventory.textContent = state.inventory.length;
  }

  function renderInventory(state) {
    inventoryList.innerHTML = '';
    if (state.inventory.length === 0) {
      emptyInventory.classList.remove('hidden');
      return;
    }
    emptyInventory.classList.add('hidden');

    const outSerials = new Set(state.meds.map((m) => m.name));

    state.inventory.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const left = document.createElement('div');
      left.className = 'history-left';

      const icon = document.createElement('div');
      icon.className = 'history-icon';
      icon.innerHTML = buildTerminalIconSVG();

      const info = document.createElement('div');
      info.className = 'history-info';

      const name = document.createElement('span');
      name.className = 'history-name';
      name.textContent = item.serial;

      const model = document.createElement('span');
      model.className = 'history-time';
      model.textContent = item.model || 'דגם לא ידוע';

      info.append(name, model);

      // Last movement of this terminal, from the movements log
      const lastMove = state.history
        .filter((h) => h.name === item.serial)
        .sort((a, b) => b.takenAt - a.takenAt)[0];
      const move = document.createElement('span');
      move.className = 'history-time';
      move.textContent = lastMove
        ? `תנועה אחרונה: ${lastMove.action} ${formatDateTime(lastMove.takenAt)}`
        : 'אין תנועות';
      info.append(move);
      left.append(icon, info);

      const isOut = outSerials.has(item.serial);
      const status = document.createElement('span');
      status.className = 'status-chip' + (isOut ? ' out' : '');
      status.textContent = isOut ? 'בשטח' : 'במחסן';

      const del = document.createElement('button');
      del.className = 'history-delete';
      del.setAttribute('aria-label', 'הסר מהמלאי');
      del.innerHTML = buildTrashIconSVG();
      del.addEventListener('click', () => {
        confirmAction(`להסיר את מסופון ${item.serial} מהמלאי?`, () => {
          const data = loadState();
          data.inventory = data.inventory.filter((t) => t.id !== item.id);
          saveState(data);
          render();
        }, 'הסר');
      });

      li.append(left, status, del);
      inventoryList.append(li);
    });
  }

  // ---------- Excel / CSV import ----------
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('לא ניתן לטעון את רכיב קריאת האקסל – בדוק חיבור לאינטרנט'));
      document.head.append(s);
    });
  }

  async function parseImportFile(file) {
    const fname = file.name.toLowerCase();
    if (fname.endsWith('.csv') || fname.endsWith('.txt')) {
      const text = await file.text();
      return text
        .replace(/^﻿/, '')
        .split(/\r?\n/)
        .map((line) => line.split(/[,;\t]/).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
    }
    await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return window.XLSX.utils
      .sheet_to_json(ws, { header: 1, defval: '' })
      .map((row) => row.map((c) => String(c).trim()));
  }

  function isHeaderRow(row) {
    const joined = row.join(' ');
    return /סידורי|מס' מסופון|serial|מספר|דגם|model/i.test(joined) && !/\d{4,}/.test(joined);
  }

  function importRows(rows) {
    const data = loadState();
    const existing = new Set(data.inventory.map((t) => t.serial));
    let added = 0;
    let skipped = 0;
    rows.forEach((row, idx) => {
      const serial = (row[0] || '').toString().trim();
      const model = (row[1] || '').toString().trim();
      if (!serial) return;
      if (idx === 0 && isHeaderRow(row)) return;
      if (existing.has(serial)) {
        skipped++;
        return;
      }
      existing.add(serial);
      data.inventory.push({ id: uid(), serial, model, addedAt: Date.now() });
      added++;
    });
    saveState(data);
    return { added, skipped };
  }

  function showImportStatus(text, isError) {
    importStatus.textContent = text;
    importStatus.classList.remove('hidden');
    importStatus.classList.toggle('error', !!isError);
  }

  importBtn.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = '';
    if (!file) return;
    showImportStatus('קורא את הקובץ...', false);
    try {
      const rows = await parseImportFile(file);
      const { added, skipped } = importRows(rows);
      let msg = added > 0 ? `נוספו ${added} מסופונים למלאי` : 'לא נוספו מסופונים חדשים';
      if (skipped > 0) msg += ` · ${skipped} דולגו (מספר סידורי שכבר קיים)`;
      showImportStatus(msg, added === 0);
      render();
    } catch (err) {
      showImportStatus('שגיאה בקריאת הקובץ: ' + (err && err.message ? err.message : 'קובץ לא נתמך'), true);
    }
  });

  // ---------- Main table: every terminal, its department, last movement, status ----------
  const allTerminalsTbody = $('#allTerminalsTbody');
  const allTerminalsWrap = $('#allTerminalsTbody') && $('#allTerminalsTbody').closest('.table-wrap');
  const emptyAllTerminals = $('#emptyAllTerminals');
  const terminalSearch = $('#terminalSearch');

  terminalSearch.addEventListener('input', () => renderAllTerminals(loadState()));

  function renderAllTerminals(state) {
    // Every serial the system knows: warehouse inventory, terminals out
    // in the field, and terminals that only appear in the movements log.
    const serials = new Map(); // serial -> model
    state.inventory.forEach((t) => serials.set(t.serial, t.model || ''));
    state.meds.forEach((m) => { if (!serials.has(m.name)) serials.set(m.name, m.model || ''); });
    state.history.forEach((h) => { if (h.name && !serials.has(h.name)) serials.set(h.name, ''); });

    const outBySerial = new Map(state.meds.map((m) => [m.name, m]));
    const lastMoveBySerial = new Map();
    state.history.forEach((h) => {
      const prev = lastMoveBySerial.get(h.name);
      if (!prev || h.takenAt > prev.takenAt) lastMoveBySerial.set(h.name, h);
    });

    const q = terminalSearch.value.trim().toLowerCase();
    const rows = [...serials.entries()]
      .map(([serial, model]) => {
        const med = outBySerial.get(serial) || null;
        const lastMove = lastMoveBySerial.get(serial) || null;
        return { serial, model, med, lastMove };
      })
      .filter((r) => {
        if (!q) return true;
        const dept = r.med ? employeeLabel(r.med.employee) : '';
        const recv = (r.med && r.med.receiver && r.med.receiver.name) || '';
        return `${r.serial} ${r.model} ${dept} ${recv}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (!!b.med !== !!a.med) return b.med ? 1 : -1; // out in the field first
        return a.serial.localeCompare(b.serial, 'he');
      });

    allTerminalsTbody.innerHTML = '';
    allTerminalsWrap.classList.toggle('hidden', rows.length === 0);
    emptyAllTerminals.classList.toggle('hidden', rows.length > 0);
    rows.forEach((r) => {
      const tr = document.createElement('tr');

      const serialTd = document.createElement('td');
      serialTd.className = 'cell-num';
      serialTd.textContent = r.serial + (r.model ? ` · ${r.model}` : '');

      const deptTd = document.createElement('td');
      deptTd.className = 'cell-name';
      deptTd.textContent = r.med ? employeeLabel(r.med.employee) : '—';

      const moveTd = document.createElement('td');
      moveTd.className = 'cell-num';
      moveTd.textContent = r.lastMove
        ? `${r.lastMove.action} · ${formatDateTime(r.lastMove.takenAt)}`
        : '—';

      const statusTd = document.createElement('td');
      const chip = document.createElement('span');
      chip.className = 'status-chip' + (r.med ? ' out' : '');
      chip.textContent = r.med ? 'בשטח' : 'במחסן';
      statusTd.append(chip);

      tr.append(serialTd, deptTd, moveTd, statusTd);
      allTerminalsTbody.append(tr);
    });
  }

  function renderTerminals(state) {
    terminalsList.innerHTML = '';
    if (state.meds.length === 0) {
      emptyTerminals.classList.remove('hidden');
      return;
    }
    emptyTerminals.classList.add('hidden');

    const sorted = [...state.meds].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    sorted.forEach((med) => {
      const li = document.createElement('li');
      li.className = 'med-card';

      const header = document.createElement('div');
      header.className = 'med-header';

      const headerLeft = document.createElement('div');
      headerLeft.className = 'med-header-left';

      const icon = document.createElement('div');
      icon.className = 'med-icon';
      icon.innerHTML = buildTerminalIconSVG();

      const info = document.createElement('div');
      info.className = 'terminal-info';

      const name = document.createElement('h3');
      name.className = 'med-name';
      name.textContent = med.name;

      const sub = document.createElement('span');
      sub.className = 'terminal-sub';
      const lastMoveAt = med.transferredAt || med.createdAt || Date.now();
      const lastMoveAction = med.transferredAt ? 'הועבר' : 'נלקח';
      sub.textContent = `${med.model || 'מסופון'} · תנועה אחרונה: ${lastMoveAction} ${formatDateTime(lastMoveAt)}`;

      const emp = document.createElement('span');
      emp.className = 'terminal-sub terminal-emp';
      emp.textContent = employeeLabel(med.employee);

      info.append(name, sub, emp);
      if (med.receiver && med.receiver.name) {
        const recv = document.createElement('span');
        recv.className = 'terminal-sub';
        recv.textContent = `מקבל: ${med.receiver.name}${med.receiver.empNo ? ` (עובד ${med.receiver.empNo})` : ''}`;
        info.append(recv);
      }
      if (med.transferredFrom) {
        const from = document.createElement('span');
        from.className = 'terminal-sub';
        from.textContent = `הועבר ממחלקת ${employeeLabel(med.transferredFrom)}`;
        info.append(from);
      }
      headerLeft.append(icon, info);

      const status = document.createElement('span');
      status.className = 'status-chip out';
      status.textContent = 'בשטח';

      header.append(headerLeft, status);

      const actions = document.createElement('div');
      actions.className = 'med-actions';

      const sigBtn = document.createElement('button');
      sigBtn.className = 'took-btn';
      sigBtn.textContent = 'צפייה בחתימה';
      sigBtn.addEventListener('click', () => {
        openSignatureView(
          `חתימה – ${med.name}`,
          `${employeeLabel(med.employee)} · נלקח ${formatDateTime(med.createdAt || Date.now())}`,
          med.signature
        );
      });

      actions.append(sigBtn);
      li.append(header, actions);
      terminalsList.append(li);
    });
  }

  function renderHistory(state) {
    historyList.innerHTML = '';
    if (state.history.length === 0) {
      emptyHistory.classList.remove('hidden');
      return;
    }
    emptyHistory.classList.add('hidden');

    const sorted = [...state.history].sort((a, b) => b.takenAt - a.takenAt);

    sorted.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'history-item';

      const left = document.createElement('div');
      left.className = 'history-left';

      const icon = document.createElement('div');
      icon.className = 'history-icon';
      icon.innerHTML = buildTerminalIconSVG();

      const info = document.createElement('div');
      info.className = 'history-info';

      const name = document.createElement('span');
      name.className = 'history-name';
      name.textContent = entry.action ? `${entry.name} · ${entry.action}` : entry.name;

      const who = document.createElement('span');
      who.className = 'history-time';
      who.textContent = entry.action === 'הועבר' && entry.fromEmployee
        ? `ממחלקת ${employeeLabel(entry.fromEmployee)} אל ${employeeLabel(entry.employee)}`
        : employeeLabel(entry.employee);
      if (entry.receiver && entry.receiver.name) {
        who.textContent += ` · מקבל: ${entry.receiver.name}${entry.receiver.empNo ? ` (${entry.receiver.empNo})` : ''}`;
      }

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatDateTime(entry.takenAt);

      info.append(name, who, time);
      left.append(icon, info);

      const sigBtn = document.createElement('button');
      sigBtn.className = 'icon-btn';
      sigBtn.textContent = 'חתימה';
      sigBtn.addEventListener('click', () => {
        openSignatureView(
          `חתימה – ${entry.name}`,
          `${entry.action || ''} · ${employeeLabel(entry.employee)} · ${formatDateTime(entry.takenAt)}`,
          entry.signature
        );
      });

      li.append(left, sigBtn);
      historyList.append(li);
    });
  }

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ---------- Signature modal ----------
  sigViewClose.addEventListener('click', closeSignatureView);
  signatureModal.addEventListener('click', (e) => {
    if (e.target === signatureModal) closeSignatureView();
  });
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest && e.target.closest('.modal-close');
    if (!closeBtn) return;
    if (closeBtn.dataset.close === 'signatureModal') closeSignatureView();
    if (closeBtn.dataset.close === 'confirmModal') closeConfirm();
  });

  // ---------- Logged-in user display ----------
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY)) || {};
    const parts = [];
    if (session.username) parts.push(session.username);
    if (session.empCode) parts.push(`(קוד ${session.empCode})`);
    if (parts.length) {
      document.getElementById('headerUser').textContent = 'מחובר למערכת: ' + parts.join(' ');
    }
  } catch {}

  // ---------- Logout ----------
  document.getElementById('headerLogoutBtn').addEventListener('click', () => {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    location.replace('login.html');
  });

  // ---------- Live refresh ----------
  // Pick up changes made by employees (another tab on this device)
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });
  setInterval(render, 15 * 1000);

  render();
})();
