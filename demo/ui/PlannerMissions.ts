import { BackendError } from '../../src/backend';
import { PlannerApi, type Invitation, type Mission, type MissionInput, type PlannerUser } from '../plannerApi';
import { el } from './dom';
import { createMissionRoute, type MissionRouteSite } from './MissionRoute';

type Draft = Pick<MissionInput, 'site_ids' | 'start_utc' | 'end_utc' | 'observer_height_m'>;
const field = (label: string, input: HTMLElement) => el('label', { class: 'compare__field' }, label, input);
const utc = (value: string) => `${value.slice(0, 16).replace('T', ' ')} UTC`;

export class PlannerMissions {
  private readonly dialog = el('dialog', { class: 'flight-panel flight-dialog planner-dialog', 'aria-labelledby': 'planner-missions-title' });
  private readonly title = el('h2', { id: 'planner-missions-title' }, 'Missions');
  private readonly content = el('div', { class: 'planner-dialog__body' });
  private readonly status = el('p', { class: 'compare__message', role: 'status' });
  private user?: PlannerUser;
  private missions: Mission[] = [];
  private invitations: Invitation[] = [];
  private missionsUnavailable = false;
  private invitationNotice = '';
  private disposeRoute?: () => void;
  private busy = false;

  constructor(private readonly api: PlannerApi, mount: HTMLElement, private readonly callbacks: {
    sites(): MissionRouteSite[];
    draft(): Draft;
    sessionChanged(): void;
    activeMission(): Mission | undefined;
    openMission(mission: Mission): void;
    leaveMission(): void;
  }) {
    this.dialog.append(el('header', { class: 'flight-dialog__head' }, this.title, this.button('Close', () => this.close())), this.status, this.content);
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.clearRoute(); });
    mount.append(this.dialog);
  }

  open() {
    if (this.dialog.open) return;
    this.dialog.showModal();
    if (this.busy) return;
    this.status.textContent = '';
    if (!this.api.token) {
      if (this.user) this.endSession();
      this.showAuth();
      return;
    }
    this.content.replaceChildren();
    void this.run('Loading missions…', async () => {
      this.user ??= await this.api.me();
      this.callbacks.sessionChanged();
      await this.loadList();
    }, 'Could not load missions. Close and reopen this window to retry.');
  }

  close() { if (this.dialog.open) this.dialog.close(); this.clearRoute(); }

  private clearRoute() {
    this.disposeRoute?.();
    this.disposeRoute = undefined;
    this.dialog.classList.remove('planner-dialog--route');
  }

  private button(label: string, onClick?: () => void, primary = false) {
    const button = el('button', { class: `flight-button${primary ? ' flight-button--primary' : ''}`, type: onClick ? 'button' : 'submit' }, label);
    if (onClick) button.addEventListener('click', () => { if (!this.busy || label === 'Close') onClick(); });
    return button;
  }

  private endSession() {
    this.api.clearSession();
    this.user = undefined; this.missions = []; this.invitations = [];
    this.missionsUnavailable = false; this.invitationNotice = '';
    this.callbacks.sessionChanged();
  }

  private async run(progress: string, action: () => Promise<void>, fallback: string): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.status.textContent = progress;
    try {
      await action();
      if (this.status.textContent === progress) this.status.textContent = '';
    } catch (error) {
      const code = error instanceof BackendError ? error.status : 0;
      if (code === 401 && (this.user || this.api.token)) {
        this.endSession(); this.showAuth();
        this.status.textContent = 'Your session expired. Sign in again.';
      } else {
        this.status.textContent = code === 429 ? 'Too many attempts. Wait and try again.'
          : code === 503 ? 'The account service is temporarily unavailable.' : fallback;
      }
    } finally { this.busy = false; }
  }

  private showAuth(registering = false, emailValue = '') {
    this.title.textContent = registering ? 'Create a planner account' : 'Sign in to Mission Planner';
    const name = el('input', { autocomplete: 'name', required: true, maxlength: 120 });
    const email = el('input', { type: 'email', autocomplete: 'email', required: true, maxlength: 254, value: emailValue });
    const password = el('input', { type: 'password', autocomplete: registering ? 'new-password' : 'current-password', required: true, minlength: registering ? 15 : 1, maxlength: 128 });
    const form = el('form', { class: 'planner-form' }, registering ? field('Name', name) : null, field('Email', email),
      field(registering ? 'Password (at least 15 characters)' : 'Password', password),
      el('div', { class: 'planner-dialog__actions' }, this.button(registering ? 'Create account' : 'Sign in', undefined, true),
        this.button(registering ? 'Back to sign in' : 'Create account', () => {
          this.status.textContent = ''; this.showAuth(!registering, email.value);
        })));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.busy) return;
      const entered = password.value;
      password.value = '';
      void this.run(registering ? 'Creating account…' : 'Signing in…', async () => {
        if (registering) {
          await this.api.register({ name: name.value.trim(), email: email.value.trim(), password: entered });
          this.showAuth(false, email.value);
          this.status.textContent = 'Account created. Sign in with your new password.';
          return;
        }
        this.user = await this.api.login(email.value.trim(), entered);
        this.callbacks.sessionChanged();
        await this.loadList();
      }, registering ? 'Could not create your account. Check your details or sign in if you already registered.'
        : 'Could not sign in or load your missions. Check your credentials and connection.');
    });
    this.content.replaceChildren(el('p', { class: 'flight-dialog__intro' }, 'Save plans, share sites and respond to invitations.'), form);
  }

  private async loadList() {
    const [missions, invitations] = await Promise.allSettled([this.api.missions(), this.api.invitations()]);
    for (const result of [missions, invitations]) {
      if (result.status === 'rejected' && result.reason instanceof BackendError && result.reason.status === 401) throw result.reason;
    }
    this.missionsUnavailable = missions.status === 'rejected';
    if (missions.status === 'fulfilled') this.missions = missions.value;
    this.invitationNotice = '';
    if (invitations.status === 'fulfilled') this.invitations = invitations.value;
    else {
      this.invitations = [];
      this.invitationNotice = invitations.reason instanceof BackendError && invitations.reason.status === 404
        ? 'Invitations are unavailable on this server.' : 'Could not load invitations. Select Refresh to try again.';
    }
    this.showList();
  }

  private showList() {
    this.clearRoute();
    this.title.textContent = 'Missions';
    const active = this.callbacks.activeMission();
    const list = el('ul', { class: 'planner-list' }, ...this.missions.map(mission => el('li', {},
      el('div', {}, el('strong', {}, mission.name), el('small', {}, mission.owner_id === this.user?.id ? 'Owner' : 'Shared with you')),
      this.button('View mission', () => this.loadMission(mission.id)))));
    const inbox = el('ul', { class: 'planner-list' }, ...this.invitations.map(invitation => el('li', {},
      el('div', {}, el('strong', {}, invitation.mission_name), el('small', {}, `Invited by ${invitation.invited_by_name}`)),
      el('div', { class: 'planner-dialog__actions' }, this.button('Accept', () => this.respond(invitation.id, true), true), this.button('Decline', () => this.respond(invitation.id, false))))));
    this.content.replaceChildren(
      el('div', { class: 'planner-account' }, el('div', {}, el('strong', {}, this.user?.name ?? ''), el('small', {}, this.user?.email ?? '')),
        this.button('Sign out', () => {
          void this.run('Signing out…', async () => {
            try { await this.api.logout(); }
            finally { this.endSession(); this.showAuth(); }
          }, 'Signed out on this device. The server could not confirm session revocation.');
        })),
      ...(active ? [el('div', { class: 'planner-account' }, el('span', {}, `Active mission: ${active.name}`), this.button('Leave mission', () => { this.callbacks.leaveMission(); this.showList(); }))] : []),
      el('div', { class: 'planner-dialog__actions' }, this.button('New mission', () => this.showEditor(), true),
        this.button('Refresh', () => void this.run('Refreshing…', () => this.loadList(), 'Could not refresh missions. Try again.'))),
      el('h3', {}, 'Your missions'),
      ...(this.missionsUnavailable ? [el('p', { class: 'flight-dialog__intro', role: 'status' }, 'Could not load missions. Select Refresh to try again.')] : []),
      ...(list.childElementCount ? [list] : !this.missionsUnavailable ? [el('p', { class: 'flight-dialog__intro' }, 'Create a mission or accept an invitation.')] : []),
      el('h3', {}, 'Invitations'), inbox.childElementCount ? inbox
        : el('p', { class: 'flight-dialog__intro' }, this.invitationNotice || 'No pending invitations.'),
    );
  }

  private respond(id: string, accept: boolean) {
    void this.run(accept ? 'Accepting invitation…' : 'Declining invitation…', async () => {
      await this.api.respond(id, accept);
      await this.loadList();
      this.status.textContent = accept ? 'Mission added to your list.' : 'Invitation declined.';
    }, 'Could not respond. Refresh the list to check whether the invitation is still pending.');
  }

  private loadMission(id: string) {
    void this.run('Loading mission…', async () => {
      const mission = await this.api.mission(id);
      if (mission.owner_id === this.user?.id) {
        try {
          const [members, sent] = await Promise.all([this.api.members(id), this.api.sentInvitations(id)]);
          this.showMission(mission, members, sent);
        } catch (error) {
          if (error instanceof BackendError && error.status === 401) throw error;
          this.showMission(mission);
          this.content.append(el('p', { class: 'flight-dialog__intro' }, 'Collaborator controls are currently unavailable.'));
        }
      } else this.showMission(mission);
    }, 'Could not open this mission. Refresh the list to check your access.');
  }

  private showMission(mission: Mission, members?: PlannerUser[], sent: Invitation[] = []) {
    this.title.textContent = mission.name;
    this.content.replaceChildren(
      el('p', { class: 'flight-dialog__intro' }, `${utc(mission.start_utc)} to ${utc(mission.end_utc)}`),
      el('p', {}, `Sites: ${mission.site_ids.map(id => mission.sites?.find(site => site.site_id === id)?.name ?? id).join(', ')}`),
      el('p', {}, `${mission.observer_height_m ?? 2} m observer height · ${mission.step_hours ?? 1} h sample step`),
      el('p', { class: 'flight-dialog__intro' }, 'The mission shares its sites, dates and sampling settings. Lander moves apply to your current view.'),
      el('div', { class: 'planner-dialog__actions' }, this.button('Load in planner', () => { this.callbacks.openMission(mission); this.close(); }, true),
        this.button('Edit mission', () => this.showEditor(mission)), this.button('Back to missions', () => this.showList())),
    );
    if (mission.description) this.content.append(el('p', { class: 'planner-description' }, mission.description));
    if (!members) return;
    const email = el('input', { type: 'email', autocomplete: 'off', required: true, maxlength: 254 });
    const form = el('form', { class: 'planner-form' }, field('Collaborator email', email), el('div', {}, this.button('Invite collaborator', undefined, true)));
    form.addEventListener('submit', event => {
      event.preventDefault();
      void this.run('Adding invitation…', async () => {
        await this.api.invite(mission.id, email.value.trim());
        this.showMission(mission, members, await this.api.sentInvitations(mission.id));
        this.status.textContent = 'Invitation added to their Missions inbox.';
      }, 'Could not invite that address. The collaborator needs a registered planner account.');
    });
    this.content.append(el('h3', {}, 'Collaborators'), form,
      el('ul', { class: 'planner-list' }, ...members.map(member => el('li', {},
        el('div', {}, el('strong', {}, member.name), el('small', {}, member.email)), this.button('Remove', () => {
          if (!window.confirm(`Remove ${member.name} from this mission?`)) return;
          void this.run('Removing collaborator…', async () => {
            await this.api.removeMember(mission.id, member.id);
            this.showMission(mission, await this.api.members(mission.id), sent);
          }, 'Could not remove this collaborator.');
        }))), ...sent.map(invitation => el('li', {}, el('span', {}, invitation.email), el('small', {}, 'Invitation pending')))));
  }

  private showEditor(mission?: Mission) {
    this.title.textContent = mission ? 'Edit mission' : 'New mission';
    const draft = mission ?? this.callbacks.draft();
    const name = el('input', { required: true, maxlength: 120, value: mission?.name ?? '' });
    const description = el('textarea', { maxlength: 2000, rows: 2 }, mission?.description ?? '');
    const start = el('input', { type: 'datetime-local', step: 3600, required: true, value: draft.start_utc.slice(0, 16) });
    const end = el('input', { type: 'datetime-local', step: 3600, required: true, value: draft.end_utc.slice(0, 16) });
    const height = el('select', {}, new Option('2 m', '2'), new Option('5 m', '5'));
    height.value = String(draft.observer_height_m ?? 2);
    const step = el('input', { type: 'number', min: 1, max: 24, step: 1, required: true, value: mission?.step_hours ?? 1 });
    const choices = this.callbacks.sites();
    for (const id of draft.site_ids) if (!choices.some(site => site.id === id)) choices.push({ id, label: mission?.sites?.find(site => site.site_id === id)?.name ?? id });
    const checkboxes = choices.map(site => el('input', { type: 'checkbox', value: site.id, checked: draft.site_ids.includes(site.id) }));
    const startSite = el('select', { required: true }, ...choices.map(site => new Option(site.label, site.id)));
    const destination = el('select', {}, new Option('No destination', ''), ...choices.map(site => new Option(site.label, site.id)));
    startSite.value = draft.site_ids[0] ?? choices[0]?.id ?? '';
    const updateDestinations = () => {
      for (const option of Array.from(destination.options)) option.disabled = !!option.value && option.value === startSite.value;
      if (destination.value === startSite.value) destination.value = '';
      for (const box of checkboxes) {
        box.disabled = box.value === startSite.value || box.value === destination.value;
        if (box.disabled) box.checked = false;
      }
    };
    startSite.addEventListener('change', updateDestinations);
    destination.addEventListener('change', updateDestinations);
    if (!mission) updateDestinations();
    const siteList = el('fieldset', { class: 'planner-sites' }, el('legend', {}, mission ? 'Sites' : 'Additional sites'),
      ...choices.map((site, index) => el('label', {}, checkboxes[index], site.label)));
    if (!mission) for (const box of checkboxes) box.checked = false;
    const siteFields = mission ? siteList
      : el('div', { class: 'compare__choices' }, field('Start site', startSite), field('Destination site', destination));
    const form = el('form', { class: 'planner-form' }, field('Mission name', name), field('Description (optional)', description), siteFields,
      mission ? null : el('details', { class: 'planner-extra-sites' }, el('summary', {}, 'Add more sites'), siteList),
      el('div', { class: 'compare__choices' }, field('Start (UTC)', start), field('End (UTC)', end), field('Observer height', height), field('Sample step (hours)', step)),
      el('div', { class: 'planner-dialog__actions' }, this.button('Save mission', undefined, true), this.button('Cancel', () => this.showList())));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.busy) return;
      const selected = checkboxes.filter(box => box.checked).map(box => box.value);
      const siteIds = mission
        ? [...mission.site_ids.filter(id => selected.includes(id)), ...selected.filter(id => !mission.site_ids.includes(id))]
        : [startSite.value, ...selected.filter(id => id !== startSite.value && id !== destination.value), destination.value].filter(Boolean);
      const startUtc = `${start.value}:00Z`, endUtc = `${end.value}:00Z`;
      const hours = (Date.parse(endUtc) - Date.parse(startUtc)) / 3600000;
      if (!name.value.trim() || siteIds.length < 1 || siteIds.length > 20 || !(hours > 0 && hours <= 62 * 24)) {
        this.status.textContent = 'Enter a name, choose 1–20 sites and set a UTC window of up to 62 days.';
        return;
      }
      void this.run('Saving mission…', async () => {
        const saved = await this.api.saveMission({ name: name.value.trim(), description: description.value.trim(), site_ids: siteIds,
          start_utc: startUtc, end_utc: endUtc, step_hours: Number(step.value), observer_height_m: Number(height.value) }, mission?.id);
        this.missions = [saved, ...this.missions.filter(item => item.id !== saved.id)];
        if (!mission && this.dialog.open) this.showCreatedMission(saved, choices);
        else {
          this.showList();
          this.status.textContent = `Saved ${saved.name}.`;
        }
      }, 'Could not save the mission. Check the dates, sites and your current access.');
    });
    this.content.replaceChildren(form);
  }

  private showCreatedMission(mission: Mission, choices: MissionRouteSite[]) {
    this.title.textContent = mission.name;
    this.dialog.classList.add('planner-dialog--route');
    const sites = mission.site_ids.map(id => {
      const saved = mission.sites?.find(site => site.site_id === id);
      const chosen = choices.find(site => site.id === id);
      return { id, label: saved?.name ?? chosen?.label ?? id, coordinates: saved?.coordinates ?? chosen?.coordinates };
    });
    const route = createMissionRoute(sites[0], sites.length > 1 ? sites.at(-1) : undefined);
    this.content.replaceChildren(route.root,
      el('div', { class: 'planner-dialog__actions' },
        this.button('Load in planner', () => { this.callbacks.openMission(mission); this.close(); }, true),
        this.button('Back to missions', () => this.showList())));
    this.disposeRoute = route.mount();
  }
}
