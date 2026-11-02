// EXPECTED_FUTURE_POLICY. Inactive R1 evidence, not an existing-product bug claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeIncomingTurnImmobility } from '../../src/incoming-turn-immobility.ts';
import { legalActionCandidates, listLegalActions, validateAction } from '../../src/legal.ts';
import { applyAction } from '../../src/apply.ts';
import { resolveToStability } from '../../src/resolve.ts';
import { serializeState } from '../../src/serialize.ts';
import { deterministicStateHash } from '../../src/hash.ts';
import { commanderOutcome } from '../../../shared-types/src/commander-outcome.js';
import { boundedEngineOperation, checkEngineComputation, withEngineComputationGuard,
  EngineComputationLimit, MAX_ENGINE_OPERATION_EXPANSIONS } from '../../src/computation-guard.ts';
import { commander, unit, makeState } from '../helpers/state-builders.mjs';
// Exact supplied board-only JSON bytes embedded, SHA256
// 673980e4e25e99f3325cd7047df7bd4efe7c4d84d9b5b84701f22bce7a15d816.
const reference = {
  "scope": "Board-only immutable saved reference. Expected future R1 policy, not rewritten history or current product outcome.",
  "recordedDisplayMoveNumber": 31,
  "recordedArrayIndex": 30,
  "snapshot": {
    "boardSize": 10,
    "sideToMove": "P2",
    "turnIndex": 25,
    "pieces": [
      {
        "id": "C1",
        "owner": "P1",
        "kind": "commander",
        "position": {
          "row": 3,
          "col": 6
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-1",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 5,
          "col": 6
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-10",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 8,
          "col": 0
        },
        "supplied": true,
        "commanded": false,
        "displaySupplied": true,
        "displayCommanded": false,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-2",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 3,
          "col": 4
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-3",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 5,
          "col": 4
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-4",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 6,
          "col": 2
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-5",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 3,
          "col": 2
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-6",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 8,
          "col": 1
        },
        "supplied": true,
        "commanded": false,
        "displaySupplied": true,
        "displayCommanded": false,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-7",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 9,
          "col": 1
        },
        "supplied": true,
        "commanded": false,
        "displaySupplied": true,
        "displayCommanded": false,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-8",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 6,
          "col": 5
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "U1-9",
        "owner": "P1",
        "kind": "unit",
        "position": {
          "row": 5,
          "col": 2
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      },
      {
        "id": "C2",
        "owner": "P2",
        "kind": "commander",
        "position": {
          "row": 9,
          "col": 0
        },
        "supplied": true,
        "commanded": true,
        "displaySupplied": true,
        "displayCommanded": true,
        "shifted": false,
        "pushed": false
      }
    ],
    "continuation": null,
    "outcome": {
      "status": "ongoing"
    },
    "artifacts": {
      "mode": "full",
      "supply": [
        {
          "player": "P1",
          "reachability": [
            "C1",
            "U1-1",
            "U1-10",
            "U1-2",
            "U1-3",
            "U1-4",
            "U1-5",
            "U1-6",
            "U1-7",
            "U1-8",
            "U1-9"
          ],
          "shortestPathByPieceId": {
            "C1": [
              {
                "row": 3,
                "col": 6
              },
              {
                "row": 2,
                "col": 6
              },
              {
                "row": 1,
                "col": 6
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-1": [
              {
                "row": 5,
                "col": 6
              },
              {
                "row": 4,
                "col": 6
              },
              {
                "row": 3,
                "col": 6
              },
              {
                "row": 2,
                "col": 6
              },
              {
                "row": 1,
                "col": 6
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-10": [
              {
                "row": 8,
                "col": 0
              },
              {
                "row": 7,
                "col": 0
              },
              {
                "row": 6,
                "col": 0
              },
              {
                "row": 5,
                "col": 0
              },
              {
                "row": 4,
                "col": 0
              },
              {
                "row": 3,
                "col": 0
              },
              {
                "row": 2,
                "col": 0
              },
              {
                "row": 1,
                "col": 0
              },
              {
                "row": 0,
                "col": 0
              },
              {
                "row": 0,
                "col": 1
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-2": [
              {
                "row": 3,
                "col": 4
              },
              {
                "row": 2,
                "col": 4
              },
              {
                "row": 1,
                "col": 4
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-3": [
              {
                "row": 5,
                "col": 4
              },
              {
                "row": 4,
                "col": 4
              },
              {
                "row": 3,
                "col": 4
              },
              {
                "row": 2,
                "col": 4
              },
              {
                "row": 1,
                "col": 4
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-4": [
              {
                "row": 6,
                "col": 2
              },
              {
                "row": 5,
                "col": 2
              },
              {
                "row": 4,
                "col": 2
              },
              {
                "row": 3,
                "col": 2
              },
              {
                "row": 2,
                "col": 2
              },
              {
                "row": 1,
                "col": 2
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-5": [
              {
                "row": 3,
                "col": 2
              },
              {
                "row": 2,
                "col": 2
              },
              {
                "row": 1,
                "col": 2
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-6": [
              {
                "row": 8,
                "col": 1
              },
              {
                "row": 7,
                "col": 1
              },
              {
                "row": 6,
                "col": 1
              },
              {
                "row": 5,
                "col": 1
              },
              {
                "row": 4,
                "col": 1
              },
              {
                "row": 3,
                "col": 1
              },
              {
                "row": 2,
                "col": 1
              },
              {
                "row": 1,
                "col": 1
              },
              {
                "row": 0,
                "col": 1
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-7": [
              {
                "row": 9,
                "col": 1
              },
              {
                "row": 8,
                "col": 1
              },
              {
                "row": 7,
                "col": 1
              },
              {
                "row": 6,
                "col": 1
              },
              {
                "row": 5,
                "col": 1
              },
              {
                "row": 4,
                "col": 1
              },
              {
                "row": 3,
                "col": 1
              },
              {
                "row": 2,
                "col": 1
              },
              {
                "row": 1,
                "col": 1
              },
              {
                "row": 0,
                "col": 1
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-8": [
              {
                "row": 6,
                "col": 5
              },
              {
                "row": 5,
                "col": 5
              },
              {
                "row": 4,
                "col": 5
              },
              {
                "row": 3,
                "col": 5
              },
              {
                "row": 2,
                "col": 5
              },
              {
                "row": 1,
                "col": 5
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ],
            "U1-9": [
              {
                "row": 5,
                "col": 2
              },
              {
                "row": 4,
                "col": 2
              },
              {
                "row": 3,
                "col": 2
              },
              {
                "row": 2,
                "col": 2
              },
              {
                "row": 1,
                "col": 2
              },
              {
                "row": 0,
                "col": 2
              },
              {
                "row": 0,
                "col": 3
              },
              {
                "row": 0,
                "col": 4
              },
              {
                "row": 0,
                "col": 5
              },
              {
                "row": 0,
                "col": 6
              },
              {
                "row": 0,
                "col": 7
              },
              {
                "row": 0,
                "col": 8
              },
              {
                "row": 0,
                "col": 9
              }
            ]
          },
          "distanceByPieceId": {
            "C1": 6,
            "U1-1": 8,
            "U1-10": 17,
            "U1-2": 8,
            "U1-3": 10,
            "U1-4": 13,
            "U1-5": 10,
            "U1-6": 16,
            "U1-7": 17,
            "U1-8": 10,
            "U1-9": 12
          }
        },
        {
          "player": "P2",
          "reachability": [
            "C2"
          ],
          "shortestPathByPieceId": {
            "C2": [
              {
                "row": 9,
                "col": 0
              }
            ]
          },
          "distanceByPieceId": {
            "C2": 0
          }
        }
      ],
      "command": {
        "candidateEdges": [
          "C1|U1-1",
          "C1|U1-2",
          "U1-1|U1-3",
          "U1-1|U1-8",
          "U1-10|U1-6",
          "U1-10|U1-7",
          "U1-2|U1-3",
          "U1-2|U1-5",
          "U1-3|U1-8",
          "U1-3|U1-9",
          "U1-4|U1-8",
          "U1-4|U1-9",
          "U1-5|U1-9",
          "U1-6|U1-7"
        ],
        "cutEdges": [],
        "activeEdges": [
          "C1|U1-1",
          "C1|U1-2",
          "U1-1|U1-3",
          "U1-1|U1-8",
          "U1-10|U1-6",
          "U1-10|U1-7",
          "U1-2|U1-3",
          "U1-2|U1-5",
          "U1-3|U1-8",
          "U1-3|U1-9",
          "U1-4|U1-8",
          "U1-4|U1-9",
          "U1-5|U1-9",
          "U1-6|U1-7"
        ],
        "shortestPathToCommanderByPieceId": {
          "C1": [
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-1": [
            {
              "row": 5,
              "col": 6
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-2": [
            {
              "row": 3,
              "col": 4
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-3": [
            {
              "row": 5,
              "col": 4
            },
            {
              "row": 5,
              "col": 6
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-4": [
            {
              "row": 6,
              "col": 2
            },
            {
              "row": 6,
              "col": 5
            },
            {
              "row": 5,
              "col": 6
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-5": [
            {
              "row": 3,
              "col": 2
            },
            {
              "row": 3,
              "col": 4
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-8": [
            {
              "row": 6,
              "col": 5
            },
            {
              "row": 5,
              "col": 6
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "U1-9": [
            {
              "row": 5,
              "col": 2
            },
            {
              "row": 5,
              "col": 4
            },
            {
              "row": 5,
              "col": 6
            },
            {
              "row": 3,
              "col": 6
            }
          ],
          "C2": [
            {
              "row": 9,
              "col": 0
            }
          ]
        }
      },
      "groups": {
        "componentByPieceId": {
          "C1": "P1:C1",
          "C2": "P2:C2",
          "U1-1": "P1:U1-1",
          "U1-10": "P1:U1-10",
          "U1-6": "P1:U1-10",
          "U1-7": "P1:U1-10",
          "U1-2": "P1:U1-2",
          "U1-3": "P1:U1-3",
          "U1-4": "P1:U1-4",
          "U1-9": "P1:U1-4",
          "U1-5": "P1:U1-5",
          "U1-8": "P1:U1-8"
        },
        "membersByComponentId": {
          "P1:C1": [
            "C1"
          ],
          "P2:C2": [
            "C2"
          ],
          "P1:U1-1": [
            "U1-1"
          ],
          "P1:U1-10": [
            "U1-10",
            "U1-6",
            "U1-7"
          ],
          "P1:U1-2": [
            "U1-2"
          ],
          "P1:U1-3": [
            "U1-3"
          ],
          "P1:U1-4": [
            "U1-4",
            "U1-9"
          ],
          "P1:U1-5": [
            "U1-5"
          ],
          "P1:U1-8": [
            "U1-8"
          ]
        },
        "strengthByComponentId": {
          "P1:C1": 1,
          "P2:C2": 1,
          "P1:U1-1": 1,
          "P1:U1-10": 3,
          "P1:U1-2": 1,
          "P1:U1-3": 1,
          "P1:U1-4": 2,
          "P1:U1-5": 1,
          "P1:U1-8": 1
        }
      }
    }
  }
}
;
const after31 = () => structuredClone(reference.snapshot);
const context = state => ({ kind: 'ordinary-incoming-live-turn', incomingSide: state.sideToMove, turnIndex: state.turnIndex });
const settle = state => resolveToStability(structuredClone(state), { artifactMode: state.artifacts?.mode ?? 'full' });
const admitReference = () => {
  assert.equal(reference.recordedDisplayMoveNumber, 31);
  assert.equal(reference.recordedArrayIndex, 30);
  const state = after31(), before = structuredClone(state), physical = settle(state);
  assert.equal(state.sideToMove, 'P2'); assert.equal(state.turnIndex, 25);
  assert.equal(state.continuation, null);
  assert.equal(state.outcome.status, 'ongoing');
  assert.equal(serializeState(state), serializeState(physical), 'actual saved board must already be canonically stable');
  assert.equal(commanderOutcome(physical.pieces).status, 'ongoing');
  assert.equal(physical.pieces.find(p => p.id === 'C2').supplied, true);
  const legal = listLegalActions(state);
  assert.deepEqual(legal, [{ type: 'pass' }], 'complete current Legal must be exactly Pass');
  assert.equal(validateAction(state, legal[0]).ok, true);
  const other = structuredClone(state); other.sideToMove = 'P1';
  const otherLegal = listLegalActions(other).filter(action => action.type !== 'pass' && action.type !== 'end_turn');
  assert.equal(otherLegal.length, 20, 'P1 counterfactual has 20 real legal piece actions; it is NOT an actual incoming context');
  for (const action of otherLegal) assert.equal(validateAction(other, action).ok, true);
  assert.deepEqual(state, before); return state;
};
const boxedWithProject = () => settle(makeState({ sideToMove: 'P2', pieces: [
  commander('C1', 'P1', 0, 9), commander('C2', 'P2', 9, 0),
  unit('N', 'P2', 8, 0), unit('E', 'P2', 9, 1), unit('NE', 'P2', 8, 1),
] }));
const packed = side => {
  const pieces = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
    const owner = col >= 5 ? 'P1' : 'P2';
    pieces.push(row === 0 && col === 9 ? commander('C1', 'P1', row, col)
      : row === 9 && col === 0 ? commander('C2', 'P2', row, col)
      : unit(`${owner}-${row}-${col}`, owner, row, col));
  }
  return settle(makeState({ sideToMove: side, pieces }));
};
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const untouched = (state, action) => {
  const before = structuredClone(state), bytes = serializeState(state), hash = deterministicStateHash(state);
  const result = action(); assert.deepEqual(state, before);
  assert.equal(serializeState(state), bytes); assert.equal(deterministicStateHash(state), hash); return result;
};

if (process.env.RIGHELT_R1_BEHAVIOR_CONTROL === 'saved-outcome') {
  test('EXPECTED_FUTURE_POLICY: saved after31 outcome does not yet record incoming-only-Pass loss', { timeout: 15000 }, () => {
    const state = admitReference();
    // Meaningful expected failure AFTER real Legal/supply/identity guards.
    // Never apply a synthetic Pass or rewrite the saved historical outcome.
    assert.equal(state.outcome.status, 'p1_win', 'EXPECTED ASSERTION FAILURE: current saved outcome is ongoing; proposed R1 loses incoming P2');
  });
} else {
  test('after31 remains byte-identical while exhaustive sole Pass proves only incoming P2 loss', { timeout: 15000 }, t => {
    const state = admitReference();
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'incoming-loss'); assert.equal(result.incomingSide, 'P2'); assert.equal(result.winner, 'P1');
    assert.equal(result.cause, 'incoming-turn-immobility'); assert.equal(result.exhaustive, true);
    assert.deepEqual(result.legalActions, [{ type: 'pass' }]);
    assert.equal(result.examinedCandidates, [...legalActionCandidates(state)].length);
    assert.equal(result.inputCanonical, serializeState(state)); assert.equal(result.inputCanonical, result.settledCanonical);
    assert.equal(state.outcome.status, 'ongoing'); assert.equal(state.turnIndex, 25);
    t.diagnostic(JSON.stringify({ recordedDisplayMoveNumber: 31, recordedArrayIndex: 30,
      currentOutcome: state.outcome, proposedEvidence: result, appendedPass: false }));
  });
  test('boxed supplied commander with a legal unit Project is not immobile; witness validates and applies', { timeout: 15000 }, () => {
    const state = boxedWithProject(); assert.equal(state.outcome.status, 'ongoing');
    assert.equal(state.pieces.find(p => p.id === 'C2').supplied, true);
    const legal = listLegalActions(state);
    assert.equal(legal.some(a => a.actorId === 'C2'), false, 'commander really is boxed');
    const project = { type: 'project', actorId: 'N', from: { row: 8, col: 0 }, to: { row: 6, col: 0 } };
    assert.ok(legal.some(a => JSON.stringify(a) === JSON.stringify(project)));
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'not-immobile'); assert.equal(result.exhaustive, false);
    assert.equal(validateAction(state, result.witness).ok, true);
    assert.ok(legal.some(a => JSON.stringify(a) === JSON.stringify(result.witness)));
    const applied = applyAction(state, result.witness).state;
    assert.notEqual(serializeState(applied), serializeState(state));
  });
  test('first legal piece witness stops native lazy enumeration before later budget pressure', { timeout: 15000 }, () => {
    const state = boxedWithProject(), candidates = [...legalActionCandidates(state)];
    const index = candidates.findIndex(a => a.type !== 'pass' && validateAction(state, a).ok);
    assert.ok(index >= 0 && index + 1 < candidates.length);
    let expansions = 0;
    const first = withEngineComputationGuard(expansion => { if (expansion) expansions++; },
      () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(first.kind, 'not-immobile'); assert.equal(first.examinedCandidates, index + 1);
    let spent = 0;
    const second = withEngineComputationGuard(expansion => {
      if (expansion && ++spent > expansions) throw new EngineComputationLimit();
    }, () => {
      const result = probeIncomingTurnImmobility(state, context(state));
      assert.equal(result.kind, 'not-immobile');
      assert.throws(() => checkEngineComputation(true), EngineComputationLimit, 'unrelated later budget pressure remains outside the completed positive witness');
      return result;
    });
    assert.deepEqual(second.witness, first.witness);
  });
  test('UI viewer filtering/paused empty lists cannot turn a real legal board into an R1 loss', { timeout: 15000 }, () => {
    const state = boxedWithProject();
    const ui = { paused: true, viewerLegalActions: [], modelCandidates: [] };
    assert.deepEqual(ui.viewerLegalActions, []);
    assert.equal(probeIncomingTurnImmobility(state, context(state)).kind, 'not-immobile');
    assert.equal('viewerLegalActions' in context(state), false, 'filtered lists are not an evaluator argument');
  });
  for (const side of ['P1', 'P2']) test(`both living supplied sides immobile: only incoming ${side} loses`, { timeout: 15000 }, () => {
    const state = packed(side); assert.equal(commanderOutcome(state.pieces).status, 'ongoing');
    assert.equal(state.pieces.filter(p => p.kind === 'commander' && p.supplied).length, 2);
    assert.deepEqual(listLegalActions(state), [{ type: 'pass' }]);
    const opposite = structuredClone(state); opposite.sideToMove = side === 'P1' ? 'P2' : 'P1';
    assert.deepEqual(listLegalActions(opposite), [{ type: 'pass' }]);
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'incoming-loss'); assert.equal(result.incomingSide, side);
    assert.equal(result.winner, side === 'P1' ? 'P2' : 'P1');
  });
  for (const [label, ctx] of [
    ['missing', undefined], ['historical', { kind: 'historical', incomingSide: 'P2', turnIndex: 25 }],
    ['ordinary midturn', { kind: 'ordinary-midturn', incomingSide: 'P2', turnIndex: 25 }],
    ['wrong side', { kind: 'ordinary-incoming-live-turn', incomingSide: 'P1', turnIndex: 25 }],
    ['invalid side', { kind: 'ordinary-incoming-live-turn', incomingSide: 'P3', turnIndex: 25 }],
    ['stale index', { kind: 'ordinary-incoming-live-turn', incomingSide: 'P2', turnIndex: 24 }],
    ['fractional index', { kind: 'ordinary-incoming-live-turn', incomingSide: 'P2', turnIndex: 25.5 }],
  ]) test(`${label} context is not an incoming-turn proof`, { timeout: 15000 }, () => {
    const state = after31(); const result = untouched(state, () => probeIncomingTurnImmobility(state, ctx));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'incoming-context');
  });
  for (const continuation of [
    { type: 'rush', owner: 'P2', chainLength: 1, rushedPieceIds: ['C2'] },
    { type: 'push', phase: 'retreat', owner: 'P2', attackerOwner: 'P1', pushedPieceId: 'C2', followPoint: { row: 9, col: 1 }, chainLength: 1 },
    { type: 'push', phase: 'follow', owner: 'P2', attackerOwner: 'P2', followPoint: { row: 8, col: 0 }, chainLength: 1 },
  ]) test(`${continuation.type}/${continuation.phase ?? 'sequence'} cannot be incoming loss`, { timeout: 15000 }, () => {
    const state = after31(); state.continuation = continuation;
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'continuation');
  });
  test('a genuine sole-EndTurn rush closure is not a sole-Pass proof', { timeout: 15000 }, () => {
    const state = after31(); state.continuation = { type: 'rush', owner: 'P2', chainLength: 1,
      frozenOwner: 'P2', frozenPieceStatesById: { C2: { supplied: true, commanded: true } },
      rushedPieceIds: ['C2'], rushChainPieceIds: ['C2'] };
    assert.deepEqual(listLegalActions(state), [{ type: 'end_turn' }]);
    assert.equal(probeIncomingTurnImmobility(state, context(state)).kind, 'not-applicable');
  });
  for (const flag of ['pushed', 'shifted']) test(`uncleared ${flag} flag is not incoming`, { timeout: 15000 }, () => {
    const state = after31(); state.pieces[0][flag] = true;
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'temporary-piece-flags');
  });
  test('terminal displacement metadata is outside ordinary incoming context', { timeout: 15000 }, () => {
    const state = after31(); state.terminalDisplacement = {};
    // Rejection precedes serializer's terminal-only metadata validator.
    const before = structuredClone(state), result = probeIncomingTurnImmobility(state, context(state));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'terminal-displacement');
    assert.equal(result.examinedCandidates, 0); assert.deepEqual(state, before);
  });
  test('changed supply is rejected rather than proving on a counterfactual settled board', { timeout: 15000 }, () => {
    const state = after31(); state.pieces.find(p => p.id === 'C2').supplied = false;
    const actual = settle(state); assert.equal(actual.pieces.find(p => p.id === 'C2').supplied, true);
    assert.notEqual(serializeState(actual), serializeState(state));
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'unknown'); assert.equal(result.reason, 'settlement-changed'); assert.equal(result.examinedCandidates, 0);
    assert.notEqual(result.inputCanonical, result.settledCanonical);
  });
  test('actual forced unit removal cannot redefine the input board for R1', { timeout: 15000 }, () => {
    const state = makeState({ pieces: [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 9, 0),
      unit('orphan', 'P1', 5, 5), ...[[4,5],[6,5],[5,4],[5,6]].map(([r,c],i) => unit(`wall${i}`, 'P2', r, c))] });
    const actual = settle(state); assert.equal(actual.pieces.some(p => p.id === 'orphan'), false);
    assert.equal(actual.outcome.status, 'ongoing');
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'unknown'); assert.equal(result.reason, 'settlement-changed'); assert.equal(result.examinedCandidates, 0);
  });
  test('artifact-only canonical difference also blocks sole-Pass admission', { timeout: 15000 }, () => {
    const state = after31(); delete state.artifacts;
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'unknown'); assert.equal(result.reason, 'settlement-changed');
  });
  for (const ids of [['C1'], ['C2'], ['C1','C2']]) test(`real commander precedence with missing ${ids.join('+')}`, { timeout: 15000 }, () => {
    const state = after31(); state.pieces = state.pieces.filter(p => !ids.includes(p.id));
    const outcome = commanderOutcome(settle(state).pieces); assert.notEqual(outcome.status, 'ongoing');
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'commander-outcome');
    assert.deepEqual(result.commanderOutcome, outcome); assert.equal(result.examinedCandidates, 0);
    assert.equal(state.outcome.status, 'ongoing', 'never rewrite saved input with commander or R1 result');
  });
  test('living but actually unsupplied commander defeat takes precedence over R1', { timeout: 15000 }, () => {
    const state = makeState({ sideToMove: 'P2', pieces: [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 5, 5),
      ...[[4,5],[6,5],[5,4],[5,6]].map(([r,c],i) => unit(`block${i}`, 'P1', r, c))] });
    const actual = settle(state);
    assert.equal(actual.pieces.find(p => p.id === 'C2').supplied, false);
    assert.deepEqual(actual.outcome, { status: 'p1_win', reason: 'p2_commander_unsupplied' });
    const result = untouched(state, () => probeIncomingTurnImmobility(state, context(state)));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'commander-outcome');
    assert.deepEqual(result.commanderOutcome, actual.outcome); assert.equal(result.examinedCandidates, 0);
  });
  test('completed history and empty/no-Pass history never prove incoming loss', { timeout: 15000 }, () => {
    const state = after31(); state.outcome = { status: 'p1_win', reason: 'retained-history' }; const before = structuredClone(state);
    assert.deepEqual(listLegalActions(state), []);
    assert.equal(probeIncomingTurnImmobility(state, context(state)).reason, 'historical-completed'); assert.deepEqual(state, before);
    const empty = makeState({ pieces: [] });
    const result = probeIncomingTurnImmobility(empty, context(empty));
    assert.equal(result.kind, 'not-applicable'); assert.equal(result.reason, 'commander-outcome'); assert.equal(result.commanderOutcome.status, 'draw');
  });
  test('tiny cap/cancellation are unknown; later sufficient call is not poisoned', { timeout: 15000 }, () => {
    const state = after31(), before = structuredClone(state);
    const tiny = probeIncomingTurnImmobility(state, context(state), { maxExpansions: 1 });
    assert.equal(tiny.kind, 'unknown'); assert.equal(tiny.reason, 'rules_budget_exceeded');
    let entered = false;
    const cancelled = withEngineComputationGuard(expansion => { if (expansion) throw new EngineComputationLimit(); },
      () => { entered = true; return probeIncomingTurnImmobility(state, context(state)); });
    assert.equal(entered, true, 'cancellation must occur after evaluator entry, not in the outer guard setup');
    assert.equal(cancelled.kind, 'unknown'); assert.equal(cancelled.reason, 'rules_budget_exceeded');
    assert.equal(probeIncomingTurnImmobility(state, context(state), { maxExpansions: MAX_ENGINE_OPERATION_EXPANSIONS }).kind, 'incoming-loss');
    assert.deepEqual(state, before);
  });
  test('outer guard setup cancellation propagates before the evaluator can enter', { timeout: 15000 }, () => {
    const state = after31(), before = structuredClone(state); let entered = false;
    assert.throws(() => withEngineComputationGuard(() => { throw new EngineComputationLimit(); },
      () => { entered = true; return probeIncomingTurnImmobility(state, context(state)); }), EngineComputationLimit);
    assert.equal(entered, false); assert.deepEqual(state, before);
  });
  test('genuine dependency/resolver-boundary errors propagate unchanged', { timeout: 15000 }, () => {
    const state = after31(), error = new Error('genuine dependency failure'); let checks = 0;
    assert.throws(() => withEngineComputationGuard(() => { if (++checks === 3) throw error; },
      () => probeIncomingTurnImmobility(state, context(state))), value => value === error);
    assert.equal(probeIncomingTurnImmobility(state, context(state)).kind, 'incoming-loss');
  });
  for (const cap of [0, -1, 1.5, NaN, Infinity, MAX_ENGINE_OPERATION_EXPANSIONS + 1]) test(`lower-only invalid cap ${cap}`, { timeout: 15000 }, () => {
    assert.throws(() => probeIncomingTurnImmobility(after31(), context(after31()), { maxExpansions: cap }), TypeError);
  });
  test('frozen caller/context and mutable output evidence never alias', { timeout: 15000 }, () => {
    const state = freeze(after31()), ctx = freeze(context(state));
    const result = untouched(state, () => probeIncomingTurnImmobility(state, ctx));
    assert.equal(result.kind, 'incoming-loss'); result.legalActions[0].type = 'end_turn';
    assert.equal(state.outcome.status, 'ongoing');
    assert.deepEqual(probeIncomingTurnImmobility(state, ctx).legalActions, [{ type: 'pass' }]);
    const moving = boxedWithProject(), copy = structuredClone(moving), witness = probeIncomingTurnImmobility(moving, context(moving));
    assert.equal(witness.kind, 'not-immobile'); witness.witness.from.row = 99;
    assert.deepEqual(moving, copy);
  });
}
