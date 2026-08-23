/**
 * Two endgames that isolate the bag-versus-set trade-off.
 *   npx tsx scripts/bagtest.ts
 *
 * Both give South the same three cards and the same guaranteed winner. Only the
 * opponents' contract differs, so a correctly weighted engine should duck in one
 * and grab in the other. If it grabs in both, it is treating overtricks as free.
 */
import { Card, Seat, cardName } from '../lib/spades/cards';
import { evaluatePlays } from '../lib/spades/mc';
import { emptyVoids } from '../lib/spades/inference';

const AH = 38;
const H3 = 27;
const C2 = 0;
const MY_HAND: Card[] = [AH, H3, C2];
// Nine unseen cards, none of them spades, so the ace of hearts cannot be trumped.
const UNSEEN: Card[] = [28, 29, 30, 1, 2, 3, 14, 15, 16];

function evaluate(label: string, bids: number[], tricksWon: number[], note: string) {
  const res = evaluatePlays(
    {
      info: {
        observer: 0 as Seat,
        hand: MY_HAND,
        handSizes: [3, 3, 3, 3],
        voids: emptyVoids(),
        unseen: UNSEEN,
      },
      bids,
      trick: [],
      tricksWon,
      spadesBroken: true,
      bagsBefore: [0, 0],
    },
    3000
  );
  const ourContract = bids[0] + bids[2];
  const ourTricks = tricksWon[0] + tricksWon[2];
  const theirContract = bids[1] + bids[3];
  const theirTricks = tricksWon[1] + tricksWon[3];
  console.log(`\n${label}`);
  console.log(
    `  we bid ${ourContract} and have ${ourTricks}; they bid ${theirContract} and have ${theirTricks}, 3 tricks left`
  );
  console.log(`  ${note}`);
  for (const c of res.candidates) {
    console.log(
      `    ${cardName(c.card).padEnd(4)} ev ${c.ev.toFixed(2).padStart(7)}   ` +
        `we make ${(c.makeProb * 100).toFixed(0).padStart(3)}%   ` +
        `they are set ${(c.setProb * 100).toFixed(0).padStart(3)}%   ` +
        `our bags ${c.avgBags.toFixed(2)}`
    );
  }
  const best = res.candidates[0].card;
  console.log(`  engine leads ${cardName(best)}${best === AH ? '  <- grabs the trick' : '  <- ducks'}`);
  return best;
}

// A: our contract is made and theirs is too. Another trick is a pure bag.
const a = evaluate(
  'A. Nothing left to play for — an extra trick is a pure bag',
  [2, 3, 2, 2],
  [2, 3, 2, 3],
  'they have already made 5, so winning here buys nothing but a bag'
);

// B: same shape, but they still need two of the last three. Taking tricks sets them.
const b = evaluate(
  'B. Same cards, but they are two short with three to play',
  [2, 4, 2, 4],
  [2, 3, 2, 3],
  'every trick we steal now is a trick they cannot get back'
);

console.log('');
const ok = a !== AH && b === AH;
if (ok) {
  console.log('PASS: ducks the pure bag, grabs the trick that sets them.');
} else if (a === AH && b === AH) {
  console.log('FAIL: grabs in both — overtricks are being treated as free.');
} else if (a !== AH && b !== AH) {
  console.log('FAIL: ducks in both — it is not seeing the chance to set them.');
} else {
  console.log('FAIL: it has the two situations backwards.');
}
process.exit(ok ? 0 : 1);
