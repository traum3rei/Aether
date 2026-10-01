import { useEffect, useRef, useState } from 'react';

interface Track {
  name: string;
  url: string;
}

const tracks: Track[] = Object.entries(
  import.meta.glob<string>('./assets/music/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
)
  .map(([path, url]) => ({
    name: path.split('/').pop()?.replace(/\.mp3$/i, '').replace(/[_-]+/g, ' ') ?? 'Untitled track',
    url,
  }))
  .sort((first, second) => first.name.localeCompare(second.name));

function formatTime(time: number) {
  if (!Number.isFinite(time)) return '0:00';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const track = tracks[trackIndex];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying || !track) return;
    void audio.play().catch((error: unknown) => {
      setIsPlaying(false);
      setPlaybackError(error instanceof Error ? error.message : String(error));
    });
  }, [track, isPlaying]);

  const playTrack = async () => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    setPlaybackError(null);
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      setIsPlaying(false);
      setPlaybackError(error instanceof Error ? error.message : String(error));
    }
  };

  const moveTrack = (direction: number) => {
    if (tracks.length < 2) return;
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError(null);
    setTrackIndex((current) => (current + direction + tracks.length) % tracks.length);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    void playTrack();
  };

  return (
    <section className="music-player" aria-label="Music player">
      <audio
        ref={audioRef}
        src={track?.url}
        preload="metadata"
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (tracks.length > 1) moveTrack(1);
          else {
            setIsPlaying(false);
            setCurrentTime(0);
          }
        }}
        onError={() => {
          setIsPlaying(false);
          setPlaybackError('This MP3 could not be loaded.');
        }}
      />
      <div className={`player-disc ${isPlaying ? 'spinning' : ''}`} aria-hidden="true">
        <span />
      </div>
      <div className="player-content">
        <div className="player-topline">
          <span className="player-label">AETHER FM</span>
          <span className="player-frequency">88.8 ◉</span>
        </div>
        <div className="player-track" title={track?.name ?? 'No MP3 tracks found'}>
          {track?.name ?? 'NO SIGNAL / ADD MP3'}
        </div>
        <div className="player-controls">
          <span className="player-timestamp">{formatTime(currentTime)}</span>
          <input
            aria-label="Seek through track"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            disabled={!track || !duration}
            onChange={(event) => {
              const time = Number(event.currentTarget.value);
              if (audioRef.current) audioRef.current.currentTime = time;
              setCurrentTime(time);
            }}
          />
          <span className="player-timestamp">{formatTime(duration)}</span>
          <button
            type="button"
            className="player-button"
            aria-label="Previous track"
            disabled={tracks.length < 2}
            onClick={() => moveTrack(-1)}
          >
            &lt;&lt;
          </button>
          <button
            type="button"
            className="player-button player-play"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            disabled={!track}
            onClick={togglePlayback}
          >
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>
          <button
            type="button"
            className="player-button"
            aria-label="Next track"
            disabled={tracks.length < 2}
            onClick={() => moveTrack(1)}
          >
            &gt;&gt;
          </button>
        </div>
        {playbackError
          ? <p className="player-message" role="alert">{playbackError}</p>
          : !track && <p className="player-message">Place .mp3 files in src/assets/music to build your playlist.</p>}
      </div>
    </section>
  );
}
