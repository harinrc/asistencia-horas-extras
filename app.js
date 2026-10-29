(() => {
  "use strict";

  const LOCAL_STORAGE_KEY = "horas-claras-data-v1";
  const appConfig = window.APP_CONFIG?.firebase || {};
  const firebaseKeys = ["apiKey", "authDomain", "projectId", "appId"];
  const firebaseEnabled = firebaseKeys.every((key) => Boolean(appConfig[key]));
  const firebasePartiallyConfigured = firebaseKeys.some((key) => Boolean(appConfig[key])) && !firebaseEnabled;
  const state = { employees: [], records: [], user: null, database: null, auth: null, ready: false, saving: false };
  const byId = (id) => document.getElementById(id);
  const dayNames = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setMessage(element, text, isError = false) {
    element.textContent = text;
    element.classList.toggle("message-error", isError);
  }

  function announce(text, isError = false) {
    setMessage(byId("global-message"), text, isError);
  }

  function makeId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readLocalData() {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return { employees: [], records: [] };
    const data = JSON.parse(stored);
    if (!Array.isArray(data.employees) || !Array.isArray(data.records)) {
      throw new Error("Los datos guardados localmente tienen un formato inválido.");
    }
    return data;
  }

  function collection(name) {
    if (!state.user || !state.database) throw new Error("Inicia sesión para guardar los datos.");
    return state.database.collection("users").doc(state.user.uid).collection(name);
  }

  async function saveItem(collectionName, item) {
    if (!state.ready) throw new Error("Los datos no están disponibles. Recarga la página y verifica el almacenamiento.");
    if (firebaseEnabled) {
      await collection(collectionName).doc(item.id).set(item);
      return;
    }
    const updatedItems = state[collectionName].filter((current) => current.id !== item.id);
    updatedItems.push(item);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      employees: collectionName === "employees" ? updatedItems : state.employees,
      records: collectionName === "records" ? updatedItems : state.records
    }));
  }

  async function removeItem(collectionName, id) {
    if (!state.ready) throw new Error("Los datos no están disponibles. Recarga la página y verifica el almacenamiento.");
    if (firebaseEnabled) {
      await collection(collectionName).doc(id).delete();
      return;
    }
    const updatedItems = state[collectionName].filter((item) => item.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      employees: collectionName === "employees" ? updatedItems : state.employees,
      records: collectionName === "records" ? updatedItems : state.records
    }));
  }

  function parseDate(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function getPeriodDates() {
    const startText = byId("period-start").value;
    const endText = byId("period-end").value;
    if (!startText || !endText || startText > endText) return [];
    const dates = [];
    const current = parseDate(startText);
    const end = parseDate(endText);
    while (current <= end) {
      dates.push(localDateString(current));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  function formatDate(dateText, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
    return parseDate(dateText).toLocaleDateString("es-MX", options);
  }

  function getRecordInterval(record) {
    const [year, month, day] = record.date.split("-").map(Number);
    const [startHour, startMinute] = record.start.split(":").map(Number);
    const [endHour, endMinute] = record.end.split(":").map(Number);
    const start = new Date(year, month - 1, day, startHour, startMinute);
    const end = new Date(year, month - 1, day, endHour, endMinute);
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
  }

  function calculateOvertimeMinutes(record) {
    const { start, end } = getRecordInterval(record);
    let overtime = 0;
    let cursor = new Date(start);
    while (cursor < end) {
      const nextDay = new Date(cursor);
      nextDay.setHours(24, 0, 0, 0);
      const segmentEnd = nextDay < end ? nextDay : end;
      const dayOfWeek = cursor.getDay();
      let regularStartHour = null;
      let regularEndHour = null;
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        regularStartHour = 8;
        regularEndHour = 17;
      } else if (dayOfWeek === 6) {
        regularStartHour = 8;
        regularEndHour = 12;
      }

      const segmentMinutes = (segmentEnd - cursor) / 60000;
      let regularMinutes = 0;
      if (regularStartHour !== null) {
        const regularStart = new Date(cursor);
        regularStart.setHours(regularStartHour, 0, 0, 0);
        const regularEnd = new Date(cursor);
        regularEnd.setHours(regularEndHour, 0, 0, 0);
        const overlapStart = new Date(Math.max(cursor.getTime(), regularStart.getTime()));
        const overlapEnd = new Date(Math.min(segmentEnd.getTime(), regularEnd.getTime()));
        regularMinutes = Math.max(0, (overlapEnd - overlapStart) / 60000);
      }
      overtime += segmentMinutes - regularMinutes;
      cursor = segmentEnd;
    }
    return Math.round(overtime);
  }

  function formatMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }

  function minutesForDay(employeeId, date, records = state.records) {
    return records
      .filter((record) => record.employeeId === employeeId && record.date === date)
      .reduce((sum, record) => sum + calculateOvertimeMinutes(record), 0);
  }

  function recordsForDay(employeeId, date, records = state.records) {
    return records
      .filter((record) => record.employeeId === employeeId && record.date === date)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  function formatTime(timeText, isEnd = false, startText = "") {
    if (!timeText) return "";
    const [hours, minutes] = timeText.split(":").map(Number);
    const label = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    return isEnd && timeText <= startText ? `${label} (+1 día)` : label;
  }

  function createCell(row, text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function renderEmployees() {
    const container = byId("employee-list");
    container.replaceChildren();
    const employees = [...state.employees].sort((a, b) => a.name.localeCompare(b.name, "es"));
    employees.forEach((employee) => {
      const item = document.createElement("div");
      item.className = "employee-item";
      const details = document.createElement("div");
      details.className = "employee-name";
      const name = document.createElement("strong");
      name.textContent = employee.name;
      const role = document.createElement("span");
      role.textContent = employee.role + (employee.active === false ? " · Inactivo" : "");
      details.append(name, role);
      const button = document.createElement("button");
      button.className = "text-button";
      button.type = "button";
      const hasRecords = state.records.some((record) => record.employeeId === employee.id);
      button.textContent = hasRecords ? (employee.active === false ? "Reactivar" : "Desactivar") : "Eliminar";
      button.setAttribute("aria-label", `${button.textContent} a ${employee.name}`);
      button.addEventListener("click", () => hasRecords ? toggleEmployee(employee) : deleteEmployee(employee));
      item.append(details, button);
      container.appendChild(item);
    });
    if (employees.length === 0) {
      const empty = document.createElement("p");
      empty.className = "helper-text";
      empty.textContent = "Agrega al primer colaborador para comenzar.";
      container.appendChild(empty);
    }
  }

  function addTimeInput(row, employee, date, part, value, className) {
    const cell = document.createElement("td");
    cell.className = className;
    const input = document.createElement("input");
    input.type = "time";
    input.className = "matrix-time-input";
    input.value = value || "";
    input.dataset.employeeId = employee.id;
    input.dataset.date = date;
    input.dataset.part = part;
    input.setAttribute("aria-label", `${part === "start" ? "Entrada" : "Salida"} de ${employee.name}, ${formatDate(date)}`);
    cell.appendChild(input);
    row.appendChild(cell);
  }

  function renderSchedule() {
    const table = byId("schedule-table");
    table.replaceChildren();
    byId("schedule-table").parentElement.scrollLeft = 0;
    const dates = getPeriodDates();
    if (!dates.length) {
      setMessage(byId("matrix-message"), "Elige un rango de fechas válido para ver la planilla.", true);
      byId("total-overtime").textContent = "0:00";
      byId("period-caption").textContent = "Selecciona un período válido";
      return;
    }
    setMessage(byId("matrix-message"), "");
    const header = document.createElement("thead");
    const groupRow = document.createElement("tr");
    groupRow.className = "group-header";
    [
      ["NOMBRES Y APELLIDOS", "sticky-name"],
      ["CARGO", "sticky-role"],
      ["TOTAL DE HORAS", "sticky-employee-total"]
    ].forEach(([text, className]) => {
      const cell = document.createElement("th");
      cell.rowSpan = 2;
      cell.textContent = text;
      cell.className = className;
      groupRow.appendChild(cell);
    });
    dates.forEach((date) => {
      const cell = document.createElement("th");
      cell.colSpan = 3;
      cell.className = "day-group";
      const dayName = dayNames[parseDate(date).getDay()];
      cell.innerHTML = `${dayName}<span>${formatDate(date, { day: "2-digit", month: "2-digit", year: "numeric" })}</span>`;
      groupRow.appendChild(cell);
    });
    header.appendChild(groupRow);

    const subheadRow = document.createElement("tr");
    subheadRow.className = "subhead-row";
    dates.forEach(() => {
      ["ENTRADA", "SALIDA", "HORAS EXTRAS"].forEach((label, index) => {
        const cell = document.createElement("th");
        cell.textContent = label;
        if (index === 2) cell.className = "overtime-header";
        subheadRow.appendChild(cell);
      });
    });
    header.appendChild(subheadRow);
    table.appendChild(header);

    const body = document.createElement("tbody");
    const employees = [...state.employees].sort((a, b) => a.name.localeCompare(b.name, "es"));
    employees.forEach((employee) => {
      const row = document.createElement("tr");
      if (employee.active === false) row.className = "inactive-row";
      createCell(row, employee.name, "sticky-name employee-name-cell");
      createCell(row, employee.role, "sticky-role");
      const totalCell = createCell(row, "", "sticky-employee-total employee-total-cell");
      let employeeTotal = 0;
      dates.forEach((date) => {
        const dayRecords = recordsForDay(employee.id, date);
        const firstRecord = dayRecords[0];
        const existingStart = firstRecord?.start || "";
        const existingEnd = firstRecord?.end || "";
        const overtime = minutesForDay(employee.id, date);
        employeeTotal += overtime;
        addTimeInput(row, employee, date, "start", existingStart, "time-cell");
        addTimeInput(row, employee, date, "end", existingEnd, "time-cell");
        const extraCell = createCell(row, formatMinutes(overtime), "overtime-cell");
        extraCell.dataset.employeeId = employee.id;
        extraCell.dataset.date = date;
        if (dayRecords.length > 1) extraCell.title = `Hay ${dayRecords.length} turnos guardados este día`;
      });
      totalCell.textContent = formatMinutes(employeeTotal);
      body.appendChild(row);
    });
    if (!employees.length) {
      const row = document.createElement("tr");
      const message = createCell(row, "Agrega colaboradores para comenzar a llenar esta planilla.", "matrix-empty");
      message.colSpan = 3 + dates.length * 3;
      body.appendChild(row);
    }
    table.appendChild(body);

    const dailyTotals = new Map(dates.map((date) => [date, 0]));
    let grandTotal = 0;
    state.records.forEach((record) => {
      if (!dailyTotals.has(record.date)) return;
      const minutes = calculateOvertimeMinutes(record);
      dailyTotals.set(record.date, dailyTotals.get(record.date) + minutes);
      grandTotal += minutes;
    });
    const footer = document.createElement("tfoot");
    const totalsRow = document.createElement("tr");
    totalsRow.className = "grand-total-row";
    const label = document.createElement("th");
    label.colSpan = 2;
    label.textContent = "TOTAL GENERAL DEL DÍA";
    totalsRow.appendChild(label);
    createCell(totalsRow, formatMinutes(grandTotal), "sticky-employee-total grand-total-cell");
    dates.forEach((date) => {
      createCell(totalsRow, "", "footer-empty-cell");
      createCell(totalsRow, "", "footer-empty-cell");
      const dailyTotal = createCell(totalsRow, formatMinutes(dailyTotals.get(date)), "overtime-cell day-total-cell");
      dailyTotal.dataset.date = date;
    });
    footer.appendChild(totalsRow);
    table.appendChild(footer);

    byId("total-overtime").textContent = formatMinutes(grandTotal);
    const start = byId("period-start").value;
    const end = byId("period-end").value;
    byId("period-caption").textContent = `${formatDate(start)} – ${formatDate(end)} · ${dates.length} días`;
    table.querySelectorAll(".matrix-time-input").forEach((input) => {
      input.addEventListener("change", () => updateDayPreview(input.dataset.employeeId, input.dataset.date));
    });
  }

  function updateDayPreview(employeeId, date) {
    const startInput = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employeeId)}"][data-date="${date}"][data-part="start"]`);
    const endInput = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employeeId)}"][data-date="${date}"][data-part="end"]`);
    const extraCell = byId("schedule-table").querySelector(`.overtime-cell[data-employee-id="${CSS.escape(employeeId)}"][data-date="${date}"]`);
    if (!startInput || !endInput || !extraCell || !startInput.value || !endInput.value || startInput.value === endInput.value) {
      if (extraCell) extraCell.textContent = "0:00";
    } else {
      extraCell.textContent = formatMinutes(calculateOvertimeMinutes({ date, start: startInput.value, end: endInput.value }));
    }
    let employeeTotal = 0;
    let grandTotal = 0;
    getPeriodDates().forEach((currentDate) => {
      const inputStart = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employeeId)}"][data-date="${currentDate}"][data-part="start"]`);
      const inputEnd = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employeeId)}"][data-date="${currentDate}"][data-part="end"]`);
      const cell = byId("schedule-table").querySelector(`.overtime-cell[data-employee-id="${CSS.escape(employeeId)}"][data-date="${currentDate}"]`);
      const currentDayRecords = recordsForDay(employeeId, currentDate);
      const minutes = currentDayRecords.length > 1 &&
        inputStart?.value === currentDayRecords[0].start &&
        inputEnd?.value === currentDayRecords[0].end
        ? minutesForDay(employeeId, currentDate)
        : inputStart?.value && inputEnd?.value && inputStart.value !== inputEnd.value
          ? calculateOvertimeMinutes({ date: currentDate, start: inputStart.value, end: inputEnd.value })
          : 0;
      employeeTotal += minutes;
      grandTotal += minutes;
    });
    const employeeRow = startInput.closest("tr");
    employeeRow.querySelector(".employee-total-cell").textContent = formatMinutes(employeeTotal);
    const otherEmployeeRows = [...byId("schedule-table").querySelectorAll("tbody tr")].filter((row) => row !== employeeRow);
    otherEmployeeRows.forEach((row) => {
      const employeeIdForRow = row.querySelector(".matrix-time-input")?.dataset.employeeId;
      if (!employeeIdForRow) return;
      getPeriodDates().forEach((currentDate) => {
        const cell = byId("schedule-table").querySelector(`.overtime-cell[data-employee-id="${CSS.escape(employeeIdForRow)}"][data-date="${currentDate}"]`);
        grandTotal += Number(cell?.textContent.split(":")[0] || 0) * 60 + Number(cell?.textContent.split(":")[1] || 0);
      });
    });
    byId("total-overtime").textContent = formatMinutes(grandTotal);
    updateDailyPreview(date);
  }

  function updateDailyPreview(date) {
    const totalCell = byId("schedule-table").querySelector(`.day-total-cell[data-date="${date}"]`);
    if (!totalCell) return;
    let total = 0;
    byId("schedule-table").querySelectorAll(`.overtime-cell[data-employee-id][data-date="${date}"]`).forEach((cell) => {
      const [hours, minutes] = cell.textContent.split(":").map(Number);
      total += hours * 60 + minutes;
    });
    totalCell.textContent = formatMinutes(total);
  }

  function render() {
    renderEmployees();
    const start = byId("period-start").value;
    const end = byId("period-end").value;
    if (start && end && start > end) {
      setMessage(byId("matrix-message"), "La fecha inicial no puede ser posterior a la fecha final.", true);
      byId("schedule-table").replaceChildren();
      byId("total-overtime").textContent = "0:00";
      byId("period-caption").textContent = "Selecciona un período válido";
      return;
    }
    renderSchedule();
  }

  async function toggleEmployee(employee) {
    const updated = { ...employee, active: employee.active === false };
    try {
      await saveItem("employees", updated);
      state.employees = state.employees.map((item) => item.id === updated.id ? updated : item);
      render();
      announce(`${updated.name} ${updated.active ? "reactivado" : "desactivado"}.`);
    } catch (error) {
      announce(`No se pudo actualizar al colaborador: ${error.message}`, true);
    }
  }

  async function deleteEmployee(employee) {
    if (!window.confirm(`¿Eliminar a ${employee.name}?`)) return;
    try {
      await removeItem("employees", employee.id);
      state.employees = state.employees.filter((item) => item.id !== employee.id);
      render();
      announce("Colaborador eliminado.");
    } catch (error) {
      announce(`No se pudo eliminar al colaborador: ${error.message}`, true);
    }
  }

  async function handleEmployeeSubmit(event) {
    event.preventDefault();
    const name = byId("employee-name").value.trim();
    const role = byId("employee-role").value.trim();
    if (!name || !role) return;
    const employee = { id: makeId(), name, role, active: true };
    try {
      await saveItem("employees", employee);
      state.employees.push(employee);
      byId("employee-form").reset();
      render();
      setMessage(byId("employee-message"), "Colaborador agregado a la planilla.");
    } catch (error) {
      setMessage(byId("employee-message"), `No se pudo guardar: ${error.message}`, true);
    }
  }

  function readScheduleValues() {
    const dates = getPeriodDates();
    const values = [];
    for (const employee of state.employees) {
      for (const date of dates) {
        const start = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employee.id)}"][data-date="${date}"][data-part="start"]`)?.value || "";
        const end = byId("schedule-table").querySelector(`input[data-employee-id="${CSS.escape(employee.id)}"][data-date="${date}"][data-part="end"]`)?.value || "";
        if ((start && !end) || (!start && end)) {
          throw new Error(`Completa entrada y salida de ${employee.name} para ${formatDate(date)}.`);
        }
        if (start && end && start === end) {
          throw new Error(`La entrada y salida de ${employee.name} no pueden ser iguales (${formatDate(date)}).`);
        }
        if (start && end) values.push({ employeeId: employee.id, date, start, end });
      }
    }
    return values;
  }

  function recordsOverlap(first, second) {
    if (first.employeeId !== second.employeeId) return false;
    const firstInterval = getRecordInterval(first);
    const secondInterval = getRecordInterval(second);
    return firstInterval.start < secondInterval.end && secondInterval.start < firstInterval.end;
  }

  function buildScheduleChanges(values) {
    const dates = new Set(getPeriodDates());
    const desiredByDay = new Map(values.map((value) => [`${value.employeeId}|${value.date}`, value]));
    const currentInPeriod = state.records.filter((record) => dates.has(record.date));
    const preserved = state.records.filter((record) => !dates.has(record.date));
    const nextInPeriod = [];
    const updates = [];
    const deletions = [];
    const handledKeys = new Set();

    currentInPeriod.forEach((record) => {
      const key = `${record.employeeId}|${record.date}`;
      if (handledKeys.has(key)) return;
      handledKeys.add(key);
      const sameDayRecords = currentInPeriod.filter((item) => item.employeeId === record.employeeId && item.date === record.date);
      const desired = desiredByDay.get(key);
      if (!desired) {
        sameDayRecords.forEach((item) => deletions.push(item));
        return;
      }
      if (sameDayRecords[0].start === desired.start && sameDayRecords[0].end === desired.end) {
        nextInPeriod.push(...sameDayRecords);
        desiredByDay.delete(key);
        return;
      }
      const updated = { ...desired, id: sameDayRecords[0].id };
      updates.push(updated);
      nextInPeriod.push(updated);
      sameDayRecords.slice(1).forEach((item) => deletions.push(item));
      desiredByDay.delete(key);
    });

    desiredByDay.forEach((desired) => {
      const added = { ...desired, id: makeId() };
      updates.push(added);
      nextInPeriod.push(added);
    });

    const allRecords = [...preserved, ...nextInPeriod];
    const checkedRecords = [];
    for (const record of allRecords) {
      if (checkedRecords.some((existing) => recordsOverlap(existing, record))) {
        const employee = state.employees.find((item) => item.id === record.employeeId);
        throw new Error(`El horario de ${employee?.name || "un colaborador"} se traslapa con otro registro. Revisa turnos que crucen de fecha.`);
      }
      checkedRecords.push(record);
    }
    return { updates, deletions, records: allRecords };
  }

  async function persistScheduleChanges({ updates, deletions }) {
    if (!state.ready) throw new Error("Los datos no están disponibles. Recarga la página y verifica el almacenamiento.");
    if (!firebaseEnabled) {
      const updatedIds = new Set(updates.map((record) => record.id));
      const deletedIds = new Set(deletions.map((record) => record.id));
      const records = state.records.filter((record) => !deletedIds.has(record.id) && !updatedIds.has(record.id));
      records.push(...updates);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ employees: state.employees, records }));
      return;
    }
    const operations = [
      ...updates.map((record) => ({ type: "set", record })),
      ...deletions.map((record) => ({ type: "delete", record }))
    ];
    for (let offset = 0; offset < operations.length; offset += 400) {
      const batch = state.database.batch();
      operations.slice(offset, offset + 400).forEach((operation) => {
        const reference = collection("records").doc(operation.record.id);
        if (operation.type === "set") batch.set(reference, operation.record);
        else batch.delete(reference);
      });
      await batch.commit();
    }
  }

  async function saveSchedule() {
    if (state.saving) return;
    state.saving = true;
    const button = byId("save-schedule-button");
    button.disabled = true;
    setMessage(byId("matrix-message"), "Guardando horarios...");
    try {
      const values = readScheduleValues();
      const changes = buildScheduleChanges(values);
      await persistScheduleChanges(changes);
      state.records = changes.records;
      render();
      announce("Horarios guardados correctamente.");
    } catch (error) {
      if (firebaseEnabled) {
        try {
          const snapshot = await collection("records").get();
          state.records = snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
          render();
        } catch (refreshError) {
          setMessage(byId("matrix-message"), `No se guardaron todos los cambios: ${error.message}. Tampoco se pudo actualizar la planilla: ${refreshError.message}`, true);
        }
      } else {
        setMessage(byId("matrix-message"), error.message, true);
      }
      if (!firebaseEnabled || !byId("matrix-message").textContent.includes("Tampoco")) {
        setMessage(byId("matrix-message"), `No se pudieron guardar los horarios: ${error.message}`, true);
      }
    } finally {
      state.saving = false;
      button.disabled = false;
    }
  }

  function excelTime(timeText) {
    if (!timeText) return null;
    const [hours, minutes] = timeText.split(":").map(Number);
    return (hours * 60 + minutes) / 1440;
  }

  function applyCellStyle(cell, { fill, color = "20312C", bold = false, size = 10, horizontal = "center" } = {}) {
    cell.font = { name: "Calibri", size, bold, color: { argb: `FF${color}` } };
    cell.alignment = { vertical: "middle", horizontal, wrapText: true };
    if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${fill}` } };
    cell.border = {
      top: { style: "thin", color: { argb: "FF59645F" } },
      left: { style: "thin", color: { argb: "FF59645F" } },
      bottom: { style: "thin", color: { argb: "FF59645F" } },
      right: { style: "thin", color: { argb: "FF59645F" } }
    };
  }

  function setExcelDuration(cell, minutes, isTotal = false, fill) {
    cell.value = minutes / 1440;
    cell.numFmt = "[h]:mm";
    applyCellStyle(cell, {
      fill: fill || (isTotal ? "DCEEF6" : "DCEAF3"),
      color: "163F5B",
      bold: true
    });
  }

  function addSpreadsheetWorksheet(workbook, dates, periodLabel) {
    const worksheet = workbook.addWorksheet("Planilla", {
      views: [{ state: "frozen", xSplit: 3, ySplit: 5, topLeftCell: "D6" }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      properties: { defaultRowHeight: 23 }
    });
    const columnCount = 3 + dates.length * 3;
    worksheet.mergeCells(1, 1, 1, columnCount);
    worksheet.getCell(1, 1).value = "REPORTE DE HORAS EXTRAS";
    applyCellStyle(worksheet.getCell(1, 1), { fill: "173F36", color: "FFFFFF", bold: true, size: 15 });
    worksheet.getRow(1).height = 32;
    worksheet.mergeCells(2, 1, 2, columnCount);
    worksheet.getCell(2, 1).value = periodLabel;
    applyCellStyle(worksheet.getCell(2, 1), { fill: "EAF2ED", color: "36544A", bold: true, size: 11 });
    worksheet.getRow(2).height = 25;

    ["NOMBRES Y APELLIDOS", "CARGO", "TOTAL DE HORAS"].forEach((label, index) => {
      const column = index + 1;
      worksheet.mergeCells(4, column, 5, column);
      worksheet.getCell(4, column).value = label;
      applyCellStyle(worksheet.getCell(4, column), {
        fill: index === 2 ? "A9D49A" : "E6ECE8",
        color: "20312C",
        bold: true
      });
    });
    worksheet.getColumn(1).width = 34;
    worksheet.getColumn(2).width = 20;
    worksheet.getColumn(3).width = 15;

    dates.forEach((date, index) => {
      const firstColumn = 4 + index * 3;
      worksheet.mergeCells(4, firstColumn, 4, firstColumn + 2);
      const day = worksheet.getCell(4, firstColumn);
      day.value = `${dayNames[parseDate(date).getDay()]} · ${formatDate(date)}`;
      applyCellStyle(day, { fill: "DCEAF3", color: "20312C", bold: true });
      ["ENTRADA", "SALIDA", "HORAS EXTRAS"].forEach((label, subIndex) => {
        const cell = worksheet.getCell(5, firstColumn + subIndex);
        cell.value = label;
        applyCellStyle(cell, {
          fill: subIndex === 2 ? "C6DFF0" : "EEF4F7",
          color: "20312C",
          bold: true,
          size: 9
        });
        worksheet.getColumn(firstColumn + subIndex).width = subIndex === 2 ? 14 : 12;
      });
    });
    worksheet.getRow(4).height = 30;
    worksheet.getRow(5).height = 27;

    const employees = [...state.employees].sort((a, b) => a.name.localeCompare(b.name, "es"));
    const employeeStartRow = 6;
    let grandTotal = 0;
    employees.forEach((employee, employeeIndex) => {
      const rowNumber = employeeStartRow + employeeIndex;
      const rowFill = employeeIndex % 2 === 0 ? "FFFFFF" : "F7FAF8";
      const nameCell = worksheet.getCell(rowNumber, 1);
      nameCell.value = employee.name;
      applyCellStyle(nameCell, { fill: rowFill, bold: true, horizontal: "left" });
      const roleCell = worksheet.getCell(rowNumber, 2);
      roleCell.value = employee.role;
      applyCellStyle(roleCell, { fill: rowFill, horizontal: "left" });
      let employeeTotal = 0;
      dates.forEach((date, index) => {
        const column = 4 + index * 3;
        const dayRecords = recordsForDay(employee.id, date);
        const record = dayRecords[0];
        const dayMinutes = minutesForDay(employee.id, date);
        employeeTotal += dayMinutes;
        const startCell = worksheet.getCell(rowNumber, column);
        startCell.value = record ? excelTime(record.start) : null;
        if (record) startCell.numFmt = "h:mm AM/PM";
        applyCellStyle(startCell, { fill: rowFill });
        const endCell = worksheet.getCell(rowNumber, column + 1);
        endCell.value = record ? excelTime(record.end) : null;
        if (record) endCell.numFmt = "h:mm AM/PM";
        applyCellStyle(endCell, { fill: rowFill });
        const totalCell = worksheet.getCell(rowNumber, column + 2);
        setExcelDuration(totalCell, dayMinutes);
      });
      grandTotal += employeeTotal;
      setExcelDuration(worksheet.getCell(rowNumber, 3), employeeTotal, true, "CDE8C5");
    });

    const totalRowNumber = employeeStartRow + employees.length;
    worksheet.mergeCells(totalRowNumber, 1, totalRowNumber, 2);
    const totalLabel = worksheet.getCell(totalRowNumber, 1);
    totalLabel.value = "TOTAL GENERAL";
    applyCellStyle(totalLabel, { fill: "173F36", color: "FFFFFF", bold: true, size: 11, horizontal: "left" });
    setExcelDuration(worksheet.getCell(totalRowNumber, 3), grandTotal, true);
    dates.forEach((date, index) => {
      const column = 4 + index * 3;
      worksheet.getCell(totalRowNumber, column).value = "";
      applyCellStyle(worksheet.getCell(totalRowNumber, column), { fill: "E8EFEB" });
      worksheet.getCell(totalRowNumber, column + 1).value = "";
      applyCellStyle(worksheet.getCell(totalRowNumber, column + 1), { fill: "E8EFEB" });
      setExcelDuration(
        worksheet.getCell(totalRowNumber, column + 2),
        employees.reduce((sum, employee) => sum + minutesForDay(employee.id, date), 0),
        true
      );
    });
    worksheet.getRow(totalRowNumber).height = 27;
    worksheet.headerFooter.oddFooter = "&LControl de horas extras&C&H&Página &P de &N&R" + periodLabel;
    return { worksheet, employees, grandTotal, employeeStartRow };
  }

  async function exportWorkbook() {
    const dates = getPeriodDates();
    if (!dates.length) {
      announce("Selecciona un período válido antes de exportar.", true);
      return;
    }
    if (!state.ready) {
      announce("Los datos no están disponibles; no se puede generar la exportación.", true);
      return;
    }
    if (!window.ExcelJS) {
      announce("No se pudo cargar el formato de Excel. Revisa tu conexión a internet e inténtalo de nuevo.", true);
      return;
    }
    try {
      const start = byId("period-start").value;
      const end = byId("period-end").value;
      const periodLabel = `Período: ${formatDate(start)} al ${formatDate(end)}`;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Horas claras";
      workbook.created = new Date();
      const { employees, grandTotal } = addSpreadsheetWorksheet(workbook, dates, periodLabel);

      const summary = workbook.addWorksheet("Resumen", {
        views: [{ state: "frozen", ySplit: 4 }],
        pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
      });
      summary.mergeCells("A1:E1");
      summary.getCell("A1").value = "RESUMEN DE HORAS EXTRAS";
      applyCellStyle(summary.getCell("A1"), { fill: "173F36", color: "FFFFFF", bold: true, size: 15 });
      summary.getRow(1).height = 32;
      summary.mergeCells("A2:E2");
      summary.getCell("A2").value = periodLabel;
      applyCellStyle(summary.getCell("A2"), { fill: "EAF2ED", color: "36544A", bold: true, size: 11 });
      summary.getCell("A3").value = "TOTAL GENERAL";
      applyCellStyle(summary.getCell("A3"), { fill: "DCEEF6", bold: true });
      setExcelDuration(summary.getCell("B3"), grandTotal, true);
      summary.mergeCells("B3:E3");
      summary.getCell("B3").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      const headers = ["Colaborador", "Cargo", "Días con registro", "Turnos", "Horas extras"];
      headers.forEach((label, index) => {
        const cell = summary.getCell(5, index + 1);
        cell.value = label;
        applyCellStyle(cell, { fill: "DCEAF3", bold: true });
      });
      employees.forEach((employee, index) => {
        const row = 6 + index;
        const employeeRecords = state.records.filter((record) =>
          record.employeeId === employee.id && dates.includes(record.date)
        );
        const dayCount = new Set(employeeRecords.map((record) => record.date)).size;
        const minutes = employeeRecords.reduce((sum, record) => sum + calculateOvertimeMinutes(record), 0);
        [employee.name, employee.role, dayCount, employeeRecords.length].forEach((value, column) => {
          const cell = summary.getCell(row, column + 1);
          cell.value = value;
          applyCellStyle(cell, { fill: index % 2 ? "F7FAF8" : "FFFFFF", horizontal: column > 1 ? "center" : "left" });
        });
        setExcelDuration(summary.getCell(row, 5), minutes, true);
      });
      summary.columns = [{ width: 34 }, { width: 24 }, { width: 22 }, { width: 14 }, { width: 18 }];
      summary.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + employees.length, column: 5 } };

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporte-horas-extras-${start}-a-${end}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      announce("Planilla de Excel con formato y resumen exportada correctamente.");
    } catch (error) {
      announce(`No se pudo crear el archivo de Excel: ${error.message}`, true);
    }
  }

  async function loadCloudData(user) {
    state.user = user;
    const [employeesSnapshot, recordsSnapshot] = await Promise.all([
      collection("employees").get(),
      collection("records").get()
    ]);
    state.employees = employeesSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
    state.records = recordsSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
    state.ready = true;
    byId("auth-panel").classList.add("hidden");
    byId("app-content").classList.remove("hidden");
    byId("sign-out-button").classList.remove("hidden");
    byId("storage-status").textContent = "Firebase conectado";
    render();
  }

  function configureLocalMode() {
    const data = readLocalData();
    state.employees = data.employees;
    state.records = data.records;
    state.ready = true;
    byId("storage-status").textContent = "Guardado en este dispositivo";
    render();
  }

  function configureFirebaseMode() {
    if (!window.firebase?.initializeApp || !window.firebase.auth || !window.firebase.firestore) {
      throw new Error("No se pudieron cargar los servicios de Firebase. Comprueba tu conexión a internet.");
    }
    const firebaseApp = window.firebase.initializeApp(appConfig);
    state.auth = firebaseApp.auth();
    state.database = firebaseApp.firestore();
    byId("storage-status").textContent = "Firebase · inicia sesión";
    byId("auth-panel").classList.remove("hidden");
    byId("app-content").classList.add("hidden");
    state.auth.onAuthStateChanged(async (user) => {
      if (!user) {
        state.user = null;
        state.ready = false;
        byId("auth-panel").classList.remove("hidden");
        byId("app-content").classList.add("hidden");
        byId("sign-out-button").classList.add("hidden");
        byId("storage-status").textContent = "Firebase · inicia sesión";
        return;
      }
      try {
        byId("storage-status").textContent = "Cargando Firebase...";
        await loadCloudData(user);
      } catch (error) {
        setMessage(byId("auth-message"), `No se pudieron cargar los datos: ${error.message}`, true);
      }
    });
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!state.auth) return;
    const email = byId("auth-email").value.trim();
    const password = byId("auth-password").value;
    const action = event.submitter?.value || "login";
    setMessage(byId("auth-message"), "");
    try {
      if (action === "register") await state.auth.createUserWithEmailAndPassword(email, password);
      else await state.auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      setMessage(byId("auth-message"), `No se pudo completar el acceso: ${error.message}`, true);
    }
  }

  function initialize() {
    const today = localDateString();
    byId("period-start").value = `${today.slice(0, 7)}-01`;
    byId("period-end").value = today;
    byId("employee-form").addEventListener("submit", handleEmployeeSubmit);
    byId("period-start").addEventListener("change", render);
    byId("period-end").addEventListener("change", render);
    byId("save-schedule-button").addEventListener("click", saveSchedule);
    byId("export-button").addEventListener("click", exportWorkbook);
    byId("new-period-button").addEventListener("click", () => {
      const currentDay = localDateString();
      byId("period-start").value = `${currentDay.slice(0, 7)}-01`;
      byId("period-end").value = currentDay;
      render();
      announce("Nuevo período iniciado. El historial anterior se conserva.");
    });
    byId("auth-form").addEventListener("submit", handleAuthSubmit);
    byId("sign-out-button").addEventListener("click", async () => {
      try {
        await state.auth.signOut();
      } catch (error) {
        announce(`No se pudo cerrar sesión: ${error.message}`, true);
      }
    });

    if (firebasePartiallyConfigured) {
      byId("storage-status").textContent = "Configuración incompleta";
      announce("Completa apiKey, authDomain, projectId y appId en firebase-config.js. No se guardarán datos localmente.", true);
      return;
    }
    if (firebaseEnabled) {
      try {
        configureFirebaseMode();
      } catch (error) {
        byId("storage-status").textContent = "Error de configuración";
        setMessage(byId("auth-message"), error.message, true);
        byId("auth-panel").classList.remove("hidden");
        byId("app-content").classList.add("hidden");
      }
      return;
    }
    try {
      configureLocalMode();
    } catch (error) {
      state.ready = true;
      byId("storage-status").textContent = "Error de almacenamiento";
      announce(`No se pudieron leer los datos guardados: ${error.message}`, true);
      state.employees = [];
      state.records = [];
      render();
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
