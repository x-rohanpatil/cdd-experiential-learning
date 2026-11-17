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
