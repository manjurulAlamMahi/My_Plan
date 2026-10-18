import { useEffect, useState } from 'react'
import { AUTO_LOCK_MINUTES } from './config.js'

// Storage Keys
const PLANS_KEY = 'myplan-plans'
const TODOS_KEY = 'tasknest-todos-v3'
const AUTH_KEY = 'myplan-unlocked'
const THEME_KEY = 'myplan-theme'
const ACTIVITY_KEY = 'myplan-last-activity'
const PIN_KEY = 'myplan-pin'
const MIN_PIN = 4
const IDLE_MS = (AUTO_LOCK_MINUTES || 10) * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours in ms

const EMPTY_PLAN_FORM = { priority: 'Natural', title: '', details: '', responsiblePerson: '' }
const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Natural: 3 }

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable
  }
}

const LAST_MIDNIGHT_RESET_KEY = 'tasknest-last-midnight-reset'

function getTodayDateString() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// Daily Midnight Reset: Resets all checked to-dos after 11:59 PM every day
function checkAndAutoResetTodos(items) {
  const today = getTodayDateString()
  const lastReset = load(LAST_MIDNIGHT_RESET_KEY, today)
  let changed = false

  if (lastReset !== today) {
    // Day has turned past 11:59 PM midnight! Reset all completed items
    const updated = items.map(item => {
      if (item.completed) {
        changed = true
        return { ...item, completed: false, completedDate: null, completedAt: null, lastResetAt: Date.now() }
      }
      return item
    })
    save(LAST_MIDNIGHT_RESET_KEY, today)
    return { updated, changed: true }
  }

  // Also check individual items in case of cross-day completion
  const updated = items.map(item => {
    if (item.completed && item.completedDate && item.completedDate !== today) {
      changed = true
      return { ...item, completed: false, completedDate: null, completedAt: null, lastResetAt: Date.now() }
    }
    return item
  })

  return { updated, changed }
}

// Thursday 11:59 PM Auto Cleanup helpers:
// Every Thursday after 11:59 PM, all completed tasks disappear.
function getNextThursday1159(fromTime = new Date()) {
  const target = new Date(fromTime)
  target.setHours(23, 59, 0, 0)
  const day = fromTime.getDay() // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  let daysUntilThursday = (4 - day + 7) % 7
  if (daysUntilThursday === 0 && fromTime.getTime() >= target.getTime()) {
    daysUntilThursday = 7
  }
  target.setDate(fromTime.getDate() + daysUntilThursday)
  return target
}

function getLatestPassedThursday1159(fromTime = new Date()) {
  const candidate = new Date(fromTime)
  candidate.setHours(23, 59, 0, 0)
  const day = fromTime.getDay()
  let daysBack = (day - 4 + 7) % 7
  if (daysBack === 0 && fromTime.getTime() < candidate.getTime()) {
    daysBack = 7
  }
  candidate.setDate(fromTime.getDate() - daysBack)
  return candidate
}

function loadInitialPlans() {
  const saved = load(PLANS_KEY, null)
  const list = saved && Array.isArray(saved) ? saved : []
  const now = new Date()
  const passedThursday = getLatestPassedThursday1159(now).getTime()
  return list
    .filter(p => !(p.done && p.doneAt && p.doneAt <= passedThursday))
    .map(p => (p.done && !p.doneAt ? { ...p, doneAt: Date.now() } : p))
}

// Password / PIN hashing
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin)
  if (!crypto?.subtle) return 'plain:' + btoa(salt + pin)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

async function setPin(pin) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  save(PIN_KEY, { salt, hash: await hashPin(pin, salt) })
}

async function checkPin(pin) {
  const stored = load(PIN_KEY, null)
  return !!stored && (await hashPin(pin, stored.salt)) === stored.hash
}

const SAMPLE_TODO_TITLES = new Set([
  'Morning workout & drink water',
  'Review today’s priority list',
  'Read 20 pages',
])

function loadInitialTodos() {
  const saved = load(TODOS_KEY, null)
  if (saved && Array.isArray(saved)) {
    // Filter out previous seed sample items so user starts with a completely clean board
    const cleaned = saved.filter(t => !SAMPLE_TODO_TITLES.has(t.title))
    return checkAndAutoResetTodos(cleaned).updated
  }
  // Default: start with no data displayed
  return []
}

export default function App() {
  const hasPin = !!load(PIN_KEY, null)
  const [unlocked, setUnlocked] = useState(() => {
    if (!hasPin) return true
    return load(AUTH_KEY, false) && Date.now() - load(ACTIVITY_KEY, 0) < IDLE_MS
  })
  const [theme, setTheme] = useState(() => load(THEME_KEY, 'dark'))
  const [currentNav, setCurrentNav] = useState('todos') // 'todos' | 'plans'
  const [pinModalOpen, setPinModalOpen] = useState(false)

  // Auto-lock on inactivity if PIN is set
  useEffect(() => {
    if (!unlocked || !hasPin) return
    let last = Date.now()
    let lastSaved = last
    save(ACTIVITY_KEY, last)

    function onActivity() {
      last = Date.now()
      if (last - lastSaved > 5000) {
        save(ACTIVITY_KEY, last)
        lastSaved = last
      }
    }

    const interval = setInterval(() => {
      if (Date.now() - last >= IDLE_MS) {
        save(AUTH_KEY, false)
        setUnlocked(false)
      }
    }, 15000)

    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    return () => {
      clearInterval(interval)
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity))
    }
  }, [unlocked, hasPin])

  // Sync theme
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    save(THEME_KEY, theme)
  }, [theme])

  function toggleTheme() {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }

  function handleLock() {
    if (hasPin) {
      save(AUTH_KEY, false)
      setUnlocked(false)
    } else {
      setPinModalOpen(true)
    }
  }

  if (hasPin && !unlocked) {
    return (
      <LoginScreen
        onUnlock={() => {
          save(AUTH_KEY, true)
          setUnlocked(true)
        }}
      />
    )
  }

  return (
    <div className="tasknest-app">
      {/* Top Navbar */}
      <Navbar
        currentNav={currentNav}
        onSelectNav={setCurrentNav}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLock={handleLock}
        hasPin={hasPin}
      />

      {/* Main Views */}
      {currentNav === 'todos' ? <DailyTodoView /> : <MyPlanView />}

      {/* PIN Modal */}
      {pinModalOpen && (
        <PinModal
          hasPin={hasPin}
          onClose={() => setPinModalOpen(false)}
          onSuccess={() => setPinModalOpen(false)}
        />
      )}
    </div>
  )
}

/* ==========================================================================
   NAVBAR
   ========================================================================== */
function Navbar({ currentNav, onSelectNav, theme, onToggleTheme, onLock, hasPin }) {
  const [plansCount, setPlansCount] = useState(0)
  const [todosCount, setTodosCount] = useState(0)

  useEffect(() => {
    function updateCounts() {
      const plans = load(PLANS_KEY, [])
      const todos = load(TODOS_KEY, [])
      setPlansCount(plans.filter(p => !p.done).length)
      setTodosCount(todos.filter(t => !t.completed).length)
    }
    updateCounts()
    const int = setInterval(updateCounts, 3000)
    return () => clearInterval(int)
  }, [currentNav])

  return (
    <header className="navbar">
      <div className="navbar-left">
        <div className="brand-badge">
          <div className="brand-icon">📋</div>
          <span className="brand-title">TaskNest</span>
        </div>

        {/* View Switcher Tabs */}
        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab-btn ${currentNav === 'todos' ? 'active' : ''}`}
            onClick={() => onSelectNav('todos')}
          >
            <span>✓ To Do List</span>
            {todosCount > 0 && <span className="nav-tab-counter">{todosCount}</span>}
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${currentNav === 'plans' ? 'active' : ''}`}
            onClick={() => onSelectNav('plans')}
          >
            <span>💼 My Task &amp; Plan</span>
            {plansCount > 0 && <span className="nav-tab-counter">{plansCount}</span>}
          </button>
        </nav>
      </div>

      <div className="navbar-right">
        <span className="nav-date">
          {new Date().toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </span>

        <button
          type="button"
          className="nav-icon-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <button
          type="button"
          className="nav-icon-btn"
          onClick={onLock}
          title={hasPin ? 'Lock screen' : 'Setup PIN protection'}
        >
          {hasPin ? '🔒' : '🔓'}
        </button>
      </div>
    </header>
  )
}

/* ==========================================================================
   SIMPLE TO DO LIST MODULE
   Left: All List (Check box, Title, Edit, Delete)
   Right: Title (Nothing else)
   ========================================================================== */
function DailyTodoView() {
  const [todos, setTodos] = useState(loadInitialTodos)
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'pending' | 'completed'
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [nowTime, setNowTime] = useState(Date.now())

  // Save to localStorage
  useEffect(() => {
    save(TODOS_KEY, todos)
  }, [todos])

  // Live timer interval: 1s for ticking countdown + 24h auto-reset check
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now())
      setTodos(prev => {
        const { updated, changed } = checkAndAutoResetTodos(prev)
        return changed ? updated : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  function toggleTodo(id) {
    setTodos(prev =>
      prev.map(item => {
        if (item.id === id) {
          const willComplete = !item.completed
          return {
            ...item,
            completed: willComplete,
            completedDate: willComplete ? getTodayDateString() : null,
            completedAt: willComplete ? Date.now() : null,
          }
        }
        return item
      })
    )
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return

    if (editingId) {
      setTodos(prev =>
        prev.map(item =>
          item.id === editingId ? { ...item, title: title.trim() } : item
        )
      )
      setEditingId(null)
    } else {
      const newTodo = {
        id: Date.now(),
        title: title.trim(),
        completed: false,
        completedDate: null,
        completedAt: null,
        createdAt: Date.now(),
      }
      setTodos(prev => [newTodo, ...prev])
    }
    setTitle('')
  }

  function startEdit(item) {
    setEditingId(item.id)
    setTitle(item.title)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setTitle('')
  }

  function deleteTodo(id) {
    if (!confirm('Delete this to-do?')) return
    setTodos(prev => prev.filter(item => item.id !== id))
    if (editingId === id) cancelEdit()
  }

  // Right-side action: Uncheck all at once
  function uncheckAll() {
    setTodos(prev =>
      prev.map(item =>
        item.completed
          ? { ...item, completed: false, completedDate: null, completedAt: null, lastResetAt: Date.now() }
          : item
      )
    )
  }

  // Right-side action: Delete based on current status filter
  function deleteTodosByStatus() {
    if (statusFilter === 'pending') {
      if (pendingCount === 0) return
      if (!confirm(`Delete all ${pendingCount} pending to-dos? This cannot be undone.`)) return
      setTodos(prev => prev.filter(t => t.completed))
      if (editingId) cancelEdit()
    } else if (statusFilter === 'completed') {
      if (completedCount === 0) return
      if (!confirm(`Delete all ${completedCount} completed to-dos? This cannot be undone.`)) return
      setTodos(prev => prev.filter(t => !t.completed))
      if (editingId) cancelEdit()
    } else {
      if (todos.length === 0) return
      if (!confirm(`Delete all ${todos.length} to-dos? This cannot be undone.`)) return
      setTodos([])
      if (editingId) cancelEdit()
    }
  }

  // Drag and drop reordering
  function handleDragStart(e, id) {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
  }

  function handleDragOver(e, id) {
    e.preventDefault()
    if (draggedId !== id) {
      setDragOverId(id)
    }
  }

  function handleDrop(e, targetId) {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }

    setTodos(prev => {
      const fromIdx = prev.findIndex(t => t.id === draggedId)
      const toIdx = prev.findIndex(t => t.id === targetId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const copy = [...prev]
      const [movedItem] = copy.splice(fromIdx, 1)
      copy.splice(toIdx, 0, movedItem)
      return copy
    })

    setDraggedId(null)
    setDragOverId(null)
  }

  function handleDragEnd() {
    setDraggedId(null)
    setDragOverId(null)
  }

  // Filtered to-dos based on right-side filter
  const completedCount = todos.filter(t => t.completed).length
  const pendingCount = todos.length - completedCount

  const visibleTodos = todos.filter(t => {
    if (statusFilter === 'pending') return !t.completed
    if (statusFilter === 'completed') return t.completed
    return true
  })

  // Live Countdown until Midnight (11:59:59 PM)
  const midnightCountdown = (() => {
    const now = new Date(nowTime)
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
    const diff = Math.max(0, midnight.getTime() - now.getTime())
    const hours = Math.floor(diff / 3600000)
    const mins = Math.floor((diff % 3600000) / 60000)
    const secs = Math.floor((diff % 60000) / 1000)
    return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`
  })()

  return (
    <div className="todo-layout">
      {/* LEFT SIDE: All List with Drag, Checkbox, Title, Edit, Delete */}
      <section className="panel todo-list-panel">
        <div className="todo-panel-header">
          <h2>To-Do List</h2>
          <span className="todo-count-badge">
            {completedCount} of {todos.length} done
          </span>
        </div>

        <div className="todo-items-list">
          {visibleTodos.length === 0 ? (
            <p className="empty">
              {todos.length === 0
                ? 'No to-dos yet. Add one from the right side 👉'
                : `No ${statusFilter} to-dos found.`}
            </p>
          ) : (
            visibleTodos.map(item => (
              <div
                key={item.id}
                draggable
                onDragStart={e => handleDragStart(e, item.id)}
                onDragOver={e => handleDragOver(e, item.id)}
                onDrop={e => handleDrop(e, item.id)}
                onDragEnd={handleDragEnd}
                className={`todo-row ${item.completed ? 'done' : ''} ${editingId === item.id ? 'editing' : ''} ${draggedId === item.id ? 'dragging' : ''} ${dragOverId === item.id ? 'drag-over' : ''}`}
              >
                {/* Drag Grip Handle */}
                <div className="todo-drag-handle" title="Drag to reorder">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="2" />
                    <circle cx="15" cy="6" r="2" />
                    <circle cx="9" cy="12" r="2" />
                    <circle cx="15" cy="12" r="2" />
                    <circle cx="9" cy="18" r="2" />
                    <circle cx="15" cy="18" r="2" />
                  </svg>
                </div>

                {/* Checkbox */}
                <input
                  type="checkbox"
                  className="todo-checkbox"
                  checked={item.completed}
                  onChange={() => toggleTodo(item.id)}
                  title={item.completed ? 'Click to uncheck' : 'Click to check'}
                />

                {/* Title with strikethrough when checked */}
                <span
                  className={`todo-row-title ${item.completed ? 'strikethrough' : ''}`}
                  onClick={() => toggleTodo(item.id)}
                  title="Click to toggle check"
                >
                  {item.title}
                </span>

                {/* Actions: Edit & Delete Icons (No text label) */}
                <div className="todo-row-actions">
                  <button
                    type="button"
                    className="action-icon-btn edit-btn"
                    onClick={() => startEdit(item)}
                    title="Edit"
                    aria-label="Edit to-do"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="action-icon-btn delete-btn"
                    onClick={() => deleteTodo(item.id)}
                    title="Delete"
                    aria-label="Delete to-do"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* RIGHT SIDE: Title Form + Filters (Pending/Completed) + Auto Reset Countdown + Actions (Uncheck All / Delete All) */}
      <aside className="panel todo-form-panel">
        <h2>{editingId ? 'Edit To-Do' : 'Add To-Do'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Title
            <input
              type="text"
              placeholder="e.g. Do workout, Read book..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
            />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Update' : 'Add To-Do'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>

        {/* Option: Pending & Completed Filter */}
        <div className="right-panel-section">
          <span className="right-section-title">Status Filter</span>
          <div className="right-filter-group">
            <button
              type="button"
              className={`right-filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All <span className="chip-count">{todos.length}</span>
            </button>
            <button
              type="button"
              className={`right-filter-chip ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              Pending <span className="chip-count chip-amber">{pendingCount}</span>
            </button>
            <button
              type="button"
              className={`right-filter-chip ${statusFilter === 'completed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('completed')}
            >
              Completed <span className="chip-count chip-green">{completedCount}</span>
            </button>
          </div>
        </div>

        {/* Option: Daily Reset Countdown (11:59 PM) */}
        <div className="right-panel-section countdown-section">
          <span className="right-section-title">Daily Reset Countdown (11:59 PM)</span>
          <div className="countdown-card">
            <div className="countdown-clock-row">
              <span className="clock-icon">⏳</span>
              <span className="countdown-digits">
                {midnightCountdown}
              </span>
            </div>
            <p className="countdown-hint">
              {completedCount > 0
                ? `${completedCount} checked task${completedCount === 1 ? '' : 's'} will automatically reset after 11:59 PM tonight.`
                : 'Checked to-dos automatically reset to unchecked after 11:59 PM every night.'}
            </p>
          </div>
        </div>

        {/* Option: Status-Aware Quick Actions */}
        <div className="right-panel-section">
          <span className="right-section-title">Quick Actions</span>
          <div className="right-actions-list">
            {(statusFilter === 'completed' || statusFilter === 'all') && (
              <button
                type="button"
                className="btn btn-ghost action-full-btn"
                disabled={completedCount === 0}
                onClick={uncheckAll}
                title="Reset or uncheck all completed to-dos"
              >
                🔄 Uncheck All ({completedCount})
              </button>
            )}

            <button
              type="button"
              className="btn btn-danger action-full-btn"
              disabled={
                statusFilter === 'pending'
                  ? pendingCount === 0
                  : statusFilter === 'completed'
                  ? completedCount === 0
                  : todos.length === 0
              }
              onClick={deleteTodosByStatus}
              title={`Delete ${statusFilter === 'pending' ? 'pending' : statusFilter === 'completed' ? 'completed' : 'all'} to-dos`}
            >
              🗑 Delete {statusFilter === 'pending' ? `Pending (${pendingCount})` : statusFilter === 'completed' ? `Completed (${completedCount})` : `All (${todos.length})`}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ==========================================================================
   MY TASK & PLAN (Original Planning Module)
   ========================================================================== */
function MyPlanView() {
  const [plans, setPlans] = useState(loadInitialPlans)
  const [form, setForm] = useState(EMPTY_PLAN_FORM)
  const [editingId, setEditingId] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [selected, setSelected] = useState(() => new Set())
  const [nowTime, setNowTime] = useState(Date.now())

  useEffect(() => {
    save(PLANS_KEY, plans)
  }, [plans])

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    if (editingId) {
      setPlans(ps => ps.map(p => (p.id === editingId ? { ...p, ...form } : p)))
      setEditingId(null)
    } else {
      setPlans(ps => [{ ...form, id: Date.now(), done: false }, ...ps])
      setFilter(f => (f === 'done' ? 'pending' : f))
    }
    setForm(EMPTY_PLAN_FORM)
  }

  function edit(plan) {
    setEditingId(plan.id)
    setForm({
      priority: plan.priority || 'Natural',
      title: plan.title || plan.name || '',
      details: plan.details || '',
      responsiblePerson: plan.responsiblePerson || plan.remarks || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_PLAN_FORM)
  }

  // Thursday 11:59 PM Auto-Cleanup: completed tasks disappear every Thursday after 11:59 PM
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setNowTime(now)
      const passedThursday = getLatestPassedThursday1159(new Date(now)).getTime()
      setPlans(prev => {
        const filtered = prev.filter(p => !(p.done && p.doneAt && p.doneAt <= passedThursday))
        return filtered.length !== prev.length ? filtered : prev
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  function toggleDone(id) {
    setPlans(ps =>
      ps.map(p => {
        if (p.id === id) {
          const willBeDone = !p.done
          return {
            ...p,
            done: willBeDone,
            doneAt: willBeDone ? Date.now() : null,
          }
        }
        return p
      })
    )
    if (editingId === id) cancelEdit()
  }

  function markAllAsCompleted() {
    const now = Date.now()
    setPlans(ps => ps.map(p => (!p.done ? { ...p, done: true, doneAt: now } : p)))
    if (editingId) cancelEdit()
  }

  function undoAllCompleted() {
    if (doneCount === 0) return
    setPlans(ps => ps.map(p => (p.done ? { ...p, done: false, doneAt: null } : p)))
    if (editingId) cancelEdit()
  }

  function deletePending() {
    if (leftCount === 0) return
    if (!confirm(`Delete all ${leftCount} pending tasks? This cannot be undone.`)) return
    setPlans(ps => ps.filter(p => p.done))
    if (editingId) cancelEdit()
  }

  function deleteCompleted() {
    if (doneCount === 0) return
    if (!confirm(`Delete all ${doneCount} completed tasks? This cannot be undone.`)) return
    setPlans(ps => ps.filter(p => !p.done))
    if (editingId) cancelEdit()
  }

  function deleteAll() {
    if (plans.length === 0) return
    if (!confirm(`Delete all ${plans.length} tasks and plans? This cannot be undone.`)) return
    setPlans([])
    if (editingId) cancelEdit()
  }

  function remove(id) {
    if (!confirm('Delete this task / plan?')) return
    setPlans(ps => ps.filter(p => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  function changeFilter(key) {
    setFilter(key)
    setSelected(new Set())
  }

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function completeSelected() {
    const now = Date.now()
    setPlans(ps => ps.map(p => (selected.has(p.id) ? { ...p, done: true, doneAt: now } : p)))
    if (selected.has(editingId)) cancelEdit()
    setSelected(new Set())
  }

  function clearVisible() {
    const ids = new Set(visible.map(p => p.id))
    if (!confirm(`Delete ${ids.size} plan${ids.size === 1 ? '' : 's'}? This cannot be undone.`)) return
    setPlans(ps => ps.filter(p => !ids.has(p.id)))
    if (ids.has(editingId)) cancelEdit()
  }

  const total = plans.length
  const doneCount = plans.filter(p => p.done).length
  const leftCount = total - doneCount

  const q = search.trim().toLowerCase()
  const visible = plans
    .filter(p => (filter === 'all' ? true : filter === 'done' ? p.done : !p.done))
    .filter(p => priorityFilter === 'All' || (p.priority || 'Natural') === priorityFilter)
    .filter(p =>
      !q ||
      [p.title, p.name, p.details, p.responsiblePerson, p.remarks].some(s =>
        s?.toLowerCase().includes(q)
      )
    )
    .sort(
      (a, b) =>
        a.done - b.done ||
        (PRIORITY_ORDER[a.priority || 'Natural'] ?? 3) -
        (PRIORITY_ORDER[b.priority || 'Natural'] ?? 3) ||
        b.id - a.id
    )

  const selectable = filter === 'pending'
  const selectedCount = visible.filter(p => selected.has(p.id)).length
  const allSelected = visible.length > 0 && selectedCount === visible.length

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map(p => p.id)))
  }

  // Live Countdown until Thursday 11:59 PM
  const thursdayCountdown = (() => {
    const now = new Date(nowTime)
    const nextThursday = getNextThursday1159(now)
    const diff = Math.max(0, nextThursday.getTime() - now.getTime())
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24)
    const mins = Math.floor((diff / (1000 * 60)) % 60)
    const secs = Math.floor((diff / 1000) % 60)
    return {
      days,
      hours,
      mins,
      secs,
      text: `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`,
      targetDateFormatted: nextThursday.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    }
  })()

  return (
    <div className="planner-container">
      {/* 2-Column Layout matching To-Do: Left Lists, Right Add Form */}
      <main className="layout">
        {/* LEFT SIDE: All Lists (Tabs, Search, Priority Filter, Cards) */}
        <section className="panel list-panel">
          <div className="list-head">
            <div className="tabs">
              {[
                ['pending', 'Pending', leftCount],
                ['done', 'Completed', doneCount],
                ['all', 'All', total],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  className={`tab tab-${key} ${filter === key ? 'active' : ''}`}
                  onClick={() => changeFilter(key)}
                >
                  {label} <span className="tab-count">{count}</span>
                </button>
              ))}
            </div>
            <div className="list-tools">
              <input
                className="search"
                placeholder="Search tasks & plans..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="list-bar">
            <div className="prio-filter">
              {['All', 'Natural', 'Medium', 'High', 'Critical'].map(p => (
                <button
                  key={p}
                  className={`pf pf-${p.toLowerCase()} ${priorityFilter === p ? 'active' : ''}`}
                  onClick={() => setPriorityFilter(p)}
                >
                  {p !== 'All' && <span className="dot" />}
                  {p}
                </button>
              ))}
            </div>

            <div className="bulk">
              {filter === 'pending' && (
                <>
                  <button
                    type="button"
                    className="action action-complete"
                    onClick={markAllAsCompleted}
                    disabled={leftCount === 0}
                    title="Mark all pending tasks as completed"
                  >
                    ✓ Mark All as Completed {leftCount > 0 ? `(${leftCount})` : ''}
                  </button>
                  <button
                    type="button"
                    className="action action-danger"
                    onClick={deletePending}
                    disabled={leftCount === 0}
                    title="Delete all pending tasks"
                  >
                    🗑 Delete Pending {leftCount > 0 ? `(${leftCount})` : ''}
                  </button>
                </>
              )}

              {filter === 'done' && (
                <>
                  <button
                    type="button"
                    className="action action-undo-btn"
                    onClick={undoAllCompleted}
                    disabled={doneCount === 0}
                    title="Undo all completed tasks back to pending"
                  >
                    ↩ Undo All {doneCount > 0 ? `(${doneCount})` : ''}
                  </button>
                  <button
                    type="button"
                    className="action action-danger"
                    onClick={deleteCompleted}
                    disabled={doneCount === 0}
                    title="Delete all completed tasks"
                  >
                    🗑 Delete Completed {doneCount > 0 ? `(${doneCount})` : ''}
                  </button>
                </>
              )}

              {filter === 'all' && (
                <>
                  {leftCount > 0 && (
                    <button
                      type="button"
                      className="action action-complete"
                      onClick={markAllAsCompleted}
                      title="Mark all pending tasks as completed"
                    >
                      ✓ Mark All as Completed ({leftCount})
                    </button>
                  )}
                  {doneCount > 0 && (
                    <button
                      type="button"
                      className="action action-undo-btn"
                      onClick={undoAllCompleted}
                      title="Undo all completed tasks back to pending"
                    >
                      ↩ Undo All ({doneCount})
                    </button>
                  )}
                  {total === 0 && (
                    <button
                      type="button"
                      className="action action-complete"
                      disabled
                    >
                      ✓ Mark All as Completed
                    </button>
                  )}
                  <button
                    type="button"
                    className="action action-danger"
                    onClick={deleteAll}
                    disabled={total === 0}
                    title="Delete all tasks and plans"
                  >
                    🗑 Delete All {total > 0 ? `(${total})` : ''}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="cards">
            {visible.length === 0 ? (
              <p className="empty">
                {q || priorityFilter !== 'All' ? 'No tasks match your filters.' : 'No tasks yet. Add one from the form on the right 👉'}
              </p>
            ) : (
              visible.map(p => {
                const itemPriority = p.priority || 'Natural'
                const itemTitle = p.title || p.name || 'Untitled Task'
                const itemResponsible = p.responsiblePerson || p.remarks

                return (
                  <article
                    key={p.id}
                    className={`card prio-${itemPriority.toLowerCase()} ${p.done ? 'done' : ''} ${editingId === p.id ? 'editing' : ''}`}
                  >
                    {/* Top Row: Check Box | Title | Highlight Responsive Person */}
                    <div className="card-top-row">
                      <input
                        type="checkbox"
                        className="card-checkbox"
                        checked={p.done}
                        onChange={() => toggleDone(p.id)}
                        title={p.done ? 'Click to unmark' : 'Click to mark complete'}
                      />

                      <h3
                        className={`card-main-title ${p.done ? 'strikethrough' : ''}`}
                        onClick={() => toggleDone(p.id)}
                        title="Click to toggle complete"
                      >
                        {itemTitle}
                      </h3>

                      {itemResponsible?.trim() && (
                        <div className="responsive-person-highlight" title="Responsible Person">
                          <span className="person-avatar-icon">👤</span>
                          <span className="person-name-text">{itemResponsible}</span>
                        </div>
                      )}
                    </div>

                    {/* Middle: Details In Highlight */}
                    {p.details?.trim() && (
                      <div className="details-highlight-box">
                        <p className="details-text">{p.details}</p>
                      </div>
                    )}

                    {/* Bottom Row: Badge Priority | Mark As Complete | Edit & Delete (or Undo if completed) */}
                    <div className="card-bottom-row">
                      <div className="bottom-left-group">
                        <span className={`badge badge-${itemPriority.toLowerCase()}`}>
                          {itemPriority}
                        </span>
                        {p.done ? (
                          <span className="status status-done">✓ Completed</span>
                        ) : (
                          <button
                            type="button"
                            className="action action-complete"
                            onClick={() => toggleDone(p.id)}
                          >
                            Mark as Complete
                          </button>
                        )}
                      </div>

                      <div className="bottom-actions-group">
                        {p.done ? (
                          /* In completed tasks: no edit or delete, replaced with Undo */
                          <button
                            type="button"
                            className="action action-undo-btn"
                            onClick={() => toggleDone(p.id)}
                            title="Undo completed task"
                          >
                            ↩ Undo
                          </button>
                        ) : (
                          /* In pending tasks: Edit Icon & Delete Icon */
                          <>
                            <button
                              type="button"
                              className="action-icon-btn edit-btn"
                              onClick={() => edit(p)}
                              title="Edit"
                              aria-label="Edit task / plan"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>

                            <button
                              type="button"
                              className="action-icon-btn delete-btn"
                              onClick={() => remove(p.id)}
                              title="Delete"
                              aria-label="Delete task / plan"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>

        {/* RIGHT SIDE: Add Task / Plan Form */}
        <aside className="panel form-panel">
          <h2>{editingId ? 'Edit Task / Plan' : 'Add Task / Plan'}</h2>
          <form onSubmit={submit}>
            {/* 1. Priority (Natural, Medium, High, Critical) - Default: Natural */}
            <label>Priority</label>
            <div className="priority-picker">
              {['Natural', 'Medium', 'High', 'Critical'].map(p => (
                <button
                  type="button"
                  key={p}
                  className={`chip chip-${p.toLowerCase()} ${form.priority === p ? 'active' : ''}`}
                  onClick={() => update('priority', p)}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* 2. Task / Plan Title */}
            <label>
              Task / Plan Title <span className="req">*</span>
              <input
                placeholder="e.g. Website redesign or sprint goal"
                value={form.title}
                onChange={e => update('title', e.target.value)}
                required
                autoFocus={!editingId}
              />
            </label>

            {/* 3. Plan Details */}
            <label>
              Plan Details
              <textarea
                rows="3"
                placeholder="What type of work will you do?"
                value={form.details}
                onChange={e => update('details', e.target.value)}
              />
            </label>

            {/* 4. Responsible Person (Optional) */}
            <label>
              Responsible Person (Optional)
              <input
                placeholder="e.g. John, Sarah, or Me"
                value={form.responsiblePerson}
                onChange={e => update('responsiblePerson', e.target.value)}
              />
            </label>

            <div className="row form-action-row-right">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Update Task / Plan' : 'Add Task / Plan'}
              </button>
            </div>
          </form>

          {/* Right Side Bottom: Alert Card for Thursday 11:59 PM Auto-Cleanup */}
          <div className="weekly-alert-card">
            <div className="weekly-alert-header">
              <span className="weekly-alert-icon">⚠️</span>
              <div className="weekly-alert-title-wrap">
                <strong className="weekly-alert-title">Completed Tasks Notice</strong>
                <span className="weekly-alert-badge">Thursday 11:59 PM</span>
              </div>
            </div>

            {/* Auto-Cleanup Live Countdown */}
            <div className="cleanup-countdown-box">
              <div className="cleanup-countdown-header">
                <span className="cleanup-clock-icon">⏳</span>
                <span className="cleanup-countdown-label">Auto Cleanup Countdown</span>
              </div>
              <div className="cleanup-countdown-digits">
                <div className="countdown-time-unit">
                  <span className="unit-number">{thursdayCountdown.days}</span>
                  <span className="unit-label">DAYS</span>
                </div>
                <span className="unit-colon">:</span>
                <div className="countdown-time-unit">
                  <span className="unit-number">{String(thursdayCountdown.hours).padStart(2, '0')}</span>
                  <span className="unit-label">HRS</span>
                </div>
                <span className="unit-colon">:</span>
                <div className="countdown-time-unit">
                  <span className="unit-number">{String(thursdayCountdown.mins).padStart(2, '0')}</span>
                  <span className="unit-label">MIN</span>
                </div>
                <span className="unit-colon">:</span>
                <div className="countdown-time-unit">
                  <span className="unit-number">{String(thursdayCountdown.secs).padStart(2, '0')}</span>
                  <span className="unit-label">SEC</span>
                </div>
              </div>
              <div className="cleanup-countdown-target">
                Next cleanup: <strong>Thursday ({thursdayCountdown.targetDateFormatted}) at 11:59 PM</strong>
              </div>
            </div>

            <p className="weekly-alert-text">
              <strong>Alert:</strong> Every Thursday at 11:59 PM, completed tasks will disappear! Make sure your completed tasks are done; if needed, undo them to complete task before they disappear.
            </p>
            <div className="weekly-alert-footer">
              <span className="weekly-alert-pill">
                🗑 {doneCount} completed task{doneCount === 1 ? '' : 's'} scheduled to disappear
              </span>
              <span className="weekly-alert-undo-hint">💡 Undo anytime to keep task active</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

/* ==========================================================================
   PIN LOCK SCREEN & MODAL
   ========================================================================== */
function LoginScreen({ onUnlock }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [showForgot, setShowForgot] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (await checkPin(code)) {
      onUnlock()
    } else {
      setError('Wrong PIN, try again')
      setShake(true)
      setCode('')
    }
  }

  function resetEverything() {
    if (confirm('Permanently remove PIN protection?')) {
      localStorage.removeItem(PIN_KEY)
      localStorage.removeItem(AUTH_KEY)
      onUnlock()
    }
  }

  return (
    <div className="login-page">
      <form className={`login-card ${shake ? 'shake' : ''}`} onSubmit={submit} onAnimationEnd={() => setShake(false)}>
        <div className="logo">🔒</div>
        <h1>TaskNest Locked</h1>
        <p className="muted">Enter your PIN to continue</p>
        <input
          className="code-input"
          type="password"
          inputMode="numeric"
          placeholder="• • • •"
          value={code}
          onChange={e => setCode(e.target.value)}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block">Unlock</button>
        <button type="button" className="link-btn" onClick={() => setShowForgot(!showForgot)}>
          {showForgot ? 'Close' : 'Forgot PIN?'}
        </button>
        {showForgot && (
          <div className="forgot-box">
            <p className="muted">Resetting PIN lock will remove protection.</p>
            <button type="button" className="btn btn-danger btn-block" onClick={resetEverything}>
              Remove PIN Lock
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

function PinModal({ hasPin, onClose, onSuccess }) {
  const [pin, setPinVal] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (pin.length < MIN_PIN) {
      setError(`PIN must be at least ${MIN_PIN} characters`)
      return
    }
    if (pin !== confirmPin) {
      setError("PINs do not match")
      return
    }
    await setPin(pin)
    save(AUTH_KEY, true)
    onSuccess()
  }

  function handleRemove() {
    localStorage.removeItem(PIN_KEY)
    localStorage.removeItem(AUTH_KEY)
    onSuccess()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-top">
          <h3>{hasPin ? 'Update PIN Security' : 'Enable PIN Protection'}</h3>
          <button type="button" className="close-x" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            {hasPin ? 'New PIN' : 'Set PIN'}
            <input
              type="password"
              inputMode="numeric"
              placeholder="At least 4 digits"
              value={pin}
              onChange={e => setPinVal(e.target.value)}
              required
            />
          </label>
          <label>
            Confirm PIN
            <input
              type="password"
              inputMode="numeric"
              placeholder="Re-enter PIN"
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions-row">
            <button type="submit" className="btn btn-primary">Save PIN</button>
            {hasPin && (
              <button type="button" className="btn btn-danger" onClick={handleRemove}>
                Remove PIN
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
