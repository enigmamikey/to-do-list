# to-do list

A keyboard-driven, outline-style to-do list designed for **dense, hierarchical task management** — closer to working in a Word outline than a typical “card-based” task app.

This project is intentionally **frontend-only**, offline-capable, and optimized for real daily use rather than demos or tutorials.

---

## Why this exists

I was using a large Word document to manage tasks with deep nesting (tasks → subtasks → sub-subtasks, etc.). As the document grew, the following became difficult.

- Reorder tasks reliably  
- Manage deep hierarchies without constant copy/paste  
- Keep related tasks grouped by date  
- Work efficiently with the keyboard  

This app was built to solve those problems directly.

---

## Core features

### Recursive outline structure
- Tasks can have unlimited nested subtasks
- Outline numbering cycles cleanly (`1 → A → i → a → 1 → …`)

### Keyboard-first workflow
- **Enter** → add sibling task  
- **Tab** → indent (make subtask)  
- **Shift + Tab** → outdent  
- **Arrow keys** → collapse / expand when applicable  

### Date-aware task grouping
- Dates are optional
- Tasks automatically group and sort by date
- Drag-and-drop is constrained so tasks cannot be moved across date groups incorrectly

### Collapse / expand hierarchy
- Per-task collapse via caret
- Expand-all / collapse-all controls

### Offline-first
- All data stored locally in the browser (`localStorage`)
- No backend, no accounts, no network dependency

### Import / export
- Export tasks to JSON for backup
- Import JSON (replace or merge)

### Dense, document-like UI
- Tasks occupy roughly the same vertical space as a Word outline
- Designed for long lists and deep nesting without visual clutter

---

## Design decisions (intentional constraints)

- **Frontend-only by design**  
  This is a personal productivity tool. Avoiding a backend keeps it fast, private, and reliable.

- **Local state instead of a database**  
  Simpler persistence and easy backup via JSON export.

- **Minimal styling**
  - Dark mode by default  
  - Emphasis on readability and density  
  - UI should disappear behind the content  

---

## How to use

1. Clone or download the repository  
2. Open `index.html` in a browser (no build step required)  
3. Start typing  

The app runs entirely offline.

---

## Project status

This is an actively used personal tool.  
Features are added cautiously, with priority given to usability and stability over expansion.

---

## Tech stack

- HTML
- CSS
- Vanilla JavaScript
- Browser `localStorage`

No frameworks, no dependencies.