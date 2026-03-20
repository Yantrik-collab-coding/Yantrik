import { create } from 'zustand'

export interface User {
  id: string
  email: string
  username: string
  avatar_color: string
  uid: string
}

interface AuthStore {
  user: User | null
  token: string | null
  setAuth: (user: User, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>(set => ({
  user:    null,
  token:   localStorage.getItem('hive_token'),
  setAuth: (user, token) => { localStorage.setItem('hive_token', token); set({ user, token }) },
  logout:  () => { localStorage.removeItem('hive_token'); set({ user: null, token: null }) },
}))
