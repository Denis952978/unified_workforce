export const ROLES = ['employee', 'supervisor', 'project_manager', 'production_manager', 'logistics', 'finance', 'admin', 'vendor'] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABEL: Record<string, string> = { employee: 'team member', supervisor: 'supervisor', project_manager: 'project manager', production_manager: 'production manager', logistics: 'logistics', finance: 'finance', admin: 'administrator', vendor: 'vendor' };

export interface RoleAssignment { role: Role; project_id: string | null }
/** A person as stored in the app's records (core.users). */
export interface Member { id: string; name: string; email: string; status: 'ACTIVE' | 'INVITED' | 'DISABLED' | 'PENDING' | string; roles: RoleAssignment[]; employee_id: string | null; vendor_id?: string | null; invitedBy?: string; cid?: string | null; code?: string | null }
export interface SessionUser { accountId: string; email: string; memberId: string; name: string; roles: RoleAssignment[] }

export const hasRole = (u: { roles: RoleAssignment[] }, r: Role) => u.roles.some(x => x.role === r);
export const isAdmin = (u: { roles: RoleAssignment[] }) => hasRole(u, 'admin');
export const managedProjects = (u: { roles: RoleAssignment[] }) => u.roles.filter(r => r.role === 'project_manager').map(r => r.project_id as string);
export const mainRole = (m: Member): RoleAssignment => m.roles.find(r => r.role !== 'employee') || m.roles[0] || { role: 'employee', project_id: null };
