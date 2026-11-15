import './ui/tokens.css';
import './ui/ui.css';
import './ui/mission.css';
import './ui/start.css';
import './ui/flight.css';

const menu = document.querySelector<HTMLElement>('#start-menu')!;
const workspace = document.querySelector<HTMLElement>('#app')!;
const missionTitle = document.querySelector<HTMLElement>('#mission-title')!;
const startAction = document.querySelector<HTMLButtonElement>('#start-action')!;
const roleDialog = document.querySelector<HTMLDialogElement>('#role-dialog')!;
const startError = document.querySelector<HTMLElement>('#start-error')!;
let missionModule: Promise<typeof import('./main')> | undefined;

async function showScreen(moveFocus: boolean): Promise<void> {
  const hash = location.hash;
  const explorer = hash === '#explorer' || hash === '#explorador';
  const inMission = explorer || hash === '#planner' || hash === '#mision';
  if (inMission && roleDialog.open) roleDialog.close();
  menu.hidden = inMission;
  workspace.hidden = !inMission;

  if (!inMission) {
    void missionModule?.then(module => { if (workspace.hidden) module.setExplorerVisibility(false); }, () => undefined);
    if (moveFocus) startAction.focus();
    return;
  }

  startError.hidden = true;
  if (moveFocus) missionTitle.focus();
  try {
    missionModule ??= import('./main');
    const module = await missionModule;
    if (location.hash === hash) {
      module.setMode(explorer ? 'explorer' : 'planner');
      module.setExplorerVisibility(explorer);
    }
  } catch (error) {
    console.error('The lunar scene could not open.', error);
    missionModule = undefined;
    if (location.hash !== hash) return;

    history.replaceState(null, '', '#home');
    workspace.hidden = true;
    menu.hidden = false;
    startError.textContent = 'The lunar scene could not open. Reload the page to try again.';
    startError.hidden = false;
    startAction.focus();
  }
}

startAction.addEventListener('click', () => roleDialog.showModal());
document.querySelector('#role-close')!.addEventListener('click', () => roleDialog.close());
roleDialog.querySelectorAll('a').forEach(link => link.addEventListener('click', () => roleDialog.close()));

window.addEventListener('hashchange', () => void showScreen(true));
void showScreen(false);
