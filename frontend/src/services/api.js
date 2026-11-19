import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
})

api.interceptors.request.use((config) => {
  const auth = sessionStorage.getItem('campusfix.auth')
  if (auth) {
    const { access_token: accessToken } = JSON.parse(auth)
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
  }
  return config
})

export const getApiErrorMessage = (error, fallbackMessage) => {
  if (!axios.isAxiosError(error)) {
    return fallbackMessage
  }

  const detail = error.response?.data?.detail
  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item?.msg)
      .filter((message) => typeof message === 'string')
    if (messages.length > 0) {
      return messages.join(' ')
    }
  }

  return error.message || fallbackMessage
}

export const registerStudent = (student) =>
  api.post('/students/register', student)

export const loginStudent = (credentials) =>
  api.post('/students/login', credentials)

export const loginStaffOrAdmin = (credentials) =>
  api.post('/auth/login', credentials)

export const analyzeComplaint = (title, description, photo) => {
  const form = new FormData()
  form.append('title', title)
  form.append('description', description)
  if (photo) form.append('photo', photo)
  return api.post('/complaints/analyze', form)
}

export const createComplaint = (studentId, complaint) =>
  api.post('/complaints', complaint, { params: { student_id: studentId } })

export const createComplaintWithPhoto = (studentId, complaint, photo) => {
  const form = new FormData()
  Object.entries(complaint).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, value)
  })
  form.append('photo', photo)
  return api.post('/complaints/with-photo', form, {
    params: { student_id: studentId },
  })
}

export const getStudentComplaints = (studentId) =>
  api.get(`/students/${studentId}/complaints`)

export const updateComplaint = (complaintId, changes) =>
  api.patch(`/complaints/${complaintId}`, changes)

export const updateComplaintPhoto = (complaintId, photo, removePhoto = false) => {
  const form = new FormData()
  if (photo) form.append('photo', photo)
  if (removePhoto) form.append('remove_photo', 'true')
  return api.patch(`/complaints/${complaintId}/photo`, form)
}

export const deleteComplaint = (complaintId) =>
  api.delete(`/complaints/${complaintId}`)

export const getAdminComplaints = () => api.get('/admin/complaints')

export const getComplaintActivity = (complaintId) =>
  api.get(`/complaints/${complaintId}/activity`)

export const getComplaintFeedback = (complaintId) =>
  api.get(`/complaints/${complaintId}/feedback`)

export const submitComplaintFeedback = (complaintId, feedback) =>
  api.post(`/complaints/${complaintId}/feedback`, feedback)

export const updateAdminComplaintStatus = (complaintId, status) =>
  api.patch(`/admin/complaints/${complaintId}/status`, null, {
    params: { status },
  })

export const createStaff = (staff) =>
  api.post('/admin/staff', null, { params: staff })

export const getStaff = () => api.get('/admin/staff')

export const createStaffAccount = (staff) =>
  api.post('/admin/staff/accounts', staff)

export const assignComplaint = (complaintId, staffId) =>
  api.patch(`/admin/complaints/${complaintId}/assign`, null, {
    params: { staff_id: staffId },
  })

export const getStaffTasks = (staffId) =>
  api.get(`/staff/${staffId}/complaints`)

export const updateStaffTaskStatus = (staffId, complaintId, status) =>
  api.patch(`/staff/${staffId}/complaints/${complaintId}/status`, null, {
    params: { status },
  })

export const resolveStaffTask = (staffId, complaintId, photo, note) => {
  const form = new FormData()
  form.append('after_photo', photo)
  form.append('note', note)
  return api.patch(
    `/staff/${staffId}/complaints/${complaintId}/status`,
    form,
    { params: { status: 'Resolved' } },
  )
}

export const getNotifications = () => api.get('/notifications')

export const markNotificationRead = (notificationId) =>
  api.patch(`/notifications/${notificationId}/read`)

export const verifyComplaint = (studentId, complaintId, action) =>
  api.post(`/students/${studentId}/complaints/${complaintId}/verification`, {
    action,
  })

export const getLocations = () => api.get('/locations')

export const getAdminLocations = () => api.get('/admin/locations')

export const getAdminCampusBuildings = () =>
  api.get('/admin/campus-buildings')

export const updateLocationMapping = (locationId, mapping) =>
  api.patch(`/admin/locations/${locationId}/mapping`, mapping)

export const createLocation = (location) =>
  api.post('/admin/locations', location)

export const updateLocation = (locationId, location) =>
  api.patch(`/admin/locations/${locationId}`, location)

export const getComplaintPhoto = (filename) =>
  api.get(`/media/${encodeURIComponent(filename)}`, { responseType: 'blob' })

export default api
