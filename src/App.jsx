import { useEffect, useState } from 'react'
import { UNIQUE_CODE } from './config.js'

const PLANS_KEY = 'myplan-plans'
const AUTH_KEY = 'myplan-unlocked'
const THEME_KEY = 'myplan-theme'
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

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => load(AUTH_KEY, false))
  const [theme, setTheme] = useState(() => load(THEME_KEY, null))

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
    setPlans(ps => ps.map(p => (p.id === id ? { ...p, done: !p.done, doneAt: p.done ? null : Date.now() } : p)))
  }

  function remove(id) {
    if (!confirm('Delete this plan?')) return
    setPlans(ps => ps.filter(p => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  function clearCompleted() {
    if (!confirm('Remove all completed plans?')) return
    setPlans(ps => ps.filter(p => !p.done))
  }

  const total = plans.length
  const doneCount = plans.filter(p => p.done).length
  const pendingCount = total - doneCount
  const highCount = plans.filter(p => !p.done && p.priority === 'High').length
  const percent = total ? Math.round((doneCount / total) * 100) : 0

  const q = search.trim().toLowerCase()
  const visible = plans
    .filter(p => (filter === 'all' ? true : filter === 'done' ? p.done : !p.done))
    .filter(p => !q || [p.name, p.details, p.remarks].some(s => s?.toLowerCase().includes(q)))
    .sort((a, b) => a.done - b.done || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.id - a.id)

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-inner">
          <div className="topbar">
            <span className="brand">📋 Today My Plan</span>
            <div className="topbar-actions">
              <button className="icon-btn" onClick={onToggleTheme} title="Toggle theme">◐</button>
              <button className="icon-btn" onClick={onLock} title="Lock">🔒</button>
            </div>
          </div>
          <h1>{greeting()} 👋</h1>
          <p className="hero-date">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>

          <div className="stats">
            <Stat label="Total" value={total} />
            <Stat label="Pending" value={pendingCount} />
            <Stat label="High priority" value={highCount} />
            <Stat label="Completed" value={doneCount} />
          </div>

          <div className="progress">
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
          <p className="progress-text">{percent}% of today's plan done</p>
        </div>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <h2>{editingId ? '✏️ Edit Plan' : '➕ New Plan'}</h2>
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
              Details
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

        <section className="list-panel">
          <div className="toolbar">
            <div className="tabs">
              {[
                ['pending', `Pending (${pendingCount})`],
                ['done', `Completed (${doneCount})`],
                ['all', `All (${total})`],
              ].map(([key, label]) => (
                <button key={key} className={`tab ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="search"
              placeholder="🔍 Search plans..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">{filter === 'done' ? '🎯' : '✨'}</div>
              <p>
                {q
                  ? 'No plans match your search.'
                  : filter === 'done'
                    ? 'Nothing completed yet. You got this!'
                    : 'No plans here. Add one to get started.'}
              </p>
            </div>
          ) : (
            <div className="plans">
              {visible.map(p => (
                <PlanItem
                  key={p.id}
                  plan={p}
                  editing={editingId === p.id}
                  onEdit={edit}
                  onToggle={toggleDone}
                  onDelete={remove}
                />
              ))}
            </div>
          )}

          {filter !== 'pending' && doneCount > 0 && (
            <button className="btn btn-ghost clear-btn" onClick={clearCompleted}>Clear completed</button>
          )}
        </section>
      </main>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function PlanItem({ plan, editing, onEdit, onToggle, onDelete }) {
  return (
    <article className={`plan prio-${plan.priority.toLowerCase()} ${plan.done ? 'done' : ''} ${editing ? 'editing' : ''}`}>
      <button
        className={`check ${plan.done ? 'checked' : ''}`}
        onClick={() => onToggle(plan.id)}
        title={plan.done ? 'Mark as pending' : 'Mark as complete'}
      >
        {plan.done && '✓'}
      </button>
      <div className="plan-body">
        <div className="plan-head">
          <h3>{plan.name}</h3>
          <span className={`badge badge-${plan.priority.toLowerCase()}`}>{plan.priority}</span>
        </div>
        {plan.details && <p className="plan-details">{plan.details}</p>}
        {plan.remarks && <p className="plan-remarks">💬 {plan.remarks}</p>}
        <div className="plan-foot">
          <span className="plan-time">
            {plan.done && plan.doneAt ? `Completed ${timeAgo(plan.doneAt)}` : `Added ${timeAgo(plan.id)}`}
          </span>
          <div className="plan-actions">
            {!plan.done && <button className="action" onClick={() => onEdit(plan)}>Edit</button>}
            <button className="action action-danger" onClick={() => onDelete(plan.id)}>Delete</button>
          </div>
        </div>
      </div>
    </article>
  )
}
