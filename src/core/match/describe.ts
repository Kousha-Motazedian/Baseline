import type { PlayType } from './types.ts'

/** Play-by-play wording for each kind of shot. */
const SHOT_DESCRIPTIONS: Record<PlayType, string> = {
  drive: 'driving layup',
  cut: 'layup off a cut',
  postUp: 'post hook',
  midRange: 'mid-range jumper',
  three: '3-pt jumper',
  putback: 'putback',
}

/** Describes a shot for play-by-play, e.g. "driving layup". */
export function describeShot(playType: PlayType): string {
  return SHOT_DESCRIPTIONS[playType]
}
