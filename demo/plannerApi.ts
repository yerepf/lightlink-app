import { BackendError, type SiteCoordinates } from '../src/backend';

export type PlannerUser = { id: string; name: string; email: string };
export type MissionInput = {
  name: string;
  description?: string;
  site_ids: string[];
  start_utc: string;
  end_utc: string;
  step_hours?: number;
  observer_height_m?: number;
};
export type Mission = MissionInput & { id: string; owner_id: string; sites?: { site_id: string; name: string; coordinates?: SiteCoordinates }[] };
export type Invitation = { id: string; mission_name: string; invited_by_name: string; email: string; expires_at_utc: string };
type Session = { token: string; expires: number };
const sessionKey = 'lightlink.planner.session';

export class PlannerApi {
  private session?: Session;

  constructor(private readonly base: string) {
    try {
      const value = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
      if (typeof value?.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.token) && Number.isFinite(value.expires)) this.session = value;
    } catch { /* Sessions still work in memory when storage is unavailable. */ }
  }

  get token(): string | undefined {
    return this.session && this.session.expires > Date.now() ? this.session.token : undefined;
  }

  clearSession(): void {
    this.session = undefined;
    try { sessionStorage.removeItem(sessionKey); } catch { /* In-memory session is already gone. */ }
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, authenticated = true): Promise<T> {
    const token = authenticated ? this.token : undefined;
    if (authenticated && !token) throw new BackendError(401, 'Sign in to continue.');
    const response = await fetch(this.base.replace(/\/$/, '') + path, {
      method,
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new BackendError(response.status, `Mission API HTTP ${response.status}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  register(input: { name: string; email: string; password: string }) {
    return this.request<PlannerUser>('/auth/register', 'POST', input, false);
  }

  async login(email: string, password: string): Promise<PlannerUser> {
    const result = await this.request<{ user: PlannerUser; access_token: string; token_type: string; expires_in: number }>(
      '/auth/login', 'POST', { email, password }, false,
    );
    if (result.token_type !== 'Bearer' || !/^[A-Za-z0-9_-]{43}$/.test(result.access_token) || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || !result.user?.id) {
      throw new Error('The account service returned an invalid session.');
    }
    this.session = { token: result.access_token, expires: Date.now() + result.expires_in * 1000 };
    try { sessionStorage.setItem(sessionKey, JSON.stringify(this.session)); } catch { /* In-memory session is sufficient. */ }
    return result.user;
  }

  async logout() {
    try { if (this.token) await this.request<void>('/auth/logout', 'POST'); }
    finally { this.clearSession(); }
  }

  me() { return this.request<PlannerUser>('/auth/me'); }
  missions() { return this.request<Mission[]>('/missions'); }
  mission(id: string) { return this.request<Mission>(this.missionPath(id)); }
  saveMission(input: MissionInput, id?: string) {
    return this.request<Mission>(id ? this.missionPath(id) : '/missions', id ? 'PUT' : 'POST', input);
  }

  invitations() { return this.request<Invitation[]>('/invitations'); }
  respond(id: string, accept: boolean) {
    return this.request<{ mission_id: string } | undefined>(`/invitations/${encodeURIComponent(id)}/${accept ? 'accept' : 'reject'}`, 'POST');
  }

  members(id: string) { return this.request<PlannerUser[]>(`${this.missionPath(id)}/members`); }
  sentInvitations(id: string) { return this.request<Invitation[]>(`${this.missionPath(id)}/invitations`); }
  invite(id: string, email: string) {
    return this.request<Invitation>(`${this.missionPath(id)}/invitations`, 'POST', { email });
  }

  removeMember(id: string, member: string) {
    return this.request<void>(`${this.missionPath(id)}/members/${encodeURIComponent(member)}`, 'DELETE');
  }

  private missionPath(id: string) { return `/missions/${encodeURIComponent(id)}`; }
}
