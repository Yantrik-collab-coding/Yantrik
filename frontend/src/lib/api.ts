import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('hive_token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      // Token is expired or invalid — clear auth and redirect to login
      localStorage.removeItem('hive_token')
      window.location.href = '/auth'
    }
    // 403 = Forbidden (valid token, no permission) — do NOT log out,
    // let the calling component handle it and show an error.
    return Promise.reject(err)
  }
)

export default api
