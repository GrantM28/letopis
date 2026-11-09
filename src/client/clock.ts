// The fork's speed of time: pause, play and fast forward (buttons and the Space key), shared by everyone watching.
import { $ } from './kit';

const SCALES = [0, 1, 2, 5, 20, 100];
let timeScale = 1;
/** the speed before pausing, so Space and Play bring it back */
let lastRunning = 1;
/** the speed we asked for and the server has not confirmed yet (months already on their way still carry the old one) */
let wantedScale: number | null = null;
let wantedAt = 0;
export function clockFromServer(scale: number) {
  if (wantedScale !== null) {
    if (scale !== wantedScale && performance.now() - wantedAt < 15000) return;
    wantedScale = null;
  }
  showClock(scale);
}
function showClock(scale: number) {
  timeScale = scale;
  if (scale > 0) lastRunning = scale;
  $('#clockPause').setAttribute('aria-pressed', String(scale === 0));
  $('#clockPlay').setAttribute('aria-pressed', String(scale === 1));
  $('#clockFast').setAttribute('aria-pressed', String(scale > 1));
  $('#clockLabel').textContent = scale === 0 ? 'Paused' : `${scale}×`;
  document.body.classList.toggle('paused', scale === 0);
}
async function setScale(scale: number) {
  wantedScale = scale;
  wantedAt = performance.now();
  showClock(scale); // at once; the server confirms to everyone watching
  await fetch(`/api/time?scale=${scale}`, { method: 'POST' }).catch(() => null);
}
$('#clockPause').onclick = () => void setScale(0);
$('#clockPlay').onclick = () => void setScale(1);
$('#clockFast').onclick = () => {
  const next = SCALES.find((s) => s > Math.max(1, timeScale));
  void setScale(next ?? 2);
};
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : null;
  if (e.code !== 'Space' || el?.closest('input, textarea, button')) return;
  e.preventDefault();
  void setScale(timeScale === 0 ? lastRunning : 0);
});
