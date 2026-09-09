import { create } from 'zustand'
import type { ExperienceSummary } from '../api/client'

interface ExperienceStore {
  experiences: ExperienceSummary[]
  loading: boolean
  error: string | null
  setExperiences: (exps: ExperienceSummary[]) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
}

export const useExperienceStore = create<ExperienceStore>((set) => ({
  experiences: [],
  loading: false,
  error: null,
  setExperiences: (experiences) => set({ experiences }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error })
}))
