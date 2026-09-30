import { useEffect, useState } from 'react'
import { UNIQUE_CODE, AUTO_LOCK_MINUTES } from './config.js'

const PLANS_KEY = 'myplan-plans'
const AUTH_KEY = 'myplan-unlocked'
const THEME_KEY = 'myplan-theme'
const ACTIVITY_KEY = 'myplan-last-activity'
const IDLE_MS = AUTO_LOCK_MINUTES * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']
const EMPTY_FORM = { name: '', details: '', priority: 'Medium', remarks: '' }
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 }

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
    // storage unavailable; ignore
  }
}

export default function App() {
  // Stay locked if the last activity (even from a closed tab) was too long ago
  const [unlocked, setUnlocked] = useState(
    () => load(AUTH_KEY, false) && Date.now() - load(ACTIVITY_KEY, 0) < IDLE_MS
  )
  const [theme, setTheme] = useState(() => load(THEME_KEY, null))

  useEffect(() => {
    if (!unlocked) return
    let last = Date.now()
    let lastSaved = last
    save(ACTIVITY_KEY, last)

    function onActivity() {
      last = Date.now()
      // Only write to storage every few seconds, not on every mouse move
      if (last - lastSaved > 5000) {
        save(ACTIVITY_KEY, last)
        lastSaved = last
      }
    }

    // Compare timestamps instead of a single timer so sleep/background tabs still lock
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
  }, [unlocked])

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    save(THEME_KEY, theme)
  }, [theme])

  function toggleTheme() {
    const isDark = theme
      ? theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches
    setTheme(isDark ? 'light' : 'dark')
  }

  if (!unlocked) {
    return <Login onUnlock={() => { save(AUTH_KEY, true); setUnlocked(true) }} />
  }

  return (
    <Planner
      onLock={() => { save(AUTH_KEY, false); setUnlocked(false) }}
      onToggleTheme={toggleTheme}
    />
  )
}

function Login({ onUnlock }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)

  function submit(e) {
    e.preventDefault()
    if (code === UNIQUE_CODE) onUnlock()
    else {
      setError(true)
      setCode('')
    }
  }

  return (
    <div className="login-page">
      <form className={`login-card ${error ? 'shake' : ''}`} onSubmit={submit} onAnimationEnd={() => setError(false)}>
        <div className="logo">📋</div>
        <h1>Today My Plan</h1>
        <p className="muted">Enter your unique code to continue</p>
        <input
          className="code-input"
          type="password"
          placeholder="• • • •"
          value={code}
          onChange={e => setCode(e.target.value)}
          autoFocus
        />
        {error && <p className="error">Wrong code, try again</p>}
        <button type="submit" className="btn btn-primary btn-block">Unlock</button>
      </form>
    </div>
  )
}

function Planner({ onLock, onToggleTheme }) {
  const [plans, setPlans] = useState(() => load(PLANS_KEY, []))
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [filter, setFilter] = useState('pending')
  const [search, setSearch] = useState('')

  useEffect(() => save(PLANS_KEY, plans), [plans])

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editingId) {
      setPlans(ps => ps.map(p => (p.id === editingId ? { ...p, ...form } : p)))
      setEditingId(null)
    } else {
      setPlans(ps => [{ ...form, id: Date.now(), done: false }, ...ps])
      setFilter(f => (f === 'done' ? 'pending' : f))
    }
    setForm(EMPTY_FORM)
  }

  function edit(plan) {
    setEditingId(plan.id)
    setForm({ name: plan.name, details: plan.details, priority: plan.priority, remarks: plan.remarks })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function toggleDone(id) {
    setPlans(ps => ps.map(p => (p.id === id ? { ...p, done: !p.done } : p)))
    if (editingId === id) cancelEdit()
  }

  function remove(id) {
    if (!confirm('Delete this plan?')) return
    setPlans(ps => ps.filter(p => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  const total = plans.length
  const doneCount = plans.filter(p => p.done).length
  const leftCount = total - doneCount

  const q = search.trim().toLowerCase()
  const visible = plans
    .filter(p => (filter === 'all' ? true : filter === 'done' ? p.done : !p.done))
    .filter(p => !q || [p.name, p.details, p.remarks].some(s => s?.toLowerCase().includes(q)))
    .sort((a, b) => a.done - b.done || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.id - a.id)

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">📋 Today My Plan</span>
        <div className="topbar-actions">
          <span className="date">
            {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">◐</button>
          <button className="icon-btn" onClick={onLock} title="Lock">🔒</button>
        </div>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <h2>{editingId ? 'Edit Plan' : 'Add Plan'}</h2>
          <form onSubmit={submit}>
            <label>
              Project / Person Name
              <input
                placeholder="e.g. Website redesign or John"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                required
              />
            </label>
            <label>
              Plan Details
              <textarea
                rows="3"
                placeholder="What type of work will you do?"
                value={form.details}
                onChange={e => update('details', e.target.value)}
              />
            </label>
            <label>Priority</label>
            <div className="priority-picker">
              {['High', 'Medium', 'Low'].map(p => (
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
            <label>
              Remarks
              <input
                placeholder="Any notes"
                value={form.remarks}
                onChange={e => update('remarks', e.target.value)}
              />
            </label>
            <div className="row">
              <button type="submit" className="btn btn-primary">{editingId ? 'Update Plan' : 'Add Plan'}</button>
              {editingId && <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </section>

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
                  onClick={() => setFilter(key)}
                >
                  {label} <span className="tab-count">{count}</span>
                </button>
              ))}
            </div>
            <div className="list-tools">
              <input
                className="search"
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="cards">
            {visible.length === 0 ? (
              <p className="empty">
                {q ? 'No plans match your search.' : 'No plans yet. Add one from the form.'}
              </p>
            ) : (
              visible.map(p => (
                <article
                  key={p.id}
                  className={`card prio-${p.priority.toLowerCase()} ${p.done ? 'done' : ''} ${editingId === p.id ? 'editing' : ''}`}
                >
                  <div className="card-head">
                    <div>
                      <span className="field-label">Project / Person By :</span>
                      <h3>{p.name}</h3>
                    </div>
                    <div className="tags">
                      <span className={`badge badge-${p.priority.toLowerCase()}`}>{p.priority}</span>
                      <span className={`status ${p.done ? 'status-done' : 'status-left'}`}>
                        {p.done ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {p.details?.trim() && (
                    <div className="field boxed">
                      <span className="field-label">Plan Details</span>
                      <p className="field-text">{p.details}</p>
                    </div>
                  )}

                  {p.remarks?.trim() && (
                    <div className="field boxed">
                      <span className="field-label">Remarks</span>
                      <p className="field-text">{p.remarks}</p>
                    </div>
                  )}

                  <div className="card-foot">
                    <button className={`action ${p.done ? 'action-done' : 'action-complete'}`} onClick={() => toggleDone(p.id)}>
                      {p.done ? 'Undo' : '✓ Mark as Complete'}
                    </button>
                    {!p.done && <button className="action" onClick={() => edit(p)}>Edit</button>}
                    <button className="action action-danger" onClick={() => remove(p.id)}>Delete</button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
