import './ui/tokens.css';
import './ui/ui.css';
import './ui/mission.css';
import './ui/start.css';

const menu = document.querySelector<HTMLElement>('#start-menu')!;
const workspace = document.querySelector<HTMLElement>('#app')!;
const missionTitle = document.querySelector<HTMLElement>('#mission-title')!;
const startAction = document.querySelector<HTMLAnchorElement>('#start-action')!;
const startError = document.querySelector<HTMLElement>('#start-error')!;
let missionModule: Promise<typeof import('./main')> | undefined;

async function showScreen(moveFocus: boolean): Promise<void> {
  const inMission = location.hash === '#mision';
  menu.hidden = inMission;
  workspace.hidden = !inMission;

  if (!inMission) {
    if (moveFocus) startAction.focus();
    return;
  }

  startError.hidden = true;
  if (moveFocus) missionTitle.focus();
  try {
    missionModule ??= import('./main');
    await missionModule;
  } catch (error) {
    console.error('No se pudo abrir la escena lunar.', error);
    missionModule = undefined;
    if (location.hash !== '#mision') return;

    history.replaceState(null, '', '#inicio');
    workspace.hidden = true;
    menu.hidden = false;
    startError.textContent = 'No se pudo abrir la escena. Recarga la página para intentarlo de nuevo.';
    startError.hidden = false;
    startAction.focus();
  }
}

window.addEventListener('hashchange', () => void showScreen(true));
void showScreen(false);
