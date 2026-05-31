/**
 * Owns all audio: background music + SFX, the persisted mute preference, and the
 * mute-button UI. DOM-driven — the <audio> elements and #muteButton live in
 * index.html.
 */
export class AudioController {
  // Mute state for all audio (background music + SFX); persisted in localStorage.
  private muted = false;

  constructor() {
    // Restore the saved mute preference and sync the button + audio elements.
    this.muted = localStorage.getItem('pacman-muted') === 'true';
    this.applyMuteState();
  }

  /** All audio elements (background music + SFX), as a single source of truth. */
  private getAudioElements(): HTMLAudioElement[] {
    return ['backgroundMusic', 'pelletSound', 'powerUpSound', 'gameOverSound']
      .map(id => document.getElementById(id) as HTMLAudioElement | null)
      .filter((el): el is HTMLAudioElement => el !== null);
  }

  /** Push the current mute state onto every audio element and the button UI. */
  private applyMuteState(): void {
    this.getAudioElements().forEach(el => (el.muted = this.muted));
    const btn = document.getElementById('muteButton');
    if (btn) {
      btn.textContent = this.muted ? '🔇' : '🔊';
      btn.setAttribute('aria-pressed', String(this.muted));
      btn.setAttribute('aria-label', this.muted ? 'Unmute sound' : 'Mute sound');
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    localStorage.setItem('pacman-muted', String(this.muted));
    this.applyMuteState();
  }

  playBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement | null;
    if (bgMusic) {
      bgMusic.volume = 0.3;
      bgMusic.muted = this.muted;
      bgMusic.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  stopBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement | null;
    bgMusic?.pause();
  }

  playPowerUpSound(): void {
    const powerUpSound = document.getElementById('powerUpSound') as HTMLAudioElement | null;
    if (powerUpSound) {
      powerUpSound.volume = 0.7;
      powerUpSound.muted = this.muted;
      powerUpSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  playPelletSound(): void {
    const pelletSound = document.getElementById('pelletSound') as HTMLAudioElement | null;
    if (pelletSound) {
      pelletSound.volume = 0.5;
      pelletSound.muted = this.muted;
      pelletSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }
}
