import { describe, it, expect, vi } from 'vitest';
import { GameManager } from './gameManager.js';

// Mock Socket.IO server
const mockIo = {
  to: vi.fn(() => ({
    emit: vi.fn(),
  })),
  emit: vi.fn(),
} as any;

describe('GameManager', () => {
  it('should initialize correctly', () => {
    const gameManager = new GameManager(mockIo);
    expect(gameManager).toBeDefined();
  });

  it('should be a valid class instance', () => {
    const gameManager = new GameManager(mockIo);
    expect(gameManager).toBeInstanceOf(GameManager);
  });
});
