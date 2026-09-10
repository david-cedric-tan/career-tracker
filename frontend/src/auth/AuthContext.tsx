import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as authApi from '../api/auth'
import { clearToken, getToken, onUnauthorized } from '../api/client'
import type { User } from '../api/types'
import { AuthContext } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const current = await authApi.me()
        if (!cancelled) setUser(current)
      } catch {
        clearToken()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // A token revoked server-side (logout elsewhere, expired session) shows up
  // as a 401 on any call — drop straight back to the login screen.
  useEffect(() => onUnauthorized(() => setUser(null)), [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await authApi.login({ username, password })
    setUser(data.user)
  }, [])

  const register = useCallback(async (payload: authApi.RegisterPayload) => {
    const data = await authApi.register(payload)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setUser }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
