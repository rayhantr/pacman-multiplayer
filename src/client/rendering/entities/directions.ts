/** Base facing angle (radians) for a movement direction; 0 = right. */
export function directionAngle(direction: string): number {
  switch (direction) {
    case 'up':
      return -Math.PI / 2;
    case 'down':
      return Math.PI / 2;
    case 'left':
      return Math.PI;
    default:
      return 0; // right
  }
}
