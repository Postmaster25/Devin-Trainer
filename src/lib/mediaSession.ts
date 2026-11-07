/** Best-effort lock-screen controls. iOS shows them while the keep-alive <audio> element plays. */
export function setMediaMetadata(title: string, artist: string) {
  if (!('mediaSession' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'Ride Training Plan',
      artwork: [
        { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
      ],
    });
  } catch {
    /* unsupported */
  }
}

export function setMediaHandlers(handlers: { play?: () => void; pause?: () => void; stop?: () => void }) {
  if (!('mediaSession' in navigator)) return;
  const set = (action: MediaSessionAction, fn?: () => void) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn ? () => fn() : null);
    } catch {
      /* action unsupported */
    }
  };
  set('play', handlers.play);
  set('pause', handlers.pause);
  set('stop', handlers.stop);
}

export function setMediaPlaybackState(state: MediaSessionPlaybackState) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
}

export function clearMediaSession() {
  setMediaHandlers({});
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }
}
