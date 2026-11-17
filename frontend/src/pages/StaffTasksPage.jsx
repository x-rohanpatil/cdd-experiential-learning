import { useCallback, useEffect, useState } from 'react'
import WorkspaceLayout from '../components/WorkspaceLayout.jsx'
import { ComplaintCard } from '../components/ComplaintCard.jsx'
import ComplaintFilters from '../components/ComplaintFilters.jsx'
import { ClipboardCheck } from 'lucide-react'
import { filterComplaints } from '../utils/complaints.js'
import {
  getApiErrorMessage,
  getStaffTasks,
  resolveStaffTask,
  updateStaffTaskStatus,
} from '../services/api.js'

function StaffTasksPage() {
  const auth = JSON.parse(sessionStorage.getItem('campusfix.auth') ?? '{}')
  const [tasks, setTasks] = useState([])
  const [photos, setPhotos] = useState({})
  const [notes, setNotes] = useState({})
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [busyTask, setBusyTask] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { data } = await getStaffTasks(auth.id)
    setTasks(data.tasks)
  }, [auth.id])

  useEffect(() => {
    Promise.resolve()
      .then(refresh)
      .catch((requestError) => setError(getApiErrorMessage(requestError, 'Unable to load tasks.')))
      .finally(() => setIsLoading(false))
  }, [refresh])

  async function updateStatus(task, status) {
    setError('')
    setBusyTask(task.id)
    try {
      await updateStaffTaskStatus(auth.id, task.id, status)
      await refresh()
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to update task.'))
    } finally {
      setBusyTask(null)
    }
  }

  async function resolve(task) {
    const photo = photos[task.id]
    const note = notes[task.id]?.trim()
    if (!photo || !note) {
      setError('Add an after photo and resolution note before marking the task resolved.')
      return
    }
    setBusyTask(task.id)
    try {
      await resolveStaffTask(auth.id, task.id, photo, note)
      await refresh()
      setError('')
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to resolve task.'))
    } finally {
      setBusyTask(null)
    }
  }

  const filtered = filterComplaints(tasks, search, status)

  return (
    <WorkspaceLayout title="My maintenance tasks">
      <div className="staff-welcome glass-card">
        <div>
          <p className="eyebrow eyebrow--blue">TEAM WORKSPACE</p>
          <h2>Make every fix count.</h2>
          <p>Review assigned requests, share progress, and close the loop with students.</p>
        </div>
        <div className="staff-welcome__metric">
          <span><ClipboardCheck size={18} aria-hidden="true" /></span>
          <strong>{isLoading || error ? '—' : tasks.filter((task) => !['Closed', 'Resolved'].includes(task.status)).length}</strong>
          <small>Open tasks</small>
        </div>
      </div>
      {error && <p className="form-message form-message--error" role="alert">{error}</p>}
      <div className="section-heading staff-tasks-heading">
        <div><p className="eyebrow">YOUR ASSIGNMENTS</p><h2>Maintenance queue</h2></div>
      </div>
      <ComplaintFilters search={search} onSearchChange={setSearch} status={status} onStatusChange={setStatus} />
      {isLoading && <p className="workspace-empty">Loading assigned tasks…</p>}
      {tasks.length > 0 && filtered.length === 0 && <p className="workspace-empty">No tasks match those filters.</p>}
      <div className="complaint-list">
        {filtered.map((task) => (
          <ComplaintCard key={task.id} complaint={task}>
            {task.status !== 'Closed' && task.status !== 'Resolved' && (
              <div className="task-actions">
                <button className="button button--secondary" disabled={busyTask === task.id} type="button" onClick={() => updateStatus(task, 'In Progress')}>Start / continue work</button>
                <label className="form-field">
                  <span>After photo</span>
                  <input accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => {
                    setPhotos((current) => ({ ...current, [task.id]: event.target.files?.[0] }))
                  }} />
                </label>
                <label className="form-field">
                  <span>Resolution note</span>
                  <textarea maxLength="2000" value={notes[task.id] ?? ''} onChange={(event) => {
                    setNotes((current) => ({ ...current, [task.id]: event.target.value }))
                  }} />
                </label>
                <button className="button button--primary" disabled={busyTask === task.id} type="button" onClick={() => resolve(task)}>{busyTask === task.id ? 'Updating…' : 'Mark resolved'}</button>
              </div>
            )}
          </ComplaintCard>
        ))}
      </div>
      {!isLoading && tasks.length === 0 && !error && <div className="empty-state glass-card"><span className="empty-state__icon"><ClipboardCheck size={22} aria-hidden="true" /></span><h2>Your queue is clear</h2><p>New assigned maintenance tasks will appear here.</p></div>}
    </WorkspaceLayout>
  )
}

export default StaffTasksPage
