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
const brandStill = document.querySelector<HTMLImageElement>('#start-logo-still')!;
const brandVideo = document.querySelector<HTMLVideoElement>('#start-logo-video')!;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let missionModule: Promise<typeof import('./main')> | undefined;
let brandIntroAttempted = false;

function showBrandStill(): void {
  if (brandStill.naturalWidth > 0) menu.dataset.logoReady = '';
}

brandStill.addEventListener('load', showBrandStill, { once: true });
showBrandStill();

function stopBrandIntro(): void {
  delete menu.dataset.logoPlaying;
  if (!brandVideo.hasAttribute('src')) return;
  brandVideo.pause();
  brandVideo.removeAttribute('src');
  brandVideo.load();
}

function playBrandIntro(): void {
  if (brandIntroAttempted || reducedMotion.matches || document.hidden || menu.hidden || roleDialog.open) return;
  brandIntroAttempted = true;
  brandVideo.muted = true;
  brandVideo.src = `${import.meta.env.BASE_URL}art/start-logo.mp4`;
  void brandVideo.play().catch(stopBrandIntro);
}

brandVideo.addEventListener('playing', () => {
  if (!menu.hidden && !roleDialog.open && !document.hidden && !reducedMotion.matches && brandVideo.hasAttribute('src')) {
    menu.dataset.logoPlaying = '';
  }
});
brandVideo.addEventListener('waiting', () => { delete menu.dataset.logoPlaying; });
brandVideo.addEventListener('ended', stopBrandIntro);
brandVideo.addEventListener('error', stopBrandIntro);
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stopBrandIntro(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopBrandIntro();
  else playBrandIntro();
});

async function showScreen(moveFocus: boolean): Promise<void> {
  const hash = location.hash;
  const explorer = hash === '#explorer' || hash === '#explorador';
  const inMission = explorer || hash === '#planner' || hash === '#mision';
  if (inMission && roleDialog.open) roleDialog.close();
  menu.hidden = inMission;
  workspace.hidden = !inMission;

  if (!inMission) {
    playBrandIntro();
    void missionModule?.then(module => { if (workspace.hidden) module.setExplorerVisibility(false); }, () => undefined);
    if (moveFocus) startAction.focus();
    return;
  }

  stopBrandIntro();
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

startAction.addEventListener('click', () => {
  brandIntroAttempted = true;
  stopBrandIntro();
  roleDialog.showModal();
});
document.querySelector('#role-close')!.addEventListener('click', () => roleDialog.close());
roleDialog.querySelectorAll('a').forEach(link => link.addEventListener('click', () => roleDialog.close()));

window.addEventListener('hashchange', () => void showScreen(true));
void showScreen(false);
