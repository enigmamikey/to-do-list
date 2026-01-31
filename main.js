(() => {
  "use strict";

  const STORAGE_KEY = "outline_todo_v1";
  let state = { tasks: [] };

  const outlineEl = document.getElementById("outline");
  const statusEl = document.getElementById("status");

  const addRootForm = document.getElementById("addRootForm");
  const rootDate = document.getElementById("rootDate");
  const rootText = document.getElementById("rootText");

  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importInput = document.getElementById("importInput");
  const mergeImport = document.getElementById("mergeImport");

  const expandAllBtn = document.getElementById("expandAllBtn");
  const collapseAllBtn = document.getElementById("collapseAllBtn");

  // Active selection for keyboard shortcuts
  let activeTaskId = null;

  // Drag state
  let dragCtx = null; // { draggedId, parentPath, dateKey }

  let statusTimer = null;

  function uid() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function showError(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  }

  function isValidISODateString(iso) {
    if (iso === null) return true;
    if (typeof iso !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;

    const [yStr, mStr, dStr] = iso.split("-");
    const y = Number(yStr), m = Number(mStr), d = Number(dStr);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;

    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === (m - 1) && dt.getUTCDate() === d;
  }

  function normalizeDateInput(value) {
    if (!value) return null;
    return isValidISODateString(value) ? value : null;
  }

  function dateSortKey(date) {
    return date ? date : "9999-12-31";
  }

  function compareTasksByDate(a, b) {
    const ka = dateSortKey(a.date);
    const kb = dateSortKey(b.date);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Date display: M/D if current year, else M/D/YYYY
  function formatDateForDisplay(isoDate) {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-").map(Number);
    const now = new Date();
    const currentYear = now.getFullYear();
    if (y === currentYear) return `${m}/${d}`;
    return `${m}/${d}/${y}`;
  }

  function dateKeyForGrouping(date) {
    return date ? date : "__none__";
  }

  // Marker labels by depth:
  // 0: 1,2,3
  // 1: A,B,C
  // 2: i,ii,iii
  // 3: a,b,c
  // 4: 1,2,3 (repeat)
  function markerFor(depth, indexZeroBased) {
    const n = indexZeroBased + 1;
    switch (depth % 4) {
      case 0: return `${n}.`;
      case 1: return `${toAlpha(n, true)}.`;
      case 2: return `${toRoman(n).toLowerCase()}.`;
      case 3: return `${toAlpha(n, false)}.`;
      default: return `${n}.`;
    }
  }

  function toAlpha(n, upper) {
    // 1 -> A, 26 -> Z, 27 -> AA
    let s = "";
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return upper ? s : s.toLowerCase();
  }

  function toRoman(num) {
    const vals = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
      [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
      [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
    ];
    let res = "";
    for (const [v, sym] of vals) {
      while (num >= v) { res += sym; num -= v; }
    }
    return res || "I";
  }

  function levelClassForDepth(depth) {
    return `level-${Math.min(depth + 1, 6)}`;
  }

  function getArrayByParentPath(parentPath) {
    let arr = state.tasks;
    for (const idx of parentPath) {
      arr = arr[idx].subtasks;
    }
    return arr;
  }

  function enforceGroupOrderingInArray(arr) {
    // Keep date groups in order, preserve manual order within group.
    const groups = new Map();
    for (const t of arr) {
      const k = dateKeyForGrouping(t.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }

    const keys = Array.from(groups.keys());
    keys.sort((a, b) => {
      const ka = (a === "__none__") ? "9999-12-31" : a;
      const kb = (b === "__none__") ? "9999-12-31" : b;
      return ka.localeCompare(kb);
    });

    const rebuilt = [];
    for (const k of keys) rebuilt.push(...groups.get(k));
    arr.splice(0, arr.length, ...rebuilt);
  }

  function sortAllArraysRecursively(tasks) {
    tasks.sort(compareTasksByDate);
    for (const t of tasks) sortAllArraysRecursively(t.subtasks);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const validated = validateImportedState(parsed);
      state = validated;
    } catch {
      state = { tasks: [] };
      showError("Stored data was corrupted; started with a fresh list.");
    }
  }

  // ----- Import validation -----
  function validateTask(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Bad task object");

    const id = (typeof obj.id === "string" && obj.id) ? obj.id : uid();

    const date = (obj.date === null || obj.date === "" || obj.date === undefined) ? null : obj.date;
    if (!isValidISODateString(date)) throw new Error("Invalid date in task");

    const text = (typeof obj.text === "string") ? obj.text : "";
    const collapsed = !!obj.collapsed;

    const subtasksRaw = Array.isArray(obj.subtasks) ? obj.subtasks : [];
    const subtasks = subtasksRaw.map(validateTask);

    return { id, date, text, subtasks, collapsed };
  }

  function validateImportedState(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Bad import");
    const tasksRaw = Array.isArray(obj.tasks) ? obj.tasks : [];
    const tasks = tasksRaw.map(validateTask);
    sortAllArraysRecursively(tasks);
    return { tasks };
  }

  function makeNewTask(date, text) {
    return { id: uid(), date: date, text: text || "", subtasks: [], collapsed: false };
  }

  // ----- Expand/Collapse All -----
  function setAllCollapsed(tasks, collapsed) {
    for (const t of tasks) {
      if (t.subtasks.length) t.collapsed = collapsed;
      setAllCollapsed(t.subtasks, collapsed);
    }
  }

  expandAllBtn.addEventListener("click", () => {
    setAllCollapsed(state.tasks, false);
    save();
    render();
  });

  collapseAllBtn.addEventListener("click", () => {
    setAllCollapsed(state.tasks, true);
    save();
    render();
  });

  // ----- Find helpers (for keyboard operations) -----
  function findTaskInfoById(id, arr = state.tasks, parentPath = []) {
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t.id === id) {
        return { task: t, index: i, parentPath, arr };
      }
      const child = findTaskInfoById(id, t.subtasks, parentPath.concat(i));
      if (child) return child;
    }
    return null;
  }

  // ----- Rendering -----
  function render() {
    outlineEl.innerHTML = "";
    outlineEl.className = `outline-root ${levelClassForDepth(0)}`;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.tasks.length; i++) {
      frag.appendChild(renderTaskItem(state.tasks[i], [], i, 0));
    }
    outlineEl.appendChild(frag);
  }

  function renderTaskItem(task, parentPath, index, depth) {
    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.taskId = task.id;
    if (task.collapsed) li.classList.add("collapsed");
    li.draggable = true;

    const row = document.createElement("div");
    row.className = "task-row";
    row.addEventListener("mousedown", () => {
      activeTaskId = task.id;
    });

    // Caret (left of marker)
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "caret" + (task.subtasks.length ? "" : " hidden");
    caret.textContent = task.subtasks.length ? (task.collapsed ? "▶" : "▼") : "";
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!task.subtasks.length) return;
      task.collapsed = !task.collapsed;
      save();
      render();
    });

    // Marker (our numbering)
    const marker = document.createElement("span");
    marker.className = "marker";
    marker.textContent = markerFor(depth, index);

    // Date (only render if not null)
    let dateSpan = null;
    if (task.date) {
      dateSpan = document.createElement("span");
      dateSpan.className = "task-date";
      dateSpan.textContent = formatDateForDisplay(task.date);
      dateSpan.title = "Click to edit date";
      dateSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        startInlineDateEdit(dateSpan, task);
      });
    }

    // Text
    const textSpan = document.createElement("span");
    textSpan.className = "task-text";
    textSpan.textContent = task.text || "";
    textSpan.title = "Click to edit text";
    textSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      startInlineTextEdit(textSpan, task);
    });

    // Actions (hover)
    const actions = document.createElement("span");
    actions.className = "task-actions";

    const addSubBtn = document.createElement("button");
    addSubBtn.type = "button";
    addSubBtn.textContent = "Add Subtask";
    addSubBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      task.subtasks.push(makeNewTask(null, ""));
      task.collapsed = false;
      sortAllArraysRecursively(state.tasks);
      save();
      render();
    });

    // NEW: Set/Remove date toggle (no keyboard shortcut)
    const dateToggleBtn = document.createElement("button");
    dateToggleBtn.type = "button";
    dateToggleBtn.textContent = task.date ? "Remove Date" : "Set Date";
    dateToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();

    if (task.date) {
      // remove date
      task.date = null;
      sortAllArraysRecursively(state.tasks);
      enforceGroupOrderingInArray(state.tasks);
      save();
      render();
    } else {
      // set date (open picker)
      startInlineDateSetFromButton(task);
    }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    actions.appendChild(addSubBtn);
    actions.appendChild(dateToggleBtn);
    actions.appendChild(delBtn);


    row.appendChild(caret);
    row.appendChild(marker);
    if (dateSpan) row.appendChild(dateSpan);
    row.appendChild(textSpan);
    row.appendChild(actions);

    // Subtasks list
    const subOl = document.createElement("ol");
    subOl.className = levelClassForDepth(depth + 1);
    for (let j = 0; j < task.subtasks.length; j++) {
      subOl.appendChild(renderTaskItem(task.subtasks[j], parentPath.concat(index), j, depth + 1));
    }

    li.appendChild(row);
    li.appendChild(subOl);

    attachDragHandlers(li, task, parentPath);

    return li;
  }

// Open a date picker from a hover button.
// If browser supports showPicker(), it pops immediately; otherwise click will open it.
function startInlineDateSetFromButton(task) {
  const input = document.createElement("input");
  input.type = "date";
  input.value = "";
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "-9999px";
  document.body.appendChild(input);

  const cleanup = () => input.remove();

  input.addEventListener("change", () => {
    if (input.value && !isValidISODateString(input.value)) {
      showError("Invalid date.");
      cleanup();
      return;
    }
    task.date = normalizeDateInput(input.value);

    // Date changed → resort/group
    sortAllArraysRecursively(state.tasks);
    enforceGroupOrderingInArray(state.tasks);

    save();
    render();
    cleanup();
  });

  input.addEventListener("blur", cleanup);

  // Trigger picker
  input.showPicker?.();
  input.click();
}


  // ----- Inline editing -----
  function startInlineTextEdit(textEl, task) {
    const input = document.createElement("span");
    input.className = "task-text";
    input.contentEditable = "true";
    input.textContent = task.text || "";

    const commit = () => {
      task.text = input.textContent || "";
      save();
      render();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); render(); }
      // Tab indent/outdent while editing: allow the global handler to manage
    });
    input.addEventListener("blur", commit);

    textEl.replaceWith(input);
    input.focus();

    // cursor to end
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function startInlineDateEdit(dateEl, task) {
    const input = document.createElement("input");
    input.type = "date";
    input.value = task.date || "";
    input.style.marginRight = "0.25em";

    const commit = () => {
      if (input.value && !isValidISODateString(input.value)) {
        showError("Invalid date.");
        render();
        return;
      }
      task.date = normalizeDateInput(input.value);

      // Date changed → resort/group
      sortAllArraysRecursively(state.tasks);
      enforceGroupOrderingInArray(state.tasks);

      save();
      render();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); render(); }
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    });
    input.addEventListener("blur", commit);

    // If date becomes null, we'll re-render with no date span (hidden)
    dateEl.replaceWith(input);
    input.focus();
  }

  // ----- Delete -----
  function deleteTask(taskId) {
    const removed = removeTaskRecursive(state.tasks, taskId);
    if (!removed) showError("Task not found.");
    save();
    render();
  }

  function removeTaskRecursive(arr, taskId) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === taskId) {
        arr.splice(i, 1);
        // If we deleted the selected one, clear selection
        if (activeTaskId === taskId) activeTaskId = null;
        return true;
      }
      if (removeTaskRecursive(arr[i].subtasks, taskId)) return true;
    }
    return false;
  }

  // ----- Drag & Drop (restricted: same parent + same date group) -----
  function attachDragHandlers(li, task, parentPath) {
    li.addEventListener("dragstart", (e) => {
      li.classList.add("dragging");
      dragCtx = {
        draggedId: task.id,
        parentPath: parentPath.slice(),
        dateKey: dateKeyForGrouping(task.date)
      };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
    });

    li.addEventListener("dragend", () => {
      li.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
      delete li.dataset.dropPosition;
      dragCtx = null;
      clearDropIndicators();
    });

    li.addEventListener("dragover", (e) => {
      if (!dragCtx) return;
      e.preventDefault();

      const ok = isDropAllowed(task, parentPath);
      if (!ok) return;

      const rect = li.getBoundingClientRect();
      const offset = e.clientY - rect.top;
      li.classList.remove("drag-over-top", "drag-over-bottom");
      if (offset < rect.height / 2) {
        li.classList.add("drag-over-top");
        li.dataset.dropPosition = "top";
      } else {
        li.classList.add("drag-over-bottom");
        li.dataset.dropPosition = "bottom";
      }
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over-top", "drag-over-bottom");
      delete li.dataset.dropPosition;
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragCtx) return;

      const ok = isDropAllowed(task, parentPath);
      if (!ok) {
        showError("Drop not allowed (different date group or different parent).");
        return;
      }

      const draggedId = dragCtx.draggedId;
      if (draggedId === task.id) return;

      const arr = getArrayByParentPath(parentPath);
      const fromIdx = arr.findIndex(t => t.id === draggedId);
      const toIdx = arr.findIndex(t => t.id === task.id);
      if (fromIdx < 0 || toIdx < 0) return;

      const [moved] = arr.splice(fromIdx, 1);

      if (li.dataset.dropPosition === "top") {
        const insertIdx = (fromIdx < toIdx) ? toIdx - 1 : toIdx;
        arr.splice(insertIdx, 0, moved);
      } else {
        const insertIdx = (fromIdx < toIdx) ? toIdx : toIdx + 1;
        arr.splice(insertIdx, 0, moved);
      }

      enforceGroupOrderingInArray(arr);
      save();
      render();
    });
  }

  function clearDropIndicators() {
    document.querySelectorAll(".drag-over-top,.drag-over-bottom")
      .forEach(el => el.classList.remove("drag-over-top", "drag-over-bottom"));
  }

  function isDropAllowed(targetTask, targetParentPath) {
    if (!dragCtx) return false;
    if (JSON.stringify(dragCtx.parentPath) !== JSON.stringify(targetParentPath)) return false;
    return dateKeyForGrouping(targetTask.date) === dragCtx.dateKey;
  }

  // ----- Root Add -----
  addRootForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const date = normalizeDateInput(rootDate.value);
    const text = (rootText.value || "").trim();
    if (!text) return;

    state.tasks.push(makeNewTask(date, text));
    enforceGroupOrderingInArray(state.tasks);

    save();
    render();

    rootText.value = "";
    rootDate.value = "";
    rootText.focus();
  });

  // ----- Export / Import -----
  exportBtn.addEventListener("click", () => {
    const payload = JSON.stringify(state, null, 2);
    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, "0");
    const dd = String(stamp.getDate()).padStart(2, "0");
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mi = String(stamp.getMinutes()).padStart(2, "0");
    download(`todo_backup_${yyyy}-${mm}-${dd}_${hh}${mi}.json`, payload);
  });

  importBtn.addEventListener("click", () => importInput.click());

  importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = validateImportedState(parsed);

      if (mergeImport.checked) {
        state.tasks.push(...deepClone(imported.tasks));
        enforceGroupOrderingInArray(state.tasks);
      } else {
        state = imported;
      }

      save();
      render();
    } catch (err) {
      showError(`Import failed: ${err?.message || "invalid file"}`);
    } finally {
      importInput.value = "";
    }
  });

  // ----- Keyboard Shortcuts -----
  document.addEventListener("keydown", (e) => {
    // Ignore when typing in inputs (except Tab/Shift+Tab which we want)
    const target = e.target;
    const isEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    // We still want Tab shortcuts even while editing text
    const key = e.key;

    if (!activeTaskId) return;

    // Tab / Shift+Tab: indent/outdent
    if (key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) outdentActive();
      else indentActive();
      return;
    }

    if (isEditable) {
      // While editing, let keys pass (except Tab handled above)
      return;
    }

    if (key === "Enter") {
      e.preventDefault();
      addSiblingAfterActive();
      return;
    }

    if (key === "ArrowLeft") {
      e.preventDefault();
      collapseActive();
      return;
    }

    if (key === "ArrowRight") {
      e.preventDefault();
      expandActive();
      return;
    }
  });

  function addSiblingAfterActive() {
    const info = findTaskInfoById(activeTaskId);
    if (!info) return;

    const { task, index, parentPath, arr } = info;
    const newTask = makeNewTask(task.date, "");
    arr.splice(index + 1, 0, newTask);

    // Keep date groups ordered but allow manual order in same group
    enforceGroupOrderingInArray(arr);

    save();
    render();
    activeTaskId = newTask.id;
  }

  function indentActive() {
    const info = findTaskInfoById(activeTaskId);
    if (!info) return;

    const { task, index, parentPath, arr } = info;
    if (index === 0) return; // no previous sibling to indent into

    const prev = arr[index - 1];

    // Remove from current array and add as last subtask of previous sibling
    arr.splice(index, 1);
    prev.subtasks.push(task);
    prev.collapsed = false;

    save();
    render();
  }

  function outdentActive() {
    const info = findTaskInfoById(activeTaskId);
    if (!info) return;

    const { task, index, parentPath } = info;
    if (parentPath.length === 0) return; // already root

    // Parent is at parentPath's last index in its parent's array
    const parentIndex = parentPath[parentPath.length - 1];
    const grandParentPath = parentPath.slice(0, -1);
    const grandArr = getArrayByParentPath(grandParentPath);
    const parentTask = grandArr[parentIndex];

    // Remove from parent's subtasks
    parentTask.subtasks.splice(index, 1);

    // Insert right after the parent in grandparent array
    grandArr.splice(parentIndex + 1, 0, task);

    enforceGroupOrderingInArray(grandArr);

    save();
    render();
  }

  function collapseActive() {
    const info = findTaskInfoById(activeTaskId);
    if (!info) return;
    if (!info.task.subtasks.length) return;
    info.task.collapsed = true;
    save();
    render();
  }

  function expandActive() {
    const info = findTaskInfoById(activeTaskId);
    if (!info) return;
    if (!info.task.subtasks.length) return;
    info.task.collapsed = false;
    save();
    render();
  }

  // ----- Init -----
  load();
  enforceGroupOrderingInArray(state.tasks);
  save();
  render();
})();
