import { useEffect, useState } from 'react'
import { UNIQUE_CODE } from './config.js'

const PLANS_KEY = 'myplan-plans'
const AUTH_KEY = 'myplan-unlocked'
const EMPTY_FORM = { name: '', details: '', priority: 'Medium', remarks: '' }

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
  const [unlocked, setUnlocked] = useState(() => load(AUTH_KEY, false))

  if (!unlocked) {
    return <Login onUnlock={() => { save(AUTH_KEY, true); setUnlocked(true) }} />
  }

  return <Planner onLock={() => { save(AUTH_KEY, false); setUnlocked(false) }} />
}

function Login({ onUnlock }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function submit(e) {
    e.preventDefault()
    if (code === UNIQUE_CODE) onUnlock()
    else setError('Wrong code')
  }

  return (
    <div className="container">
      <h1>Today My Plan</h1>
      <form className="card" onSubmit={submit}>
        <label>
          Unique Code
          <input type="password" value={code} onChange={e => setCode(e.target.value)} autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Enter</button>
      </form>
    </div>
  )
}

function Planner({ onLock }) {
  const [plans, setPlans] = useState(() => load(PLANS_KEY, []))
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)

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
  }

  function remove(id) {
    if (!confirm('Delete this plan?')) return
    setPlans(ps => ps.filter(p => p.id !== id))
    if (editingId === id) cancelEdit()
  }

  const pending = plans.filter(p => !p.done)
  const completed = plans.filter(p => p.done)

  return (
    <div className="container">
      <header>
        <h1>Today My Plan</h1>
        <button className="link" onClick={onLock}>Lock</button>
      </header>
      <p className="date">{new Date().toDateString()}</p>

      <form className="card" onSubmit={submit}>
        <label>
          Project / Person Name
          <input value={form.name} onChange={e => update('name', e.target.value)} required />
        </label>
        <label>
          Details
          <textarea rows="2" value={form.details} onChange={e => update('details', e.target.value)} />
        </label>
        <label>
          Priority
          <select value={form.priority} onChange={e => update('priority', e.target.value)}>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </label>
        <label>
          Remarks
          <input value={form.remarks} onChange={e => update('remarks', e.target.value)} />
        </label>
        <div className="row">
          <button type="submit">{editingId ? 'Update Plan' : 'Add Plan'}</button>
          {editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}
        </div>
      </form>

      <h2>My Plans ({pending.length})</h2>
      {pending.length === 0 && <p className="muted">No pending plans.</p>}
      {pending.map(p => (
        <PlanItem key={p.id} plan={p} onEdit={edit} onToggle={toggleDone} onDelete={remove} />
      ))}

      {completed.length > 0 && (
        <>
          <h2>Completed ({completed.length})</h2>
          {completed.map(p => (
            <PlanItem key={p.id} plan={p} onEdit={edit} onToggle={toggleDone} onDelete={remove} />
          ))}
        </>
      )}
    </div>
  )
}

function PlanItem({ plan, onEdit, onToggle, onDelete }) {
  return (
    <div className={`card plan ${plan.done ? 'done' : ''}`}>
      <div className="plan-head">
        <strong>{plan.name}</strong>
        <span className={`badge ${plan.priority.toLowerCase()}`}>{plan.priority}</span>
      </div>
      {plan.details && <p>{plan.details}</p>}
      {plan.remarks && <p className="muted">Remarks: {plan.remarks}</p>}
      <div className="row">
        <button onClick={() => onToggle(plan.id)}>{plan.done ? 'Undo' : 'Mark as Complete'}</button>
        {!plan.done && <button className="secondary" onClick={() => onEdit(plan)}>Edit</button>}
        <button className="danger" onClick={() => onDelete(plan.id)}>Delete</button>
      </div>
    </div>
  )
}
