(() => {
  'use strict';

  const STORAGE_KEY = 'terminalManagementSystem.v1';
  const REMINDER_WINDOW_MIN = 5; // minutes after scheduled time we still trigger
  const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

  const SHAPES = [
    { id: 'round', label: 'טבליה עגולה' },
    { id: 'oval', label: 'טבליה אובלית' },
    { id: 'capsule', label: 'קפסולה' },
    { id: 'drops', label: 'טיפות' },
    { id: 'syrup', label: 'סירופ' },
    { id: 'injection', label: 'זריקה' },
  ];

  const COLORS = [
    '#f1f5f9', // off-white
    '#fde047', // yellow
    '#fdba74', // orange
    '#fca5a5', // red
    '#f9a8d4', // pink
    '#c4b5fd', // purple
    '#93c5fd', // blue
    '#86efac', // green
    '#a3a3a3', // gray
  ];

  const DEFAULT_SHAPE = 'round';
  const DEFAULT_COLOR = '#f1f5f9';
  let svgIdCounter = 0;

  const DAYS = [
    { id: 0, short: 'א', long: 'ראשון' },
    { id: 1, short: 'ב', long: 'שני' },
    { id: 2, short: 'ג', long: 'שלישי' },
    { id: 3, short: 'ד', long: 'רביעי' },
    { id: 4, short: 'ה', long: 'חמישי' },
    { id: 5, short: 'ו', long: 'שישי' },
    { id: 6, short: 'ש', long: 'שבת' },
  ];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  // ---------- State ----------
  let state = loadState();
  let editingId = null;
  let pendingConfirm = null;
  let activeReminder = null; // { medId, time, isSnooze }
  let audioCtx = null;
  let selectedShape = DEFAULT_SHAPE;
  let selectedColor = DEFAULT_COLOR;
  let selectedDays = [...ALL_DAYS];

  function loadState() {
    let parsed = { meds: [], history: [], inventory: [], employees: [], removedEmployees: [], settings: {}, triggered: {}, snoozes: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        parsed.meds = Array.isArray(data.meds) ? data.meds : [];
        parsed.history = Array.isArray(data.history) ? data.history : [];
        parsed.inventory = Array.isArray(data.inventory) ? data.inventory : [];
        parsed.employees = Array.isArray(data.employees) ? data.employees : [];
        parsed.removedEmployees = Array.isArray(data.removedEmployees) ? data.removedEmployees : [];
        parsed.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
        parsed.triggered = data.triggered && typeof data.triggered === 'object' ? data.triggered : {};
        parsed.snoozes = Array.isArray(data.snoozes) ? data.snoozes : [];
      }
    } catch {}
    if (typeof parsed.settings.remindersEnabled !== 'boolean') parsed.settings.remindersEnabled = false;
    parsed.meds.forEach((m) => {
      if (!m.shape) m.shape = DEFAULT_SHAPE;
      if (!m.color) m.color = DEFAULT_COLOR;
      if (!Array.isArray(m.days)) m.days = [...ALL_DAYS];
    });
    parsed.history.forEach((h) => {
      if (!h.shape) h.shape = DEFAULT_SHAPE;
      if (!h.color) h.color = DEFAULT_COLOR;
    });
    cleanupOldTriggers(parsed);
    return parsed;
  }

  function cleanupOldTriggers(s) {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(s.triggered).forEach((k) => {
      if (s.triggered[k] < cutoff) delete s.triggered[k];
    });
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Elements ----------
  const $ = (sel) => document.querySelector(sel);
  const medsList = $('#medsList');
  const historyList = $('#historyList');
  const emptyMeds = $('#emptyMeds');
  const emptyHistory = $('#emptyHistory');
  const medModal = $('#medModal');
  const medForm = $('#medForm');
  const medNameInput = $('#medName');
  const timesContainer = $('#timesContainer');
  const addTimeBtn = $('#addTimeBtn');
  const cancelBtn = $('#cancelBtn');
  const modalTitle = $('#modalTitle');
  const confirmModal = $('#confirmModal');
  const confirmText = $('#confirmText');
  const confirmOk = $('#confirmOk');
  const confirmCancel = $('#confirmCancel');

  const shapePicker = $('#shapePicker');
  const colorPicker = $('#colorPicker');
  const daysPicker = $('#daysPicker');
  const saveBtn = $('#saveBtn');

  const navSettings = $('#navSettings');
  const settingsModal = $('#settingsModal');
  const settingsClose = $('#settingsClose');
  const remindersToggle = $('#remindersToggle');
  const permissionStatus = $('#permissionStatus');
  const testSoundBtn = $('#testSoundBtn');

  const reminderModal = $('#reminderModal');
  const reminderPillIcon = $('#reminderPillIcon');
  const reminderMedName = $('#reminderMedName');
  const reminderTime = $('#reminderTime');
  const reminderTook = $('#reminderTook');
  const reminderSnooze = $('#reminderSnooze');
  const reminderDismiss = $('#reminderDismiss');

  // ---------- Pill drawings ----------
  function darken(hex, factor = 0.65) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function buildMedIconSVG(shape, color) {
    const c = color || DEFAULT_COLOR;
    const stroke = '#475569';
    const sw = 1.6;
    switch (shape) {
      case 'oval':
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="24" cy="24" rx="21" ry="11" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
          <line x1="5" y1="24" x2="43" y2="24" stroke="${stroke}" stroke-width="${sw}" opacity="0.45"/>
        </svg>`;
      case 'capsule': {
        const id = ++svgIdCounter;
        const dark = darken(c, 0.55);
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <defs><clipPath id="cap${id}"><rect x="2" y="14" width="44" height="20" rx="10" ry="10"/></clipPath></defs>
          <g clip-path="url(#cap${id})">
            <rect x="2" y="14" width="22" height="20" fill="${c}"/>
            <rect x="24" y="14" width="22" height="20" fill="${dark}"/>
          </g>
          <rect x="2" y="14" width="44" height="20" rx="10" ry="10" fill="none" stroke="${stroke}" stroke-width="${sw}"/>
          <ellipse cx="10" cy="20" rx="3" ry="1.5" fill="white" opacity="0.55"/>
        </svg>`;
      }
      case 'drops':
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <path d="M 24 5 C 24 5, 13 22, 13 31 a 11 11 0 0 0 22 0 C 35 22, 24 5, 24 5 Z" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
          <ellipse cx="20" cy="26" rx="3" ry="5" fill="white" opacity="0.45"/>
        </svg>`;
      case 'syrup':
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <rect x="20" y="4" width="8" height="3" fill="${stroke}"/>
          <rect x="18" y="7" width="12" height="5" rx="1" fill="#94a3b8"/>
          <path d="M 16 12 L 32 12 L 34 18 L 34 42 a 2 2 0 0 1 -2 2 L 16 44 a 2 2 0 0 1 -2 -2 L 14 18 Z" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
          <rect x="17" y="26" width="14" height="10" rx="1" fill="white" opacity="0.55"/>
        </svg>`;
      case 'injection':
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <g transform="rotate(-30 24 24)">
            <line x1="2" y1="24" x2="10" y2="24" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="9" y="20" width="6" height="8" fill="${stroke}"/>
            <rect x="14" y="19" width="20" height="10" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
            <line x1="19" y1="22" x2="19" y2="26" stroke="${stroke}" stroke-width="1" opacity="0.5"/>
            <line x1="24" y1="22" x2="24" y2="26" stroke="${stroke}" stroke-width="1" opacity="0.5"/>
            <line x1="29" y1="22" x2="29" y2="26" stroke="${stroke}" stroke-width="1" opacity="0.5"/>
            <rect x="33" y="22" width="4" height="4" fill="${stroke}"/>
            <line x1="37" y1="24" x2="46" y2="24" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
          </g>
        </svg>`;
      case 'round':
      default:
        return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="19" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
          <line x1="6" y1="24" x2="42" y2="24" stroke="${stroke}" stroke-width="${sw}" opacity="0.45"/>
          <ellipse cx="18" cy="17" rx="4" ry="2.5" fill="white" opacity="0.45"/>
        </svg>`;
    }
  }

  function renderShapePicker() {
    shapePicker.innerHTML = '';
    SHAPES.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shape-option' + (s.id === selectedShape ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', s.id === selectedShape);
      btn.title = s.label;
      btn.innerHTML = buildMedIconSVG(s.id, selectedColor);
      btn.addEventListener('click', () => {
        selectedShape = s.id;
        renderShapePicker();
      });
      shapePicker.append(btn);
    });
  }

  function renderColorPicker() {
    colorPicker.innerHTML = '';
    COLORS.forEach((col) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-option' + (col === selectedColor ? ' selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', col === selectedColor);
      btn.style.background = col;
      btn.addEventListener('click', () => {
        selectedColor = col;
        renderColorPicker();
        renderShapePicker(); // re-render shapes with new color
      });
      colorPicker.append(btn);
    });
  }

  function renderDaysPicker() {
    daysPicker.innerHTML = '';
    DAYS.forEach((d) => {
      const isSelected = selectedDays.includes(d.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-option' + (isSelected ? ' selected' : '');
      btn.textContent = d.short;
      btn.title = `יום ${d.long}`;
      btn.setAttribute('aria-label', `יום ${d.long}`);
      btn.setAttribute('aria-pressed', isSelected);
      btn.addEventListener('click', () => {
        if (selectedDays.includes(d.id)) {
          selectedDays = selectedDays.filter((id) => id !== d.id);
        } else {
          selectedDays = [...selectedDays, d.id].sort((a, b) => a - b);
        }
        renderDaysPicker();
      });
      daysPicker.append(btn);
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

  // ---------- Render ----------
  function render() {
    renderMeds();
    renderHistory();
  }

  function renderMeds() {
    medsList.innerHTML = '';
    // The issuing station sees every terminal that is out in the field
    if (state.meds.length === 0) {
      emptyMeds.classList.remove('hidden');
      return;
    }
    emptyMeds.classList.add('hidden');

    state.meds.forEach((med) => {
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
      const takenAt = med.transferredAt || med.createdAt || Date.now();
      const lastAction = med.transferredAt ? 'הועבר' : 'נלקח';
      sub.textContent = `${med.model || 'מסופון'} · ${lastAction} ${formatDateTime(takenAt)}`;

      info.append(name, sub);
      const dept = document.createElement('span');
      dept.className = 'terminal-sub terminal-emp';
      dept.textContent = departmentLabel(med.employee);
      info.append(dept);
      if (med.receiver && med.receiver.name) {
        const recv = document.createElement('span');
        recv.className = 'terminal-sub';
        recv.textContent = `מקבל: ${med.receiver.name}${med.receiver.empNo ? ` (עובד ${med.receiver.empNo})` : ''}`;
        info.append(recv);
      }
      headerLeft.append(icon, info);

      const status = document.createElement('span');
      status.className = 'status-chip';
      status.textContent = 'ברשותי';

      header.append(headerLeft, status);

      const actions = document.createElement('div');
      actions.className = 'med-actions';

      const returnBtn = document.createElement('button');
      returnBtn.className = 'took-btn';
      returnBtn.textContent = 'החזרת מסופון';
      returnBtn.addEventListener('click', () => openIssueScreen('return', med));

      actions.append(returnBtn);

      li.append(header, actions);
      medsList.append(li);
    });
  }

  function renderHistory() {
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

      info.append(name);
      if (entry.action !== 'הועבר' && entry.employee) {
        const dept = document.createElement('span');
        dept.className = 'history-time';
        dept.textContent = `מחלקה: ${departmentLabel(entry.employee)}`;
        info.append(dept);
      }
      if (entry.receiver && entry.receiver.name) {
        const recv = document.createElement('span');
        recv.className = 'history-time';
        recv.textContent = `מקבל: ${entry.receiver.name}${entry.receiver.empNo ? ` (עובד ${entry.receiver.empNo})` : ''}`;
        info.append(recv);
      }
      if (entry.action === 'הועבר' && entry.fromEmployee) {
        const from = document.createElement('span');
        from.className = 'history-time';
        from.textContent = `ממחלקת ${departmentLabel(entry.fromEmployee)} אל ${departmentLabel(entry.employee)}`;
        info.append(from);
      }

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatDateTime(entry.takenAt);

      info.append(time);
      left.append(icon, info);

      const del = document.createElement('button');
      del.className = 'history-delete';
      del.setAttribute('aria-label', 'מחק רישום');
      del.innerHTML = buildTrashIconSVG();
      del.addEventListener('click', () => {
        confirmAction('למחוק את הרישום?', () => deleteHistoryEntry(entry.id));
      });

      li.append(left, del);
      historyList.append(li);
    });
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `${date} בשעה ${time}`;
  }

  // ---------- Add / Edit modal ----------
  function openModal(med) {
    editingId = med ? med.id : null;
    modalTitle.textContent = med ? 'עריכת כדור' : 'הוסף כדור';
    medNameInput.value = med ? med.name : '';
    selectedShape = (med && med.shape) || DEFAULT_SHAPE;
    selectedColor = (med && med.color) || DEFAULT_COLOR;
    selectedDays = (med && Array.isArray(med.days)) ? [...med.days] : [...ALL_DAYS];
    renderShapePicker();
    renderColorPicker();
    renderDaysPicker();
    timesContainer.innerHTML = '';
    const times = med && med.times.length ? med.times : [''];
    times.forEach((t) => addTimeRow(t));
    updateSaveBtnState();
    medModal.classList.remove('hidden');
    setTimeout(() => medNameInput.focus(), 50);
  }

  function updateSaveBtnState() {
    saveBtn.disabled = !medNameInput.value.trim();
  }

  medNameInput.addEventListener('input', updateSaveBtnState);

  function closeModal() {
    medModal.classList.add('hidden');
    editingId = null;
    medForm.reset();
    timesContainer.innerHTML = '';
  }

  function addTimeRow(value = '') {
    const row = document.createElement('div');
    row.className = 'time-row';

    const display = document.createElement('button');
    display.type = 'button';
    display.className = 'time-display' + (value ? '' : ' empty');
    display.dataset.time = value || '';
    display.textContent = value || 'בחר שעה';
    display.addEventListener('click', () => openTimePicker(display));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-time';
    removeBtn.setAttribute('aria-label', 'הסר שעה');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => row.remove());

    row.append(display, removeBtn);
    timesContainer.append(row);
  }

  // ---------- Issue flow state ----------
  const scanConfirmBtn = $('#scanConfirmBtn');
  let scanMode = 'take'; // 'take' | 'return' | 'transfer'
  let issueMed = null; // the med being returned

  function buildTrashIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/>
      <line x1="14" y1="11" x2="14" y2="17"/>
    </svg>`;
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

  // Model from the warehouse inventory when the serial is registered there
  function modelFromInventory(serial) {
    const item = state.inventory.find((t) => t.serial === serial);
    return item ? (item.model || 'מסופון') : null;
  }

  // ---------- Issue screen: one screen, like the whiteboard ----------
  // Date-time + issuer automatic, RF scan or typing, receiver details,
  // signature, and a single release button.
  const signScreen = $('#signScreen');
  const signModel = $('#signModel');
  const signBackBtn = $('#signBackBtn');
  const signTitle = $('#signTitle');
  const signInstruction = $('#signInstruction');
  const signDateTime = $('#signDateTime');
  const signIssuer = $('#signIssuer');
  const signFromDeptRow = $('#signFromDeptRow');
  const signFromDept = $('#signFromDept');
  const signToDeptRow = $('#signToDeptRow');
  const issueSerial = $('#issueSerial');
  const issueError = $('#issueError');
  // The issuing station is always the returns department, whoever is logged in
  const ISSUING_STATION = 'מחלקת החזרות';

  const receiverFields = $('#receiverFields');
  const recvDept = $('#recvDept');
  const recvName = $('#recvName');
  const recvEmpNo = $('#recvEmpNo');
  let issueClockTimer = null;
  let deptOptions = []; // active departments, managed by the admin side

  // The departments offered in the "receiving department" list by default
  const DEFAULT_DEPARTMENTS = ['מחלקת החזרות', 'מחלקת מלאי', 'מחלקת קבלה', 'מחלקת ליקוט'];
  // Person accounts that must never appear as departments (cleaned up + blocked)
  const BLOCKED_DEPARTMENTS = ['עמרי'];

  function ensureDefaultDepartments() {
    let changed = false;
    BLOCKED_DEPARTMENTS.forEach((name) => {
      const matches = state.employees.filter((e) => (e.name || '').trim() === name);
      if (matches.length) {
        state.employees = state.employees.filter((e) => (e.name || '').trim() !== name);
        matches.forEach((m) => state.removedEmployees.push({ code: m.code || '', name: m.name || '' }));
        changed = true;
      }
      if (!state.removedEmployees.some((r) => (r.name || '').trim() === name)) {
        state.removedEmployees.push({ code: '', name });
        changed = true;
      }
    });
    DEFAULT_DEPARTMENTS.forEach((name) => {
      if (!state.employees.some((e) => (e.name || '').trim() === name)) {
        state.employees.push({ id: uid(), code: '', name, active: true, addedAt: Date.now() });
        changed = true;
      }
    });
    if (changed) saveState();
  }

  function fillDeptSelect() {
    deptOptions = state.employees.filter((e) => e.active !== false && (e.name || e.code));
    recvDept.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'בחר מחלקה…';
    recvDept.append(placeholder);
    deptOptions.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = d.name || `קוד ${d.code}`;
      recvDept.append(opt);
    });
    if (deptOptions.length === 0) {
      placeholder.textContent = 'אין מחלקות במערכת – הוסף בצד המנהל';
    }
  }

  function selectedDept() {
    const i = recvDept.value;
    if (i === '') return null;
    const d = deptOptions[Number(i)];
    return d ? { code: d.code || '', name: d.name || '' } : null;
  }

  function showIssueError(text) {
    issueError.textContent = text;
    issueError.classList.remove('hidden');
  }

  function hideIssueError() {
    issueError.classList.add('hidden');
  }

  // Resolves the typed/scanned serial according to the current mode and
  // refreshes the model / source-department rows on screen.
  function resolveSerial() {
    const serial = issueSerial.value.trim();
    hideIssueError();
    if (scanMode === 'return') {
      return { ok: true, serial: issueMed.name, model: issueMed.model || 'מסופון' };
    }
    if (!serial) {
      signModel.textContent = '—';
      if (scanMode === 'transfer') signFromDept.textContent = '—';
      return { ok: false, serial: '' };
    }
    if (scanMode === 'transfer') {
      const source = state.meds.find((m) => m.name === serial);
      if (!source) {
        signModel.textContent = '—';
        signFromDept.textContent = '—';
        return { ok: false, serial, error: 'המסופון אינו רשום כנמצא בשטח – לא ניתן להעביר' };
      }
      signModel.textContent = source.model || 'מסופון';
      signFromDept.textContent = departmentLabel(source.employee);
      return { ok: true, serial, model: source.model || 'מסופון', source };
    }
    // take
    const alreadyOut = state.meds.find((m) => m.name === serial);
    if (alreadyOut) {
      signModel.textContent = alreadyOut.model || 'מסופון';
      return {
        ok: false, serial,
        error: `המסופון כבר בשטח אצל מחלקת ${departmentLabel(alreadyOut.employee)} – יש להשתמש בהעברה`,
      };
    }
    const model = modelFromInventory(serial) || 'מסופון';
    signModel.textContent = model;
    return { ok: true, serial, model };
  }

  function openIssueScreen(mode, med) {
    scanMode = (mode === 'return' || mode === 'transfer') ? mode : 'take';
    issueMed = scanMode === 'return' ? med : null;
    const isReturn = scanMode === 'return';
    const isTransfer = scanMode === 'transfer';

    signTitle.textContent = isReturn ? 'החזרת מסופון' : isTransfer ? 'קבלת מסופון בהעברה' : 'ניפוק מסופון';
    signInstruction.textContent = isReturn
      ? 'אני מאשר/ת בחתימתי כי החזרתי את המסופון ומרגע זה הוא אינו באחריותי.'
      : isTransfer
        ? 'אני מאשר/ת בחתימתי את קבלת המסופון בהעברה ממחלקה אחרת, ומרגע זה הוא באחריותי עד להחזרתו.'
        : 'אני מאשר/ת בחתימתי כי קיבלתי את המסופון לידיי ואני אחראי/ת עליו עד להחזרתו.';
    scanConfirmBtn.textContent = isReturn ? 'אישור החזרה' : isTransfer ? 'אישור העברה' : 'שחרור';
    signBackBtn.textContent = (isReturn || isTransfer) ? 'ביטול' : 'ניקוי';

    // Automatic details, straight from the clock and the login session
    signIssuer.textContent = ISSUING_STATION;
    const tick = () => { signDateTime.textContent = formatDateTime(Date.now()); };
    tick();
    clearInterval(issueClockTimer);
    issueClockTimer = setInterval(tick, 30 * 1000);

    signFromDeptRow.classList.toggle('hidden', !isTransfer);
    signFromDept.textContent = '—';
    // On a return the terminal goes back to the returns department
    signToDeptRow.classList.toggle('hidden', !isReturn);
    issueSerial.value = isReturn ? med.name : '';
    issueSerial.readOnly = isReturn;
    signModel.textContent = isReturn ? (med.model || 'מסופון') : '—';
    receiverFields.classList.toggle('hidden', isReturn);
    fillDeptSelect();
    recvDept.value = '';
    recvName.value = '';
    recvEmpNo.value = '';
    hideIssueError();

    // The inline form is always on screen; bring it into view for return/transfer
    if (isReturn || isTransfer) {
      signScreen.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    requestAnimationFrame(() => {
      resizeSignaturePad();
      clearSignature();
      // Keep the RF field ready for typing or a barcode-gun scan
      if (!isReturn) issueSerial.focus({ preventScroll: !isTransfer });
    });
  }

  // Release is allowed only with a terminal, a signature, a receiving
  // department and receiver details (take/transfer)
  function updateConfirmState() {
    const needsReceiver = scanMode !== 'return';
    const receiverOk = !needsReceiver || (recvName.value.trim().length > 0 && selectedDept() !== null);
    const serialOk = issueSerial.value.trim().length > 0;
    scanConfirmBtn.disabled = !(hasSignature && receiverOk && serialOk);
  }
  recvName.addEventListener('input', updateConfirmState);
  recvEmpNo.addEventListener('input', updateConfirmState);
  recvDept.addEventListener('change', updateConfirmState);
  issueSerial.addEventListener('input', () => {
    resolveSerial();
    updateConfirmState();
  });

  // RF guns type the code and send Enter – resolve and jump to the receiver name
  issueSerial.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const resolved = resolveSerial();
    updateConfirmState();
    if (!resolved.ok) {
      if (resolved.error) showIssueError(resolved.error);
      return;
    }
    if (scanMode !== 'return') recvName.focus();
  });

  // The form never disappears – it resets back to a fresh issue (take) form
  function closeSignScreen() {
    openIssueScreen('take');
  }

  signBackBtn.addEventListener('click', closeSignScreen);

  // ---------- Employee signature pad ----------
  const signaturePad = $('#signaturePad');
  const clearSignatureBtn = $('#clearSignatureBtn');
  const sigCtx = signaturePad.getContext('2d');
  let hasSignature = false;
  let sigDrawing = false;

  function resizeSignaturePad() {
    const ratio = window.devicePixelRatio || 1;
    const w = signaturePad.clientWidth;
    const h = signaturePad.clientHeight;
    if (!w || !h) return;
    signaturePad.width = w * ratio;
    signaturePad.height = h * ratio;
    sigCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    sigCtx.lineWidth = 2.2;
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.strokeStyle = '#1e293b';
  }

  function clearSignature() {
    sigCtx.save();
    sigCtx.setTransform(1, 0, 0, 1, 0, 0);
    sigCtx.clearRect(0, 0, signaturePad.width, signaturePad.height);
    sigCtx.restore();
    hasSignature = false;
    updateConfirmState();
  }

  function sigPos(e) {
    const rect = signaturePad.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  signaturePad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sigDrawing = true;
    try { signaturePad.setPointerCapture(e.pointerId); } catch {}
    const p = sigPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(p.x, p.y);
    sigCtx.lineTo(p.x + 0.1, p.y + 0.1);
    sigCtx.stroke();
    hasSignature = true;
    updateConfirmState();
  });

  signaturePad.addEventListener('pointermove', (e) => {
    if (!sigDrawing) return;
    const p = sigPos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    signaturePad.addEventListener(ev, () => { sigDrawing = false; });
  });

  clearSignatureBtn.addEventListener('click', clearSignature);

  function currentEmployee() {
    try {
      const s = JSON.parse(localStorage.getItem('tms.session.v1'));
      if (s) return { code: s.empCode || '', name: s.username || '' };
    } catch {}
    return { code: '', name: '' };
  }

  function empKeyOf(emp) {
    if (!emp) return '|';
    return `${emp.code || ''}|${emp.name || ''}`;
  }

  function departmentLabel(emp) {
    if (!emp || (!emp.name && !emp.code)) return 'מחלקה לא מזוהה';
    return emp.name || `קוד ${emp.code}`;
  }

  // "שחרור" — the single confirmation button of the issue screen
  scanConfirmBtn.addEventListener('click', () => {
    if (!hasSignature) return;
    const resolved = resolveSerial();
    if (!resolved.ok) {
      showIssueError(resolved.error || 'יש לסרוק או להקליד מספר מסופון');
      return;
    }
    let signature = null;
    try { signature = signaturePad.toDataURL('image/png'); } catch {}
    // The station (returns department) is logged in – it is the issuer, automatically.
    // The terminal itself is registered to the receiving department chosen in the form.
    const issuer = { ...currentEmployee(), name: ISSUING_STATION };
    const employee = scanMode === 'return' ? (issueMed ? issueMed.employee : issuer) : selectedDept();
    if (scanMode !== 'return' && !employee) {
      showIssueError('יש לבחור מחלקה מקבלת');
      return;
    }
    if (scanMode === 'transfer' && resolved.source &&
        empKeyOf(resolved.source.employee) === empKeyOf(employee)) {
      showIssueError('המסופון כבר נמצא במחלקה שנבחרה – אין צורך בהעברה');
      return;
    }
    const receiver = scanMode === 'return' ? null : {
      name: recvName.value.trim(),
      empNo: recvEmpNo.value.trim(),
    };
    const now = Date.now();

    if (scanMode === 'return' && issueMed) {
      const medId = issueMed.id;
      state.meds = state.meds.filter((m) => m.id !== medId);
      state.history.push({
        id: uid(),
        name: resolved.serial,
        action: 'הוחזר',
        employee,
        issuer,
        receiver: issueMed.receiver || null,
        signature,
        takenAt: now,
      });
    } else if (scanMode === 'transfer' && resolved.source) {
      const fromEmployee = resolved.source.employee;
      const med = state.meds.find((m) => m.id === resolved.source.id);
      if (med) {
        med.employee = employee;
        med.receiver = receiver;
        med.signature = signature;
        med.transferredAt = now;
        med.transferredFrom = fromEmployee;
      }
      state.history.push({
        id: uid(),
        name: resolved.serial,
        action: 'הועבר',
        employee,
        fromEmployee,
        issuer,
        receiver,
        signature,
        takenAt: now,
      });
    } else {
      state.meds.push({
        id: uid(),
        name: resolved.serial,
        model: resolved.model,
        employee,
        issuer,
        receiver,
        signature,
        times: [],
        days: [],
        createdAt: now,
      });
      state.history.push({
        id: uid(),
        name: resolved.serial,
        action: 'נלקח',
        employee,
        issuer,
        receiver,
        signature,
        takenAt: now,
      });
    }

    saveState();
    render();
    closeSignScreen();
  });

  $('#transferBtn').addEventListener('click', () => openIssueScreen('transfer'));
  addTimeBtn.addEventListener('click', () => addTimeRow(''));
  cancelBtn.addEventListener('click', closeModal);

  medModal.addEventListener('click', (e) => {
    if (e.target === medModal) closeModal();
  });

  medForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = medNameInput.value.trim();
    if (!name) return;

    const times = Array.from(timesContainer.querySelectorAll('.time-display'))
      .map((b) => b.dataset.time)
      .filter((v) => !!v);

    const daysToSave = selectedDays.length > 0 ? [...selectedDays] : [...ALL_DAYS];

    if (editingId) {
      const med = state.meds.find((m) => m.id === editingId);
      if (med) {
        med.name = name;
        med.times = times;
        med.shape = selectedShape;
        med.color = selectedColor;
        med.days = daysToSave;
      }
    } else {
      state.meds.push({
        id: uid(),
        name,
        times,
        shape: selectedShape,
        color: selectedColor,
        days: daysToSave,
        createdAt: Date.now(),
      });
    }

    saveState();
    render();
    closeModal();
  });

  // ---------- Actions ----------
  function recordTaken(med) {
    state.history.push({
      id: uid(),
      medId: med.id,
      name: med.name,
      shape: med.shape || DEFAULT_SHAPE,
      color: med.color || DEFAULT_COLOR,
      takenAt: Date.now(),
    });
    saveState();
    renderHistory();
    flashTook(med.id);
  }

  function flashTook(medId) {
    const cards = medsList.querySelectorAll('.med-card');
    cards.forEach((card, idx) => {
      if (state.meds[idx] && state.meds[idx].id === medId) {
        const btn = card.querySelector('.took-btn');
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = '✓ נרשם';
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
        }, 1200);
      }
    });
  }

  function deleteMed(id) {
    state.meds = state.meds.filter((m) => m.id !== id);
    // Also remove related triggers and snoozes
    Object.keys(state.triggered).forEach((k) => {
      if (k.startsWith(id + '__')) delete state.triggered[k];
    });
    state.snoozes = state.snoozes.filter((sn) => sn.medId !== id);
    saveState();
    render();
  }

  function deleteHistoryEntry(id) {
    state.history = state.history.filter((h) => h.id !== id);
    saveState();
    renderHistory();
  }

  // ---------- Confirm dialog ----------
  function confirmAction(text, onConfirm, okLabel = 'מחק') {
    confirmText.textContent = text;
    confirmOk.textContent = okLabel;
    pendingConfirm = onConfirm;
    confirmModal.classList.remove('hidden');
  }

  confirmOk.addEventListener('click', () => {
    if (pendingConfirm) pendingConfirm();
    pendingConfirm = null;
    confirmModal.classList.add('hidden');
  });

  confirmCancel.addEventListener('click', () => {
    pendingConfirm = null;
    confirmModal.classList.add('hidden');
  });

  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) {
      pendingConfirm = null;
      confirmModal.classList.add('hidden');
    }
  });

  // ---------- Settings ----------
  function openSettings() {
    remindersToggle.checked = !!state.settings.remindersEnabled;
    updatePermissionStatus();
    renderInstallSection();
    settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
  }

  function updatePermissionStatus() {
    if (!('Notification' in window)) {
      permissionStatus.textContent = 'הדפדפן לא תומך בהתראות. צליל בתוך האפליקציה יפעל בכל מקרה.';
      return;
    }
    const p = Notification.permission;
    if (!state.settings.remindersEnabled) {
      permissionStatus.textContent = '';
      return;
    }
    if (p === 'granted') {
      permissionStatus.textContent = 'התראות מופעלות ✓';
    } else if (p === 'denied') {
      permissionStatus.textContent = 'התראות חסומות בדפדפן. ניתן לאפשר בהגדרות האתר. צליל יפעל כל עוד האפליקציה פתוחה.';
    } else {
      permissionStatus.textContent = 'בקשת הרשאה להתראות תופיע בלחיצה הבאה.';
    }
  }

  navSettings.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  remindersToggle.addEventListener('change', async () => {
    state.settings.remindersEnabled = remindersToggle.checked;
    saveState();
    if (remindersToggle.checked) {
      // Unlock audio on this user gesture
      unlockAudio();
      await requestNotificationPermission();
    }
    updatePermissionStatus();
  });

  testSoundBtn.addEventListener('click', () => {
    unlockAudio();
    playReminderSound();
  });

  // ---------- Audio ----------
  function unlockAudio() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch {}
  }

  function playReminderSound() {
    try {
      unlockAudio();
      if (!audioCtx) return;
      const tones = [
        { freq: 660,  start: 0,    dur: 0.18 },
        { freq: 880,  start: 0.22, dur: 0.18 },
        { freq: 1100, start: 0.44, dur: 0.32 },
      ];
      const t0 = audioCtx.currentTime;
      tones.forEach(({ freq, start, dur }) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0 + start);
        gain.gain.linearRampToValueAtTime(0.28, t0 + start + 0.02);
        gain.gain.setValueAtTime(0.28, t0 + start + dur - 0.05);
        gain.gain.linearRampToValueAtTime(0, t0 + start + dur);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.02);
      });
    } catch (e) {
      console.warn('audio failed', e);
    }
  }

  // Unlock audio on first user interaction anywhere
  ['click', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, unlockAudio, { once: true, passive: true });
  });

  // ---------- Notifications ----------
  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  function showNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, {
            body,
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            tag: 'med-reminder',
            renotify: true,
            vibrate: [300, 150, 300, 150, 300],
            requireInteraction: true,
          });
        }).catch(() => {
          new Notification(title, { body, icon: 'icons/icon-192.png' });
        });
      } else {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
    } catch {}
  }

  // ---------- Reminder logic ----------
  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function checkReminders() {
    if (!state.settings.remindersEnabled) return;
    if (state.meds.length === 0 && state.snoozes.length === 0) return;

    const now = new Date();
    const today = todayStr();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const todayDow = now.getDay();

    // Scheduled reminders
    state.meds.forEach((med) => {
      const medDays = Array.isArray(med.days) ? med.days : ALL_DAYS;
      if (!medDays.includes(todayDow)) return; // skip if today not scheduled
      med.times.forEach((time) => {
        const [h, m] = time.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) return;
        const scheduled = h * 60 + m;
        const diff = currentMin - scheduled;
        const key = `${med.id}__${time}__${today}`;
        if (diff >= 0 && diff <= REMINDER_WINDOW_MIN && !state.triggered[key]) {
          state.triggered[key] = Date.now();
          saveState();
          triggerReminder(med, time, false);
        }
      });
    });

    // Snoozes
    let changed = false;
    const remaining = [];
    state.snoozes.forEach((sn) => {
      if (Date.now() >= sn.snoozeUntil) {
        const med = state.meds.find((m) => m.id === sn.medId);
        if (med) triggerReminder(med, sn.time, true);
        changed = true;
      } else {
        remaining.push(sn);
      }
    });
    if (changed) {
      state.snoozes = remaining;
      saveState();
    }
  }

  function triggerReminder(med, time, isSnooze) {
    playReminderSound();
    const title = `הגיע הזמן לקחת: ${med.name}`;
    const body = isSnooze ? `תזכורת חוזרת לשעה ${time}` : `שעה: ${time}`;
    showNotification(title, body);
    showReminderModal(med, time, isSnooze);
  }

  function showReminderModal(med, time, isSnooze) {
    activeReminder = { medId: med.id, time, isSnooze };
    reminderPillIcon.innerHTML = buildMedIconSVG(med.shape || DEFAULT_SHAPE, med.color || DEFAULT_COLOR);
    reminderMedName.textContent = med.name;
    reminderTime.textContent = isSnooze ? `תזכורת חוזרת · שעה ${time}` : `שעה ${time}`;
    reminderModal.classList.remove('hidden');
  }

  function closeReminderModal() {
    reminderModal.classList.add('hidden');
    activeReminder = null;
  }

  reminderTook.addEventListener('click', () => {
    if (!activeReminder) return;
    const med = state.meds.find((m) => m.id === activeReminder.medId);
    if (med) recordTaken(med);
    closeReminderModal();
  });

  reminderSnooze.addEventListener('click', () => {
    if (!activeReminder) return;
    const snoozeUntil = Date.now() + 10 * 60 * 1000;
    state.snoozes.push({
      medId: activeReminder.medId,
      time: activeReminder.time,
      snoozeUntil,
    });
    saveState();
    closeReminderModal();
  });

  reminderDismiss.addEventListener('click', closeReminderModal);

  // Re-check when tab regains focus (e.g., user comes back to app)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkReminders();
    }
  });

  // ---------- Time picker (smartphone-style wheels) ----------
  const HOURS_LIST = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINUTES_LIST = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const ITEM_H = 52;
  const SPACER_H = 94;

  const timePickerModal = $('#timePickerModal');
  const hourWheel = $('#hourWheel');
  const minuteWheel = $('#minuteWheel');
  const timePickerCancel = $('#timePickerCancel');
  const timePickerOk = $('#timePickerOk');
  let activeTimeButton = null;

  function buildWheel(wheel, values) {
    wheel.innerHTML = '';
    const topSpacer = document.createElement('div');
    topSpacer.className = 'wheel-spacer';
    wheel.append(topSpacer);
    values.forEach((v) => {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = v;
      item.dataset.value = v;
      item.addEventListener('click', () => {
        scrollWheelToValue(wheel, v, true);
      });
      wheel.append(item);
    });
    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'wheel-spacer';
    wheel.append(bottomSpacer);
    setupWheelScroll(wheel);
  }

  function setupWheelScroll(wheel) {
    if (wheel._scrollHandlerSet) return;
    wheel.addEventListener('scroll', () => updateWheelActive(wheel), { passive: true });
    wheel._scrollHandlerSet = true;
  }

  function updateWheelActive(wheel) {
    const idx = Math.round(wheel.scrollTop / ITEM_H);
    const items = wheel.querySelectorAll('.wheel-item');
    items.forEach((item, i) => {
      item.classList.toggle('active', i === idx);
    });
  }

  function scrollWheelToValue(wheel, value, smooth) {
    const items = wheel.querySelectorAll('.wheel-item');
    let idx = -1;
    items.forEach((it, i) => {
      if (it.dataset.value === value) idx = i;
    });
    if (idx < 0) idx = 0;
    wheel.scrollTo({
      top: idx * ITEM_H,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function getWheelValue(wheel) {
    const idx = Math.round(wheel.scrollTop / ITEM_H);
    const items = wheel.querySelectorAll('.wheel-item');
    if (items[idx]) return items[idx].dataset.value;
    return null;
  }

  function openTimePicker(button) {
    activeTimeButton = button;
    buildWheel(hourWheel, HOURS_LIST);
    buildWheel(minuteWheel, MINUTES_LIST);

    let initial = button.dataset.time;
    if (!initial) {
      const now = new Date();
      initial = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    const [h, m] = initial.split(':');

    timePickerModal.classList.remove('hidden');
    // Two RAFs ensure the modal has full layout before we scroll
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollWheelToValue(hourWheel, h, false);
        scrollWheelToValue(minuteWheel, m || '00', false);
        updateWheelActive(hourWheel);
        updateWheelActive(minuteWheel);
      });
    });
  }

  function closeTimePicker() {
    timePickerModal.classList.add('hidden');
    activeTimeButton = null;
  }

  function confirmTimePicker() {
    if (!activeTimeButton) {
      closeTimePicker();
      return;
    }
    const h = getWheelValue(hourWheel) || '00';
    const m = getWheelValue(minuteWheel) || '00';
    const value = `${h}:${m}`;
    activeTimeButton.dataset.time = value;
    activeTimeButton.textContent = value;
    activeTimeButton.classList.remove('empty');
    closeTimePicker();
  }

  timePickerCancel.addEventListener('click', closeTimePicker);
  timePickerOk.addEventListener('click', confirmTimePicker);
  timePickerModal.addEventListener('click', (e) => {
    if (e.target === timePickerModal) closeTimePicker();
  });

  // ---------- PWA installation ----------
  let deferredInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    renderInstallSection();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    renderInstallSection();
  });

  function isIOS() {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function renderInstallSection() {
    const section = document.querySelector('.install-section');
    const el = document.getElementById('installContent');
    if (!el || !section) return;
    el.className = 'install-content';

    if (isStandalone()) {
      section.classList.remove('hidden');
      el.innerHTML = '<p class="install-status">✓ האפליקציה מותקנת ופועלת ממסך הבית.</p>';
      return;
    }

    if (deferredInstallPrompt) {
      section.classList.remove('hidden');
      el.innerHTML = `
        <p>לחץ על הכפתור כדי להתקין את האפליקציה במכשיר:</p>
        <button id="installBtnNow" type="button" class="primary-btn">התקן עכשיו</button>
      `;
      const btn = el.querySelector('#installBtnNow');
      btn.addEventListener('click', triggerInstall);
      return;
    }

    if (isIOS()) {
      section.classList.remove('hidden');
      el.innerHTML = `
        <p><strong>באייפון / אייפד:</strong></p>
        <ol class="install-steps">
          <li>פתח את האתר ב-Safari (לא Chrome).</li>
          <li>לחץ על כפתור השיתוף <span class="share-icon">⎙</span> בתחתית המסך.</li>
          <li>גלול ובחר "הוסף למסך הבית" (Add to Home Screen).</li>
          <li>לחץ "הוסף" בפינה הימנית העליונה.</li>
        </ol>
        <p class="install-hint">האפליקציה תופיע על מסך הבית כמו אפליקציה רגילה.</p>
      `;
      return;
    }

    if (isAndroid()) {
      section.classList.remove('hidden');
      el.innerHTML = `
        <p><strong>בגלקסי / אנדרואיד:</strong></p>
        <ol class="install-steps">
          <li>פתח את האתר ב-Chrome.</li>
          <li>לחץ על תפריט שלוש הנקודות בפינה העליונה.</li>
          <li>בחר "הוסף למסך הבית" או "התקן אפליקציה".</li>
        </ol>
        <p class="install-hint">לאחר ההתקנה האפליקציה תופיע במגירת האפליקציות.</p>
      `;
      return;
    }

    // Desktop without install prompt — hide the entire section
    section.classList.add('hidden');
    el.innerHTML = '';
  }

  async function triggerInstall() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try {
      await deferredInstallPrompt.userChoice;
    } catch {}
    deferredInstallPrompt = null;
    renderInstallSection();
  }

  // ---------- Service worker (auto-update on new version) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // Detect when a new version is installed and auto-reload
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.location.reload();
            }
          });
        });
        // Periodically check for updates (every 60 seconds while page is open)
        setInterval(() => reg.update().catch(() => {}), 60 * 1000);
      }).catch(() => {});

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  // ---------- Modal X close buttons (event delegation) ----------
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest && e.target.closest('.modal-close');
    if (!closeBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const target = closeBtn.dataset.close;
    switch (target) {
      case 'medModal':
        closeModal();
        break;
      case 'settingsModal':
        closeSettings();
        break;
      case 'timePickerModal':
        closeTimePicker();
        break;
      case 'reminderModal':
        closeReminderModal();
        break;
      case 'signScreen':
        closeSignScreen();
        break;
      case 'confirmModal':
        pendingConfirm = null;
        confirmModal.classList.add('hidden');
        break;
      default: {
        // Fallback: just hide the closest modal
        const modal = closeBtn.closest('.modal');
        if (modal) modal.classList.add('hidden');
      }
    }
  });

  // ---------- Init ----------
  ensureDefaultDepartments();
  render();
  openIssueScreen('take'); // the issue form is the department's main screen
  checkReminders();
  setInterval(checkReminders, CHECK_INTERVAL_MS);
})();
