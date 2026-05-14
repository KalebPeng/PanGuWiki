import { create } from 'zustand'

export interface Org {
  id: string
  name: string
  slug: string
}

export interface Dept {
  id: string
  orgId: string
  name: string
  slug: string
  wikiProjectPath: string
}

interface OrgState {
  orgs: Org[]
  depts: Dept[]
  activeDeptId: string | null
  activeDept: Dept | null
  setOrgs: (orgs: Org[]) => void
  setDepts: (depts: Dept[]) => void
  setActiveDeptId: (id: string) => void
  clearOrg: () => void
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  orgs: [],
  depts: [],
  activeDeptId: null,
  activeDept: null,
  setOrgs: (orgs) => set({ orgs }),
  setDepts: (depts) => set({ depts }),
  setActiveDeptId: (id) => {
    const dept = get().depts.find((d) => d.id === id) ?? null
    set({ activeDeptId: id, activeDept: dept })
  },
  clearOrg: () => set({ orgs: [], depts: [], activeDeptId: null, activeDept: null }),
}))
