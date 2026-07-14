export function mapScrollPosition(
  position: number,
  sourceAnchors: readonly number[],
  targetAnchors: readonly number[]
): number {
  const count = Math.min(sourceAnchors.length, targetAnchors.length);
  if (count === 0) return position;

  const firstSource = sourceAnchors[0]!;
  const firstTarget = targetAnchors[0]!;
  if (position <= firstSource) {
    return firstTarget + (position - firstSource);
  }

  for (let index = 0; index < count - 1; index++) {
    const sourceStart = sourceAnchors[index]!;
    const sourceEnd = sourceAnchors[index + 1]!;
    if (position > sourceEnd || sourceEnd <= sourceStart) continue;

    const targetStart = targetAnchors[index]!;
    const targetEnd = targetAnchors[index + 1]!;
    const ratio = (position - sourceStart) / (sourceEnd - sourceStart);
    return targetStart + (targetEnd - targetStart) * ratio;
  }

  const lastSource = sourceAnchors[count - 1]!;
  const lastTarget = targetAnchors[count - 1]!;
  return lastTarget + (position - lastSource);
}

export function clampScrollPosition(
  position: number,
  scrollHeight: number,
  viewportHeight: number
): number {
  const max = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(max, Math.max(0, position));
}
