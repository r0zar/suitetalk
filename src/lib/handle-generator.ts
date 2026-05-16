const ADJECTIVES = [
  'swift', 'bold', 'wry', 'brave', 'calm', 'eager', 'fierce', 'gentle',
  'happy', 'jolly', 'kind', 'lively', 'merry', 'nimble', 'plucky', 'quick',
  'silent', 'tidy', 'witty', 'zesty',
];

const ANIMALS = [
  'otter', 'fox', 'heron', 'lynx', 'sparrow', 'whale', 'badger', 'crane',
  'deer', 'eagle', 'falcon', 'hare', 'ibis', 'jay', 'koala', 'lemur',
  'marmot', 'newt', 'owl', 'puffin',
];

export function generateHandle(seed?: number): string {
  const pick = (arr: readonly string[], offset: number) => {
    if (seed !== undefined) return arr[(seed + offset) % arr.length];
    return arr[Math.floor(Math.random() * arr.length)];
  };
  return `${pick(ADJECTIVES, 0)}-${pick(ANIMALS, 1)}`;
}
