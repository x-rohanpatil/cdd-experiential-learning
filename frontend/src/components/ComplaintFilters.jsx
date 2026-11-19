import { Search } from './Icons.jsx'

const statuses = ['Reported', 'Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed']

function ComplaintFilters({ search, onSearchChange, status, onStatusChange }) {
  return (
    <div className="complaint-filters">
      <label className="filter-search">
        <span className="visually-hidden">Search complaints</span>
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search title, location or ID"
        />
      </label>
      <label className="filter-status">
        <span className="visually-hidden">Filter by status</span>
        <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
  )
}

export default ComplaintFilters
