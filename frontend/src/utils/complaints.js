export const COMPLAINT_STATUS_OPTIONS = [
  'Reported',
  'Assigned',
  'In Progress',
  'Resolved',
  'Closed',
]

export const ACTIVE_COMPLAINT_STATUSES = new Set([
  'Reported',
  'Submitted',
  'Assigned',
  'In Progress',
])

export const COMPLETED_COMPLAINT_STATUSES = new Set(['Resolved', 'Closed'])
export const ASSIGNABLE_COMPLAINT_STATUSES = new Set(['Reported', 'Submitted', 'Assigned'])
export const STUDENT_EDITABLE_COMPLAINT_STATUSES = new Set(['Reported', 'Submitted'])

export function filterComplaints(complaints, search, status) {
  const query = search.trim().toLowerCase()
  return complaints.filter((complaint) => {
    const matchesStatus = status === 'all' || complaint.status === status
    const matchesSearch = !query || [
      complaint.id,
      complaint.title,
      complaint.location,
      complaint.category,
    ].some((value) => String(value ?? '').toLowerCase().includes(query))
    return matchesStatus && matchesSearch
  })
}
