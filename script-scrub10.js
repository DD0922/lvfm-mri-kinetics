const video = document.querySelector('#result-video');
const playButton = document.querySelector('#play-button');
const progress = document.querySelector('#video-progress');
const elapsedTime = document.querySelector('#elapsed-time');
const totalTime = document.querySelector('#total-time');
const caseButtons = [...document.querySelectorAll('.case-button')];
const cover = document.querySelector('#video-cover');
const preloadedPosters = caseButtons.map(button => {
  const image = new Image();
  image.src = button.dataset.poster;
  return image;
});
let scrubbing = false;
let resumeAfterScrub = false;
let activeCase = caseButtons[0];
let activeRequest = 0;
let pendingFetch;
const videoUrls = new Map();
let queuedSeekTime = null;
let seekFrameScheduled = false;
let playAfterScrub = false;
let coverPending = false;

function revealWhenFrameReady() {
  if (cover.hidden || coverPending) return;
  coverPending = true;
  const request = activeRequest;
  const reveal = () => {
    if (request !== activeRequest) return;
    cover.hidden = true;
    coverPending = false;
  };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(reveal);
  else {
    video.addEventListener('seeked', reveal, { once: true });
    video.addEventListener('timeupdate', reveal, { once: true });
  }
}

function loadCase(button) {
  const request = ++activeRequest;
  pendingFetch?.abort();
  pendingFetch = undefined;
  scrubbing = false;
  queuedSeekTime = null;
  playAfterScrub = false;
  coverPending = false;
  cover.hidden = false;
  cover.src = button.dataset.poster;
  activeCase = button;
  video.pause();
  video.poster = button.dataset.poster;
  video.removeAttribute('title');
  video.removeAttribute('src');
  video.load();
  renderProgress(0);
  updatePlayButton();
  playButton.disabled = true;
  progress.setAttribute('aria-disabled', 'true');
  video.setAttribute('aria-label', `Case ${button.dataset.case} abdominal MRI result visualization`);

  const source = button.dataset.src;
  if (videoUrls.has(source)) {
    video.src = videoUrls.get(source);
    video.load();
    return;
  }

  const controller = new AbortController();
  pendingFetch = controller;
  fetch(source, { credentials: 'same-origin', signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error(`Video request failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => {
      if (request !== activeRequest) return;
      const url = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
      videoUrls.set(source, url);
      video.src = url;
      video.load();
    })
    .catch(error => {
      if (request !== activeRequest || error.name === 'AbortError') return;
      video.title = 'Video could not load. Select this case again to retry.';
    })
    .finally(() => {
      if (request === activeRequest) pendingFetch = undefined;
    });
}
window.addEventListener('pagehide', () => {
  pendingFetch?.abort();
  for (const url of videoUrls.values()) URL.revokeObjectURL(url);
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function renderProgress(time) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const ratio = duration ? Math.max(0, Math.min(1, time / duration)) : 0;
  progress.style.setProperty('--progress', `${ratio * 100}%`);
  progress.setAttribute('aria-valuenow', String(Math.round(ratio * 1000)));
  elapsedTime.textContent = formatTime(time);
  totalTime.textContent = formatTime(duration);
  progress.setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(duration)}`);
}

function updateProgress() {
  if (!scrubbing && queuedSeekTime === null) renderProgress(video.currentTime);
}

function resumeAfterFinalSeek() {
  if (!scrubbing && playAfterScrub) {
    playAfterScrub = false;
    video.play();
  }
}

function applyQueuedSeek() {
  seekFrameScheduled = false;
  if (video.seeking || queuedSeekTime === null) return;
  const time = queuedSeekTime;
  queuedSeekTime = null;
  if (Math.abs(video.currentTime - time) < 0.01) {
    resumeAfterFinalSeek();
    return;
  }
  video.currentTime = time;
}

function scheduleQueuedSeek() {
  if (seekFrameScheduled) return;
  seekFrameScheduled = true;
  requestAnimationFrame(applyQueuedSeek);
}

function seekToRatio(ratio, duringScrub = false) {
  if (!Number.isFinite(video.duration) || !video.duration) return;
  revealWhenFrameReady();
  const time = Math.max(0, Math.min(1, ratio)) * video.duration;
  renderProgress(time);
  const safeTime = Math.min(time, Math.max(0, video.duration - 0.001));
  if (duringScrub) {
    queuedSeekTime = safeTime;
    scheduleQueuedSeek();
  } else {
    video.currentTime = safeTime;
  }
}

function ratioFromPointer(event) {
  const rect = progress.getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width;
}

function updatePlayButton() {
  const paused = video.paused;
  playButton.textContent = paused ? '▶' : '❚❚';
  playButton.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
}

playButton.addEventListener('click', () => {
  if (video.paused) {
    revealWhenFrameReady();
    video.play();
  }
  else video.pause();
});
video.addEventListener('click', () => {
  if (playButton.disabled) return;
  if (video.paused) {
    revealWhenFrameReady();
    video.play();
  }
  else video.pause();
});
video.addEventListener('play', revealWhenFrameReady);
video.addEventListener('play', updatePlayButton);
video.addEventListener('pause', updatePlayButton);
video.addEventListener('loadedmetadata', () => {
  playButton.disabled = false;
  progress.removeAttribute('aria-disabled');
  updateProgress();
});
video.addEventListener('durationchange', updateProgress);
video.addEventListener('timeupdate', updateProgress);
video.addEventListener('seeked', () => {
  if (queuedSeekTime !== null) scheduleQueuedSeek();
  else {
    updateProgress();
    resumeAfterFinalSeek();
  }
});
video.addEventListener('ended', updatePlayButton);
progress.addEventListener('pointerdown', event => {
  if (!Number.isFinite(video.duration) || !video.duration) return;
  scrubbing = true;
  resumeAfterScrub = !video.paused;
  playAfterScrub = false;
  video.pause();
  progress.setPointerCapture(event.pointerId);
  seekToRatio(ratioFromPointer(event), true);
  event.preventDefault();
});
progress.addEventListener('pointermove', event => {
  if (scrubbing) seekToRatio(ratioFromPointer(event), true);
});
function finishScrub(event) {
  if (!scrubbing) return;
  scrubbing = false;
  playAfterScrub = resumeAfterScrub;
  seekToRatio(ratioFromPointer(event), true);
  if (progress.hasPointerCapture(event.pointerId)) progress.releasePointerCapture(event.pointerId);
}
progress.addEventListener('pointerup', finishScrub);
progress.addEventListener('pointercancel', finishScrub);
progress.addEventListener('keydown', event => {
  const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (step) seekToRatio((video.currentTime + step) / video.duration);
  else if (event.key === 'Home') seekToRatio(0);
  else if (event.key === 'End') seekToRatio(1);
  else return;
  event.preventDefault();
});
caseButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    if (button === activeCase && video.currentSrc) return;
    caseButtons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    loadCase(button);
  });
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = caseButtons[(index + direction + caseButtons.length) % caseButtons.length];
    next.focus();
    next.click();
  });
});

loadCase(activeCase);
