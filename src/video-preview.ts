import type { Job } from './types.ts';

export function inspectVideo(job: Job, onChange: () => void, shouldInspect: () => boolean): void {
  const url = URL.createObjectURL(job.file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  let finished = false;
  const timeout = window.setTimeout(cleanup, 15_000);

  function cleanup(): void {
    if (finished) return;
    finished = true;
    window.clearTimeout(timeout);
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }

  function captureFrame(): void {
    if (finished) return;
    if (shouldInspect() && video.videoWidth && video.videoHeight) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = Math.max(1, Math.round((480 * video.videoHeight) / video.videoWidth));
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          job.thumbnail = canvas.toDataURL('image/jpeg', 0.75);
          onChange();
        }
      } catch {
        // The browser may be unable to decode a frame from this video.
      }
    }
    cleanup();
  }

  video.addEventListener(
    'loadedmetadata',
    () => {
      if (finished) return;
      if (Number.isFinite(video.duration)) job.duration = video.duration;
      if (shouldInspect()) onChange();
      const frameTime =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, video.duration / 10)
          : 0;
      if (frameTime > 0) {
        video.addEventListener('seeked', captureFrame, { once: true });
        try {
          video.currentTime = frameTime;
        } catch {
          captureFrame();
        }
      } else {
        video.addEventListener('loadeddata', captureFrame, { once: true });
      }
    },
    { once: true },
  );
  video.addEventListener('error', cleanup, { once: true });
  video.src = url;
}
