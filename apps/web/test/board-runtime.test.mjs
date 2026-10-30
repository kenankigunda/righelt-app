import test from "node:test";
import assert from "node:assert/strict";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";

const noop = () => {};
const destroyUninitializedNodeRuntime = runtime => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    Object.defineProperty(globalThis, 'document', {configurable:true,value:{removeEventListener:noop}});
    runtime.destroy();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete globalThis.document;
  }
};

test('turn indicator accepts host perspective text while preserving actual actor color',async()=>{
 const tones=new Set();
 const indicator={textContent:'',classList:{remove:(...values)=>values.forEach(value=>tones.delete(value)),add:value=>tones.add(value)}};
 let current={text:'Opponent to play',side:'P2'};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>false},controls:{getTurnIndicator:()=>current}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:indicator});
 await runtime.loadSnapshot({sideToMove:'P1',pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
 assert.equal(indicator.textContent,'Opponent to play');assert(tones.has('player-tone-p2'));assert(!tones.has('player-tone-p1'));
 current={text:'Your turn to play',side:'P1'};runtime.refreshStatus();
 assert.equal(indicator.textContent,'Your turn to play');assert(tones.has('player-tone-p1'));assert(!tones.has('player-tone-p2'));
});

test('generic turn indicator uses color names without game identity',async()=>{
 const indicator={textContent:'',classList:{remove:noop,add:noop}};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>false}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:indicator});
 for(const [side,text] of [['P1','Red to play'],['P2','Blue to play']]){
  await runtime.loadSnapshot({sideToMove:side,pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});assert.equal(indicator.textContent,text);
 }
});

test('board status updates keep matching message controls and safely replace changed actions',async()=>{
 const text={nodeType:3,nodeValue:'Replay · 1 of 3 '};
 const stopLabel={textContent:'Stop replay'},stopSvg={},stop={dataset:{boardMessageAction:'replay-stop'},children:[stopSvg,stopLabel],querySelector:()=>stopLabel};
 let html='',writes=0,message={text:'Replay · 2 of 3',actions:[{id:'replay-stop',label:'Stop replay'}]};
 const label={firstChild:text,childNodes:[text,stop],querySelectorAll:()=>[stop],addEventListener:noop,removeEventListener:noop,
  get innerHTML(){return html;},set innerHTML(value){writes++;html=value;}};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>false},controls:{getBoardMessage:()=>message}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot({sideToMove:'P1',turnIndex:0,pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
 assert.equal(writes,0);assert.equal(text.nodeValue,'Replay · 2 of 3 ');assert.equal(stopLabel.textContent,'Stop replay');
 message={text:'Replay · 3 of 3',actions:[{id:'replay-stop',label:'Stop'}]};runtime.refreshStatus();
 assert.equal(writes,0);assert.equal(text.nodeValue,'Replay · 3 of 3 ');assert.equal(stopLabel.textContent,'Stop');
 message={text:'Finished <safely>',action:{id:'replay"next',label:'<Next>'}};runtime.refreshStatus();
 assert.equal(writes,1);assert.match(html,/Finished &lt;safely&gt;/);assert.match(html,/data-board-message-action="replay&quot;next"/);assert.match(html,/&lt;Next&gt;/);
 assert.doesNotMatch(html,/<safely>|<Next>|data-board-message-action="replay-stop"/);
});

test('named board messages update suffix and controls in place without replacing action nodes',async()=>{
 const name={nodeName:'BDI',classList:{contains:value=>value==='board-message-name'},textContent:'Old name',title:'Old name'};
 const buttonLabel={textContent:'Show me again'},buttonSvg={};
 const suffix={nodeType:3,nodeValue:' moved '},button={dataset:{boardMessageAction:'replay-computer'},children:[buttonSvg,buttonLabel],querySelector:()=>buttonLabel};
 let writes=0,html='',message={actorName:'משחק 星',text:'משחק 星 rushed from (1, 2) to (3, 4)',action:{id:'replay-computer',label:'Show me again'}};
 const label={firstChild:name,childNodes:[name,suffix,button],querySelectorAll:()=>[button],addEventListener:noop,removeEventListener:noop,
  get innerHTML(){return html;},set innerHTML(value){writes++;html=value;}};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>false},controls:{getBoardMessage:()=>message}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
 await runtime.loadSnapshot({sideToMove:'P1',turnIndex:0,pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
 assert.equal(writes,0);assert.equal(name.textContent,'משחק 星');assert.equal(name.title,'משחק 星');assert.equal(suffix.nodeValue,' rushed from (1, 2) to (3, 4) ');assert.equal(label.childNodes[2],button);
 message={...message,text:'משחק 星 followed from (3, 4) to (5, 6)',action:{id:'replay-computer',label:'Replay'}};runtime.refreshStatus();
 assert.equal(writes,0);assert.equal(suffix.nodeValue,' followed from (3, 4) to (5, 6) ');assert.equal(buttonLabel.textContent,'Replay');assert.equal(label.firstChild,name);assert.equal(label.childNodes[2],button);assert.equal(button.children[0],buttonSvg);assert.equal(button.children[1],buttonLabel);
 message={actorName:'mismatch',text:'Ordinary <safe>',action:{id:'replay-computer',label:'Replay'}};runtime.refreshStatus();
 assert.equal(writes,1);assert.match(html,/Ordinary &lt;safe&gt;/);assert.doesNotMatch(html,/<bdi/);
});

test("board runtime keeps internal action type when external controls are absent", () => {
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => ({ details: null, prompts: [] }),
      getPieceById: () => null,
      getPieceAt: () => null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
  });

  assert.equal(runtime.getActionType(), "pass");
  runtime.setActionType("project");
  assert.equal(runtime.getActionType(), "project");
  runtime.setActionType("move");
  assert.equal(runtime.getActionType(), "move");
});

test("board runtime uses recorded-action overlay mode without selected piece summary flow", async () => {
  const renderCalls = [];
  let summaryCalls = 0;
  let boardPreviewLabelValue = "";
  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(value) {
      boardPreviewLabelValue = value;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(value) {
      boardPreviewLabelValue = value;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: () => {
        summaryCalls += 1;
        return null;
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => false,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });

  const recordedAction = {
    type: "move",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  };
  const recordedActionStartPiece = {
    id: "A1",
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 2 },
    supplied: false,
    commanded: false,
  };

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [],
      overlayMode: "recorded-action",
      recordedAction,
      recordedActionStartPiece,
    },
  );

  assert.equal(summaryCalls, 0);
  assert.equal(renderCalls.at(-1)?.overlay?.mode, "recorded-action");
  assert.deepEqual(renderCalls.at(-1)?.overlay?.recordedAction, recordedAction);
  assert.deepEqual(renderCalls.at(-1)?.overlay?.recordedActionStartPiece, recordedActionStartPiece);
  assert.match(boardPreviewLabelEl.innerHTML || boardPreviewLabelEl.textContent, /Recorded move from.*board-preview-coordinate-chip-selected-piece.*4,\s*2.*board-preview-coordinate-chip-target.*4,\s*3/);
});

test("board runtime starts history destruction in the removal-effects layer before the settled overlay appears", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};

  try {
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => false,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [],
      overlayMode: "recorded-action",
      recordedAction: {
        type: "move",
        actorId: "A1",
        from: { row: 4, col: 2 },
        to: { row: 4, col: 3 },
      },
      destroyedPieces: [{
        row: 9,
        col: 9,
        ownerSeat: "p2",
        kind: "unit",
        supplied: false,
        commanded: false,
        piece: {
          id: "Z9",
          owner: "P2",
          kind: "unit",
          position: { row: 9, col: 9 },
          supplied: false,
          commanded: false,
        },
      }],
    },
  );

  assert.deepEqual(renderCalls.at(-1)?.overlay?.destroyedPieces, []);
  assert.equal(renderCalls.at(-1)?.removalEffects?.[0]?.piece?.id, "Z9");
  assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("board runtime renders removal effects returned from shell apply actions", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({
          accepted: true,
          state: {
            sideToMove: "P1",
            turnIndex: 0,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
          removedPieces: [
            {
              pieceId: "A1",
              position: { row: 4, col: 2 },
              reason: "no_retreat",
              message: "Piece at (4, 2) destroyed because it could not retreat",
            },
          ],
        }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });
    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 2 },
            supplied: true,
            commanded: true,
          },
        ],
      },
      { legalActions: [] },
    );

    await runtime.submitCurrentAction({
      type: "push",
      actorId: "A1",
      from: { row: 4, col: 1 },
      to: { row: 4, col: 2 },
    });

    const renderWithRemoval = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(renderWithRemoval);
    assert.equal(renderWithRemoval.removalEffects[0].piece?.id, "A1");
    assert.equal(scheduledTimers.length, 1);
    assert.equal(scheduledTimers[0].delay, 2400);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("board runtime uses the same concise End turn CTA at narrow and wide widths", async () => {
  let previewHtml = "";
  const originalWindow = globalThis.window;
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query === "(max-width: 430px)",
    }),
  };

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: noop,
        getSelectedPieceSummary: () => null,
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: {
        set innerHTML(value) {
          previewHtml = value;
        },
        get innerHTML() {
          return previewHtml;
        },
        set textContent(value) {
          previewHtml = value;
        },
        get textContent() {
          return previewHtml;
        },
        addEventListener: noop,
        removeEventListener: noop,
      },
      boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
    });

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: {
          type: "rush",
          owner: "P1",
          rushedPieceIds: ["A1"],
          rushChainPieceIds: ["A1"],
          chainLength: 1,
        },
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 4 },
            supplied: true,
            commanded: true,
          },
        ],
      },
      {
        legalActions: [{ type: "pass", actorId: "A1", from: { row: 4, col: 4 } }],
      },
    );

    assert.match(previewHtml, />End turn</);
    assert.doesNotMatch(previewHtml, />end your turn now</);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("board runtime omits end-turn CTA when the rush chain is not yet closable", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["A"],
        rushChainPieceIds: ["A"],
        chainLength: 1,
      },
      outcome: null,
      pieces: [
        {
          id: "A",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 3 },
          supplied: true,
          commanded: true,
        },
        {
          id: "B",
          owner: "P1",
          kind: "unit",
          position: { row: 5, col: 5 },
          supplied: true,
          commanded: true,
        },
        {
          id: "C1",
          owner: "P1",
          kind: "commander",
          position: { row: 3, col: 6 },
          supplied: true,
          commanded: true,
        },
        {
          id: "C2",
          owner: "P2",
          kind: "commander",
          position: { row: 6, col: 3 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E0",
          owner: "P2",
          kind: "unit",
          position: { row: 0, col: 4 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E1",
          owner: "P2",
          kind: "unit",
          position: { row: 9, col: 4 },
          supplied: true,
          commanded: true,
        },
        {
          id: "E2",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 5 }, to: { row: 4, col: 4 } }],
    },
  );

  assert.doesNotMatch(previewHtml, /data-board-preview-action="end-turn"/);
  assert.match(previewHtml, /Rush to reconnect|Select a rush/);
  assert.match(previewHtml, /to reconnect piece at/);
  assert.match(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
  assert.match(previewHtml, />4, 3</);
});

test("board runtime rush blocker prompt prefers the most recently rushed unsupplied piece", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["A", "B"],
        rushChainPieceIds: ["A", "B"],
        chainLength: 2,
      },
      outcome: null,
      pieces: [
        { id: "A", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
        { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 1 }, supplied: true, commanded: true },
        { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 8 }, supplied: true, commanded: true },
        { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
        { id: "E0", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
        { id: "E1", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 1 }, to: { row: 4, col: 2 } }],
    },
  );

  assert.match(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
  assert.match(previewHtml, />5, 1</);
});

test("board runtime falls back to generic rush prompt when blocker lookup yields no piece", async () => {
  let previewHtml = "";

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: {
        type: "rush",
        owner: "P1",
        rushedPieceIds: ["GONE"],
        rushChainPieceIds: ["GONE"],
        chainLength: 1,
      },
      outcome: null,
      pieces: [
        { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
        { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
        { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
        { id: "E0", owner: "P2", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      ],
    },
    {
      legalActions: [{ type: "rush", actorId: "B", from: { row: 5, col: 5 }, to: { row: 4, col: 5 } }],
    },
  );

  assert.match(previewHtml, /Rush to reconnect|Select a rush/);
  assert.doesNotMatch(previewHtml, /to reconnect piece at/);
  assert.doesNotMatch(previewHtml, /board-preview-coordinate-chip-rush-blocker/);
});

test("board runtime preserves in-progress removal effects across snapshot reloads", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};
  Date.now = () => 5000;

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({
          accepted: true,
          state: {
            sideToMove: "P1",
            turnIndex: 0,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
          removedPieces: [
            {
              pieceId: "A1",
              position: { row: 4, col: 2 },
              reason: "no_retreat",
              message: "Piece at (4, 2) destroyed because it could not retreat",
            },
          ],
        }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 2 },
            supplied: true,
            commanded: true,
          },
        ],
      },
      { legalActions: [] },
    );

    await runtime.submitCurrentAction({
      type: "push",
      actorId: "A1",
      from: { row: 4, col: 1 },
      to: { row: 4, col: 2 },
    });

    const renderWithRemoval = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(renderWithRemoval);
    const originalStartedAt = renderWithRemoval.removalEffects[0].startedAt;
    assert.equal(originalStartedAt, 5000);

    renderCalls.length = 0;

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [],
      },
      { legalActions: [], resetSelection: false },
    );

    const preservedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(preservedRender);
    assert.equal(preservedRender.removalEffects[0].startedAt, originalStartedAt);
    assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test("board runtime preserves in-progress removal effects across interactive turn handoff reloads", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};
  Date.now = () => 5000;

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [{ type: "move", actorId: "B1", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } }],
          removedPieces: [
            {
              pieceId: "A1",
              position: { row: 4, col: 2 },
              reason: "loss_of_supply",
              message: "Piece at (4, 2) destroyed due to loss of supply",
            },
          ],
        }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
        canInteract: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    await runtime.loadSnapshot(
      {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: {
          type: "push",
          owner: "P1",
          phase: "follow",
          source: { row: 4, col: 1 },
          target: { row: 4, col: 2 },
        },
        outcome: null,
        pieces: [
          {
            id: "A1",
            owner: "P1",
            kind: "unit",
            position: { row: 4, col: 2 },
            supplied: false,
            commanded: false,
          },
        ],
      },
      {
        legalActions: [{ type: "follow", actorId: "A1", from: { row: 4, col: 1 }, to: { row: 4, col: 2 } }],
      },
    );

    await runtime.submitCurrentAction({
      type: "follow",
      actorId: "A1",
      from: { row: 4, col: 1 },
      to: { row: 4, col: 2 },
    });

    const renderWithRemoval = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(renderWithRemoval);
    const originalStartedAt = renderWithRemoval.removalEffects[0].startedAt;
    assert.equal(originalStartedAt, 5000);

    renderCalls.length = 0;

    await runtime.loadSnapshot(
      {
        sideToMove: "P2",
        turnIndex: 1,
        continuation: null,
        outcome: null,
        pieces: [],
      },
      {
        legalActions: [{ type: "move", actorId: "B1", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } }],
        resetSelection: true,
      },
    );

    const preservedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(preservedRender);
    assert.equal(preservedRender.removalEffects[0].startedAt, originalStartedAt);
    assert.equal(runtime.getOverlay().mode, "interactive");
    assert.equal(scheduledTimers.length, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test("board runtime does not submit retreat continuation while interaction is locked to the other player", async () => {
  let applyCount = 0;
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => {
        applyCount += 1;
        return { accepted: true, state: null, legalActions: [] };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => false,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P2",
      turnIndex: 0,
      continuation: {
        type: "push",
        phase: "retreat",
        pushedPieceId: "D1",
      },
      outcome: null,
      pieces: [
        {
          id: "D1",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
          pushed: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "retreat",
          actorId: "D1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  await runtime.submitCurrentAction();
  assert.equal(applyCount, 0);
});

test("board runtime uses retreat chip styling for push retreat actor coordinate in preview label", async () => {
  let previewHtml = "";
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
    },
    host: {
      applyAction: async () => ({ accepted: true, state: null, legalActions: [] }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P2",
      turnIndex: 0,
      continuation: {
        type: "push",
        phase: "retreat",
        pushedPieceId: "D1",
        followGroupPieceIds: ["D1"],
      },
      outcome: null,
      pieces: [
        {
          id: "D1",
          owner: "P2",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
          pushed: true,
        },
      ],
    },
    { legalActions: [{ type: "retreat", actorId: "D1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }] },
  );

  assert.match(previewHtml, /board-preview-coordinate-chip-retreat/);
  assert.match(previewHtml, />4, 2</);
  assert.equal(previewHtml.includes("board-preview-coordinate-chip-continuation-pending"), false);
});

test("board preview source coordinate chip uses selected-piece styling", async () => {
  let previewHtml = "";
  let onCellClick = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: (selectedPieceMovePreviews ?? selectedPieceMoves).map((action) => ({
            type: action.type,
            from: action.from ?? null,
            to: action.to ?? null,
            legal: action.legal ?? true,
            blockedReason: action.blockedReason ?? null,
          })),
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ??
        null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find(
            (piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col,
          ) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: true, state: null, legalActions: [] }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 }, legal: true },
        ],
      }),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: {
      set innerHTML(value) {
        previewHtml = value;
      },
      get innerHTML() {
        return previewHtml;
      },
      set textContent(value) {
        previewHtml = value;
      },
      get textContent() {
        return previewHtml;
      },
      addEventListener: noop,
      removeEventListener: noop,
    },
    boardTurnIndicatorEl: { textContent: "", classList: { remove: noop, add: noop } },
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 2, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 2, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 2, col: 2 }, to: { row: 3, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 2, col: 2 });
  await new Promise((r) => setTimeout(r, 0));

  assert.match(previewHtml, /board-preview-coordinate-chip-selected-piece/);
  assert.match(previewHtml, /board-preview-coordinate-chip-selected-piece-p1/);
  assert.match(previewHtml, />2, 2</);
  assert.equal(previewHtml.includes("board-preview-coordinate-chip-source"), false);
});

test("board runtime does not flash no-moves preview text while selected piece moves are loading", async () => {
  let onCellClick = null;
  let resolvePieceMoves = null;
  let boardPreviewLabelValue = "";
  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(value) {
      boardPreviewLabelValue = value;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(value) {
      boardPreviewLabelValue = value;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const piece = snapshot?.pieces?.find((candidate) => candidate.id === selectedPieceId) ?? null;
        if (!piece) {
          return null;
        }
        return {
          details: { owner: piece.owner },
          actions: (Array.isArray(selectedPieceMovePreviews) ? selectedPieceMovePreviews : selectedPieceMoves).map((action) => ({
            type: action.type,
            from: action.from ?? null,
            to: action.to ?? null,
            legal: action.legal,
            blockedReason: action.blockedReason ?? null,
          })),
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord }) => {
        const piece = snapshot?.pieces?.find(
          (candidate) => candidate.position.row === clickedCoord.row && candidate.position.col === clickedCoord.col,
        );
        if (!piece) {
          return {
            selection: { selectedPieceId: null, source: null, target: null },
            nextActionType: "pass",
          };
        }
        return {
          selection: { selectedPieceId: piece.id, source: { ...piece.position }, target: null },
          nextActionType: "move",
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () =>
        new Promise((resolve) => {
          resolvePieceMoves = resolve;
        }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });

  await runtime.loadSnapshot(
    {
      boardSize: 10,
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: { status: "ongoing" },
      pieces: [
        {
          id: "C1",
          owner: "P1",
          kind: "commander",
          position: { row: 3, col: 3 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "pass" },
        { type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 } },
      ],
    },
  );

  onCellClick?.({ row: 3, col: 3 });

  assert.equal(boardPreviewLabelEl.textContent.includes("No moves for this piece at this time"), false);
  assert.equal(boardPreviewLabelEl.textContent.includes("Select a piece to see it supply and command lines"), false);

  resolvePieceMoves?.({
    state: null,
    actions: [{ type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 } }],
    previewActions: [{ type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 }, legal: true }],
  });
});

test("board runtime uses concise action confirmation across input modes", async () => {
  const createBoardPreviewLabel = () => {
    let value = "";
    return {
      get textContent() {
        return value;
      },
      set textContent(next) {
        value = next;
      },
      get innerHTML() {
        return value;
      },
      set innerHTML(next) {
        value = next;
      },
      addEventListener: noop,
      removeEventListener: noop,
    };
  };

  const createRuntime = ({ supportsHover }) => {
    let onCellClick = null;
    let onCellHoverStart = null;
    const boardPreviewLabelEl = createBoardPreviewLabel();
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
          onCellClick = nextOnCellClick;
          onCellHoverStart = nextOnCellHoverStart;
        },
        render: noop,
        getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
          const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
          if (!selectedPiece) {
            return null;
          }
          return {
            details: { owner: selectedPiece.owner },
            actions: (selectedPieceMovePreviews ?? selectedPieceMoves).map((action) => ({
              type: action.type,
              from: action.from ?? null,
              to: action.to ?? null,
              legal: action.legal ?? true,
              blockedReason: action.blockedReason ?? null,
            })),
          };
        },
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
          const clickedPiece =
            snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
          if (clickedPiece) {
            return {
              selection: {
                selectedPieceId: clickedPiece.id,
                source: { ...clickedPiece.position },
                target: null,
              },
              nextActionType: currentActionType,
            };
          }
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: clickedCoord,
            },
            nextActionType: "move",
          };
        },
      },
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({
          state: null,
          actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
          previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
        }),
        canInteract: () => true,
      },
      controls: {
        getSupportsHover: () => supportsHover,
      },
    });

    return { runtime, boardPreviewLabelEl, getOnCellClick: () => onCellClick, getOnCellHoverStart: () => onCellHoverStart };
  };

  const nonHover = createRuntime({ supportsHover: false });
  nonHover.runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: nonHover.boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await nonHover.runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );
  nonHover.getOnCellClick()?.({ row: 4, col: 2 });
  nonHover.getOnCellClick()?.({ row: 4, col: 3 });
  assert.equal(nonHover.boardPreviewLabelEl.textContent.includes("Confirm"), true);

  const hover = createRuntime({ supportsHover: true });
  hover.runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: hover.boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await hover.runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );
  hover.getOnCellClick()?.({ row: 4, col: 2 });
  hover.getOnCellHoverStart()?.({ row: 4, col: 3 });
  assert.equal(hover.boardPreviewLabelEl.textContent.includes("Confirm"), true);
  assert.equal(hover.boardPreviewLabelEl.textContent.includes("Click again to"), false);
});

test("board runtime can force click target selection even on hover-capable devices", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  const boardPreviewLabelEl = {
    textContent: "",
    innerHTML: "",
    addEventListener: noop,
    removeEventListener: noop,
  };
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece = snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: { selectedPieceId: clickedPiece.id, source: { ...clickedPiece.position }, target: null },
            nextActionType: currentActionType,
          };
        }
        const actionAtTarget = selectedPieceMoves.find((action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col);
        if (actionAtTarget) {
          return {
            selection: { ...selection, target: clickedCoord },
            nextActionType: actionAtTarget.type,
          };
        }
        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return { accepted: true, state: { sideToMove: "P2", turnIndex: 1, continuation: null, outcome: null, pieces: [] }, legalActions: [] };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 }, legal: true },
        ],
      }),
      endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Confirm"), true);

  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(appliedActions.length, 1);
});

test("board runtime keeps lone-target auto-selection while forced click target selection is active", async () => {
  let onCellClick = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece = snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
});

test("board runtime toggles overlay phase when the selected piece is clicked again", async () => {
  let onCellClick = null;
  const renderCalls = [];
  let boardPreviewLabelValue = "";
  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(value) {
      boardPreviewLabelValue = value;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(value) {
      boardPreviewLabelValue = value;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const multiMoves = [
    { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
  ];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ??
          null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: multiMoves,
        previewActions: multiMoves.map((a) => ({ ...a, legal: true })),
      }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });

  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    { legalActions: multiMoves },
  );

  onCellClick({ row: 4, col: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderCalls.at(-1)?.selectedPieceOverlayPhase, "actionPreviews");
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Select a move"), true);

  onCellClick({ row: 4, col: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderCalls.at(-1)?.selectedPieceOverlayPhase, "supplyCommand");
  assert.deepEqual(runtime.getSelection().target, null);
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Supply and command lines"), true);
});

test("board runtime can submit a legal target immediately after piece selection", async () => {
  let onCellClick = null;
  const appliedActions = [];
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }

        const actionAtTarget = selectedPieceMoves.find(
          (action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col,
        );
        if (actionAtTarget) {
          return {
            selection: {
              ...selection,
              target: clickedCoord,
            },
            nextActionType: actionAtTarget.type,
          };
        }

        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: () =>
        new Promise((resolve) => {
          releasePieceMoves = () => resolve({ state: null, actions: [], previewActions: [] });
        }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 4, col: 3 });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);

  releasePieceMoves?.();
});

test("board runtime uses hover selection before click submission on hover-capable devices", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let onCellHoverEnd = null;
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart, onCellHoverEnd: nextOnCellHoverEnd }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
        onCellHoverEnd = nextOnCellHoverEnd;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }

        const actionAtTarget = selectedPieceMoves.find(
          (action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col,
        );
        if (actionAtTarget) {
          return {
            selection: {
              ...selection,
              target: clickedCoord,
            },
            nextActionType: actionAtTarget.type,
          };
        }

        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 }, legal: true },
        ],
      }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 5, col: 2 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellHoverEnd({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("board runtime keeps auto-selected lone targets on hover-capable devices until clicked", async () => {
  let onCellClick = null;
  let onCellHoverEnd = null;
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverEnd: nextOnCellHoverEnd }) => {
        onCellClick = nextOnCellClick;
        onCellHoverEnd = nextOnCellHoverEnd;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: {
            sideToMove: "P2",
            turnIndex: 1,
            continuation: null,
            outcome: null,
            pieces: [],
          },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      endTurn: async (state) => ({
        accepted: true,
        state,
        legalActions: [],
        outcome: state?.outcome ?? null,
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellHoverEnd({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("board runtime promotes lone auto-selected targets to the correct action type across action kinds", async () => {
  const cases = [
    {
      type: "move",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    },
    {
      type: "project",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 0,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "commander", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "project", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    },
    {
      type: "rush",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 3,
        continuation: null,
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
      },
      action: { type: "rush", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 4 } },
    },
    {
      type: "push",
      trigger: "source-click",
      snapshot: {
        sideToMove: "P2",
        turnIndex: 12,
        continuation: null,
        outcome: null,
        pieces: [
          { id: "A1", owner: "P2", kind: "unit", position: { row: 6, col: 1 }, supplied: true, commanded: true },
          { id: "A2", owner: "P2", kind: "unit", position: { row: 5, col: 1 }, supplied: true, commanded: true },
          { id: "D1", owner: "P1", kind: "unit", position: { row: 6, col: 2 }, supplied: true, commanded: true },
        ],
      },
      action: { type: "push", actorId: "A1", from: { row: 6, col: 1 }, to: { row: 6, col: 2 } },
    },
    {
      type: "follow",
      trigger: "forced-selection",
      snapshot: {
        sideToMove: "P1",
        turnIndex: 7,
        continuation: { type: "push", phase: "follow", followGroupPieceIds: ["A1"] },
        outcome: null,
        pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
      },
      action: { type: "follow", actorId: "A1", from: { row: 5, col: 5 }, to: { row: 5, col: 4 } },
    },
    {
      type: "retreat",
      trigger: "forced-selection",
      snapshot: {
        sideToMove: "P2",
        turnIndex: 9,
        continuation: { type: "push", phase: "retreat", pushedPieceId: "A1" },
        outcome: null,
        pieces: [{ id: "A1", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
      },
      action: { type: "retreat", actorId: "A1", from: { row: 5, col: 5 }, to: { row: 6, col: 5 } },
    },
  ];

  for (const testCase of cases) {
    let onCellClick = null;
    const appliedActions = [];

    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: ({ onCellClick: nextOnCellClick }) => {
          onCellClick = nextOnCellClick;
        },
        render: noop,
        getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
          const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
          if (!selectedPiece) {
            return null;
          }
          return {
            details: { owner: selectedPiece.owner },
            actions: selectedPieceMovePreviews ?? selectedPieceMoves,
          };
        },
        getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
        getPieceAt: (snapshot, coord) =>
          snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
        nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
          const clickedPiece =
            snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ??
            null;
          if (!clickedPiece) {
            return {
              selection: {
                selectedPieceId: "A1",
                source: { ...testCase.action.from },
                target: null,
              },
              nextActionType: currentActionType,
            };
          }
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        },
      },
      host: {
        applyAction: async (_state, action) => {
          appliedActions.push(action);
          return {
            accepted: true,
            state: { sideToMove: "P1", turnIndex: 0, continuation: null, outcome: null, pieces: [] },
            legalActions: [],
          };
        },
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({
          state: null,
          actions: [testCase.action],
          previewActions: [{ ...testCase.action, legal: true }],
        }),
        endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
        canInteract: () => true,
      },
      controls: {
        getSupportsHover: () => true,
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });
    await runtime.loadSnapshot(testCase.snapshot, {
      legalActions: [testCase.action],
    });

    if (testCase.trigger === "source-click") {
      onCellClick(testCase.action.from);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(
      runtime.getSelection(),
      {
        selectedPieceId: "A1",
        source: { ...testCase.action.from },
        target: { ...testCase.action.to },
      },
      `expected ${testCase.type} target to auto-select`,
    );
    assert.equal(runtime.getActionType(), testCase.type, `expected ${testCase.type} action type to sync from the lone target`);

    onCellClick(testCase.action.to);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(appliedActions, [testCase.action], `expected ${testCase.type} confirmation to submit the synced action`);
  }
});

test("board runtime clears transient hover targets when hover support turns off", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let supportsHover = true;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => supportsHover,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 4, col: 3 },
        },
        {
          type: "move",
          actorId: "A1",
          from: { row: 4, col: 2 },
          to: { row: 5, col: 2 },
        },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  supportsHover = false;
  runtime.syncInteractionCapabilities();

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });
});

test("board runtime clears transient hover targets when click target selection becomes forced", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let forceClickTargetSelection = false;
  const appliedActions = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        const actionAtTarget = selectedPieceMoves.find(
          (action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col,
        );
        if (actionAtTarget) {
          return {
            selection: {
              ...selection,
              target: clickedCoord,
            },
            nextActionType: actionAtTarget.type,
          };
        }
        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async (_state, action) => {
        appliedActions.push(action);
        return {
          accepted: true,
          state: { sideToMove: "P2", turnIndex: 1, continuation: null, outcome: null, pieces: [] },
          legalActions: [],
        };
      },
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
        previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
      }),
      endTurn: async (state) => ({ accepted: true, state, legalActions: [], outcome: state?.outcome ?? null }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => forceClickTargetSelection,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  forceClickTargetSelection = true;
  assert.equal(runtime.syncInteractionCapabilities(), true);
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellHoverStart({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });

  onCellClick({ row: 4, col: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(appliedActions, [
    {
      type: "move",
      actorId: "A1",
      from: { row: 4, col: 2 },
      to: { row: 4, col: 3 },
    },
  ]);
});

test("board runtime restores hover target selection when click target selection stops being forced", async () => {
  let onCellClick = null;
  let onCellHoverStart = null;
  let forceClickTargetSelection = true;
  let boardPreviewLabelValue = "";

  const boardPreviewLabelEl = {
    get textContent() {
      return boardPreviewLabelValue;
    },
    set textContent(next) {
      boardPreviewLabelValue = next;
    },
    get innerHTML() {
      return boardPreviewLabelValue;
    },
    set innerHTML(next) {
      boardPreviewLabelValue = next;
    },
    addEventListener: noop,
    removeEventListener: noop,
  };

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick, onCellHoverStart: nextOnCellHoverStart }) => {
        onCellClick = nextOnCellClick;
        onCellHoverStart = nextOnCellHoverStart;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: selectedPieceMovePreviews ?? selectedPieceMoves,
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType, selection, selectedPieceMoves }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (clickedPiece) {
          return {
            selection: {
              selectedPieceId: clickedPiece.id,
              source: { ...clickedPiece.position },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        const actionAtTarget = selectedPieceMoves.find(
          (action) => action.to?.row === clickedCoord.row && action.to?.col === clickedCoord.col,
        );
        if (actionAtTarget) {
          return {
            selection: {
              ...selection,
              target: clickedCoord,
            },
            nextActionType: actionAtTarget.type,
          };
        }
        return { selection, nextActionType: currentActionType };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({
        state: null,
        actions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
        ],
        previewActions: [
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true },
          { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 }, legal: true },
        ],
      }),
      canInteract: () => true,
    },
    controls: {
      getSupportsHover: () => true,
      getForceClickTargetSelection: () => forceClickTargetSelection,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    {
      legalActions: [
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
        { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
      ],
    },
  );

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 4, col: 3 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 4, col: 3 },
  });
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Confirm"), true);

  forceClickTargetSelection = false;
  assert.equal(runtime.syncInteractionCapabilities(), true);
  assert.equal(String(boardPreviewLabelEl.innerHTML).includes("Confirm"), true);

  onCellHoverStart({ row: 5, col: 2 });
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: { row: 5, col: 2 },
  });
});

test("board runtime hydrates a source-only selection state and loads piece moves", async () => {
  const renderCalls = [];
  let pieceMoveLoads = 0;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: (payload) => renderCalls.push(payload),
      getSelectedPieceSummary: ({ snapshot, selectedPieceId, selectedPieceMoves, selectedPieceMovePreviews }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return { details: { owner: selectedPiece.owner }, actions: selectedPieceMovePreviews ?? selectedPieceMoves };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => {
        pieceMoveLoads += 1;
        return {
          state: null,
          actions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
          previewActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 }, legal: true }],
        };
      },
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 2,
      continuation: null,
      outcome: null,
      pieces: [{ id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }],
      selectionState: {
        selectedPieceId: "A1",
        source: { row: 4, col: 2 },
        target: null,
      },
    },
  );

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });
  assert.equal(pieceMoveLoads, 1);
  assert.equal(renderCalls.at(-1)?.selection?.selectedPieceId, "A1");
});

test("board runtime hydrates a source and target from a selection action", async () => {
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: () => null,
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P2",
      turnIndex: 3,
      continuation: null,
      outcome: null,
      pieces: [{ id: "B1", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true }],
    },
    {
      legalActions: [{ type: "move", actorId: "B1", from: { row: 5, col: 5 }, to: { row: 5, col: 6 } }],
      selectionAction: { type: "move", actorId: "B1", from: { row: 5, col: 5 }, to: { row: 5, col: 6 } },
    },
  );

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "B1",
    source: { row: 5, col: 5 },
    target: { row: 5, col: 6 },
  });
});

test("board runtime keeps selection while piece moves are still loading", async () => {
  let onCellClick = null;
  let releasePieceMoves = null;

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick: nextOnCellClick }) => {
        onCellClick = nextOnCellClick;
      },
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: [],
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: ({ snapshot, clickedCoord, currentActionType }) => {
        const clickedPiece =
          snapshot?.pieces?.find((piece) => piece.position.row === clickedCoord.row && piece.position.col === clickedCoord.col) ?? null;
        if (!clickedPiece) {
          return {
            selection: {
              selectedPieceId: "A1",
              source: { row: 4, col: 2 },
              target: null,
            },
            nextActionType: currentActionType,
          };
        }
        return {
          selection: {
            selectedPieceId: clickedPiece.id,
            source: { ...clickedPiece.position },
            target: null,
          },
          nextActionType: currentActionType,
        };
      },
    },
    host: {
      applyAction: async () => ({ accepted: false }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: () =>
        new Promise((resolve) => {
          releasePieceMoves = () => resolve({ state: null, actions: [], previewActions: [] });
        }),
      canInteract: () => true,
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [
        {
          id: "A1",
          owner: "P1",
          kind: "unit",
          position: { row: 4, col: 2 },
          supplied: true,
          commanded: true,
        },
      ],
    },
    { legalActions: [] },
  );

  onCellClick({ row: 4, col: 2 });
  onCellClick({ row: 0, col: 0 });

  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: "A1",
    source: { row: 4, col: 2 },
    target: null,
  });

  releasePieceMoves?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("board runtime emits turn-ended when applyAction returns a settled next-turn state", async () => {
  const actionResults = [];
  const boardMessages = [];

  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: noop,
      render: noop,
      getSelectedPieceSummary: ({ snapshot, selectedPieceId }) => {
        const selectedPiece = snapshot?.pieces?.find((piece) => piece.id === selectedPieceId) ?? null;
        if (!selectedPiece) {
          return null;
        }
        return {
          details: { owner: selectedPiece.owner },
          actions: [],
        };
      },
      getPieceById: (snapshot, pieceId) => snapshot?.pieces?.find((piece) => piece.id === pieceId) ?? null,
      getPieceAt: (snapshot, coord) =>
        snapshot?.pieces?.find((piece) => piece.position.row === coord.row && piece.position.col === coord.col) ?? null,
      nextSelectionForCell: () => ({
        selection: { selectedPieceId: null, source: null, target: null },
        nextActionType: "pass",
      }),
    },
    host: {
      applyAction: async () => ({
        accepted: true,
        state: {
          sideToMove: "P2",
          turnIndex: 1,
          continuation: null,
          outcome: null,
          pieces: [],
        },
        legalActions: [{ type: "move" }],
      }),
      loadInitialState: async () => ({ state: null, legalActions: [] }),
      loadLegalActions: async () => ({ state: null, legalActions: [] }),
      loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      canInteract: () => true,
    },
    controls: {
      onActionResult: (value) => actionResults.push(value),
      onBoardMessage: (value) => boardMessages.push(value),
    },
  });

  runtime.bindElements({
    boardEl: {},
    overlayLinesEl: {},
    boardPreviewLabelEl: null,
    boardTurnIndicatorEl: null,
  });
  await runtime.loadSnapshot(
    {
      sideToMove: "P1",
      turnIndex: 0,
      continuation: null,
      outcome: null,
      pieces: [],
    },
    { legalActions: [{ type: "project", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } }] },
  );

  await runtime.submitCurrentAction({
    type: "project",
    actorId: "A1",
    from: { row: 4, col: 2 },
    to: { row: 4, col: 3 },
  });

  assert.equal(boardMessages.some((message) => message?.type === "turn_ended"), true);
  assert.deepEqual(runtime.getSelection(), {
    selectedPieceId: null,
    source: null,
    target: null,
  });
  assert.deepEqual(actionResults.at(-1), {
    accepted: true,
    outcome: null,
  });
});

// ---------------------------------------------------------------------------
// U-10 — history destroyed pieces animate via transient removal effects before settling into overlay state
// ---------------------------------------------------------------------------
test("U-10: loadSnapshot starts a history destruction transition before exposing the settled overlay", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};
  Date.now = () => 5000;

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
        getPieceById: () => null,
        getPieceAt: () => null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    const snapshot = {
      sideToMove: "P1",
      turnIndex: 1,
      continuation: null,
      outcome: null,
      pieces: [{ id: "X1", owner: "P1", kind: "unit", position: { row: 3, col: 4 }, supplied: true, commanded: true }],
    };

    await runtime.loadSnapshot(snapshot, { legalActions: [] });

    const stateBefore = runtime.getState();
    const keysBefore = Object.keys(stateBefore).sort();

    await runtime.loadSnapshot(snapshot, {
      legalActions: [],
      overlayMode: "recorded-action",
      destroyedPieces: [{
        row: 3,
        col: 4,
        ownerSeat: "p1",
        kind: "unit",
        supplied: true,
        commanded: true,
        piece: {
          id: "X1",
          owner: "P1",
          kind: "unit",
          position: { row: 3, col: 4 },
          supplied: true,
          commanded: true,
        },
      }],
    });

    const stateAfter = runtime.getState();
    assert.deepEqual(
      Object.keys(stateAfter).sort(),
      keysBefore,
      "getState() must not gain extra fields from history destroyed-piece overlays",
    );
    assert.equal(stateAfter.sideToMove, "P1");
    assert.equal(stateAfter.turnIndex, 1);
    assert.deepEqual(stateAfter.pieces, stateBefore.pieces);
    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
    const animatedRender = renderCalls.find((payload) => Array.isArray(payload.removalEffects) && payload.removalEffects.length === 1);
    assert.ok(animatedRender);
    assert.equal(animatedRender.removalEffects[0].piece?.id, "X1");
    assert.equal(animatedRender.removalEffects[0].startedAt, 5000);
    assert.equal(animatedRender.overlay?.destroyedPieces?.length ?? 0, 0);
    assert.equal(scheduledTimers.length, 1);
    assert.equal(scheduledTimers[0].delay, 2400);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

// ---------------------------------------------------------------------------
// U-11 — the history destruction transition settles into overlay state and clears on a later load
// ---------------------------------------------------------------------------
test("U-11: history destruction transition settles into overlay state and clears on the next load", async () => {
  const renderCalls = [];
  const scheduledTimers = [];
  const originalNow = Date.now;
  let now = 5000;
  Date.now = () => now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (fn, delay) => {
    const handle = { fn, delay };
    scheduledTimers.push(handle);
    return handle;
  };
  globalThis.clearTimeout = () => {};

  try {
    const runtime = createBoardRuntime({
      boardAdapter: {
        mount: noop,
        render: (payload) => renderCalls.push(payload),
        getSelectedPieceSummary: () => null,
        getPieceById: () => null,
        getPieceAt: () => null,
        nextSelectionForCell: () => ({
          selection: { selectedPieceId: null, source: null, target: null },
          nextActionType: "pass",
        }),
      },
      host: {
        applyAction: async () => ({ accepted: false }),
        loadInitialState: async () => ({ state: null, legalActions: [] }),
        loadLegalActions: async () => ({ state: null, legalActions: [] }),
        loadPieceMoves: async () => ({ state: null, actions: [], previewActions: [] }),
      },
    });

    runtime.bindElements({
      boardEl: {},
      overlayLinesEl: {},
      boardPreviewLabelEl: null,
      boardTurnIndicatorEl: null,
    });

    const destroyedRecord = {
      row: 4,
      col: 7,
      ownerSeat: "p2",
      kind: "commander",
      piece: {
        id: "C2",
        owner: "P2",
        kind: "commander",
        position: { row: 4, col: 7 },
        supplied: true,
        commanded: true,
      },
    };

    await runtime.loadSnapshot(
      { sideToMove: "P2", turnIndex: 2, continuation: null, outcome: null, pieces: [] },
      { legalActions: [], overlayMode: "recorded-action", destroyedPieces: [destroyedRecord] },
    );

    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
    assert.equal(scheduledTimers.length, 1);
    now += scheduledTimers[0].delay;
    scheduledTimers[0].fn();

    assert.deepEqual(runtime.getOverlay().destroyedPieces, [destroyedRecord]);
    const settledRender = renderCalls.at(-1);
    assert.deepEqual(settledRender?.overlay?.destroyedPieces, [destroyedRecord]);
    assert.deepEqual(settledRender?.removalEffects, []);

    await runtime.loadSnapshot(
      { sideToMove: "P1", turnIndex: 3, continuation: null, outcome: null, pieces: [] },
      { legalActions: [], overlayMode: "recorded-action", destroyedPieces: [] },
    );

    assert.deepEqual(runtime.getOverlay().destroyedPieces, []);
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("board runtime refreshes a preserved branch selection from the new legal actions", async () => {
  const action = { type: "move", actorId: "A1", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } };
  const snapshot = {
    sideToMove: "P1", turnIndex: 0, continuation: null, outcome: null,
    pieces: [{ id: "A1", owner: "P1", kind: "unit", position: action.from, supplied: true, commanded: true }],
  };
  let click;
  const submitted = [];
  let releaseOldMoves;
  let holdPieceMoves = false;
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: ({ onCellClick }) => { click = onCellClick; },
      render: noop,
      getSelectedPieceSummary: ({ snapshot: current, selectedPieceId, selectedPieceMovePreviews }) => {
        const piece = current.pieces.find(value => value.id === selectedPieceId);
        return piece ? { details: { owner: piece.owner }, actions: selectedPieceMovePreviews } : null;
      },
      getPieceById: (state, id) => state.pieces.find(piece => piece.id === id),
      getPieceAt: (state, coord) => state.pieces.find(piece => piece.position.row === coord.row && piece.position.col === coord.col),
      nextSelectionForCell: () => ({ selection: { selectedPieceId: null, source: null, target: null }, nextActionType: "pass" }),
    },
    host: {
      applyAction: async (_state, value) => { submitted.push(value); return { accepted: false }; },
      loadInitialState: async () => ({ state: snapshot, legalActions: [action] }),
      loadLegalActions: async () => ({ state: snapshot, legalActions: [action] }),
      loadPieceMoves: async () => holdPieceMoves
        ? new Promise(resolve => { releaseOldMoves = resolve; })
        : { state: snapshot, actions: [action], previewActions: [action] },
      canInteract: () => true,
    },
  });
  runtime.bindElements({ boardEl: {}, overlayLinesEl: {}, boardPreviewLabelEl: null, boardTurnIndicatorEl: null });
  await runtime.loadSnapshot(snapshot, { legalActions: [action], selectionAction: action });
  await runtime.loadSnapshot(snapshot, { legalActions: [action], resetSelection: false });
  click(action.to);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(submitted, [action], "the hydrated target remains actionable after the authoritative snapshot replaces the branch stub");

  await runtime.loadSnapshot(snapshot, { legalActions: [action], selectionAction: action });
  await runtime.loadSnapshot(snapshot, { legalActions: [], resetSelection: false });
  click(action.to);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submitted.length, 1, "a preserved visual target must not retain an action removed by the new snapshot");

  await runtime.loadSnapshot(snapshot, { legalActions: [action], selectionAction: action });
  holdPieceMoves = true;
  const pendingSelection = runtime.setSelectionFromAction(action);
  await runtime.loadSnapshot(snapshot, { legalActions: [], resetSelection: false });
  releaseOldMoves({ state: snapshot, actions: [action], previewActions: [action] });
  await pendingSelection;
  click(action.to);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submitted.length, 1, "late moves from the previous snapshot cannot revive a removed action");
});

test('a transient control fence preserves a prepared legal destination without deferred submission',async()=>{
 const action={type:'move',actorId:'A',from:{row:4,col:2},to:{row:4,col:3}};
 const state={sideToMove:'P1',turnIndex:0,continuation:null,outcome:null,pieces:[{id:'A',owner:'P1',kind:'unit',position:action.from,supplied:true,commanded:true}]};
 let click,interactive=true;const applied=[];
 const runtime=createBoardRuntime({boardAdapter:{
  mount:({onCellClick})=>{click=onCellClick;},render:noop,
  getPieceAt:(snapshot,at)=>snapshot.pieces.find(piece=>piece.position.row===at.row&&piece.position.col===at.col),
  getPieceById:(snapshot,id)=>snapshot.pieces.find(piece=>piece.id===id),
  getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null,
 },host:{canSelect:()=>true,canInteract:()=>interactive,applyAction:async(_state,value)=>{applied.push(value);return {accepted:false};}}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:null});
 await runtime.loadSnapshot(state,{legalActions:[action],selectionAction:action});
 const prepared=structuredClone(runtime.getSelection());
 interactive=false;runtime.refreshStatus();click(action.to);
 assert.deepEqual(runtime.getSelection(),prepared,'a known destination click during the fence must not become a blank-square deselection');
 assert.deepEqual(applied,[]);assert.deepEqual(runtime.getState(),state);
 interactive=true;runtime.refreshStatus();await Promise.resolve();
 assert.deepEqual(applied,[],'settlement must never queue or replay the blocked click');
 assert.deepEqual(runtime.getSelection(),prepared);
 click(action.to);await Promise.resolve();
 assert.deepEqual(applied,[action],'only a fresh explicit confirmation submits the exact prepared action');
 destroyUninitializedNodeRuntime(runtime);
});

test('status refresh redraws admission changes without losing the selected move',async()=>{
 const action={type:'move',actorId:'A',from:{row:4,col:2},to:{row:4,col:3}};
 const state={sideToMove:'P1',turnIndex:0,pieces:[{id:'A',owner:'P1',kind:'unit',position:action.from,supplied:true,commanded:true}]};
 let interactive=true;const renders=[];
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:value=>renders.push(value),getPieceById:(snapshot,id)=>snapshot.pieces.find(piece=>piece.id===id),getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null},host:{canSelect:()=>true,canInteract:()=>interactive}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:null});
 await runtime.loadSnapshot(state,{legalActions:[action],selectionAction:action});
 const prepared=structuredClone(runtime.getSelection());
 const beforeFence=renders.length;
 interactive=false;runtime.refreshStatus();
 assert.equal(renders.length,beforeFence,'a brief status-only fence must not replace action previews with inspection lines');
 assert.deepEqual(renders.at(-1).selectedPieceMoves,[action]);
 interactive=true;runtime.refreshStatus();
 assert.equal(renders.length,beforeFence,'an unpainted fence must not cause a settlement redraw');
 interactive=false;runtime.refreshVisuals();runtime.refreshStatus();
 assert.deepEqual(renders.at(-1).selectedPieceMoves,[action]);
 interactive=true;runtime.refreshStatus();
 assert.deepEqual(renders.at(-1).selectedPieceMoves,[action],'status-only settlement must repaint actual actionable moves');
 assert.deepEqual(runtime.getSelection(),prepared);
 const count=renders.length;runtime.refreshStatus();
 assert.equal(renders.length,count,'unchanged admission must not cause an unconditional board redraw');
 destroyUninitializedNodeRuntime(runtime);
});

test('read-only selected pieces remain informational during rush, follow and retreat',async()=>{
 for(const continuation of [{type:'rush',rushedPieceIds:['A'],rushChainPieceIds:['A']},{type:'push',phase:'follow',attackerId:'A'},{type:'push',phase:'retreat',pushedPieceId:'A'}]){
  let html='';const label={addEventListener:noop,removeEventListener:noop,get innerHTML(){return html},set innerHTML(value){html=value},get textContent(){return html},set textContent(value){html=value}};
  const state={sideToMove:'P1',turnIndex:0,continuation,pieces:[{id:'A',owner:'P1',kind:'unit',position:{row:4,col:2},supplied:true,commanded:true}]};
  const adapter={mount:noop,render:noop,getSelectedPieceSummary:({selectedPieceId})=>selectedPieceId?{details:{owner:'P1'}}:null,getPieceById:(snapshot,id)=>snapshot.pieces.find(piece=>piece.id===id)};
  const runtime=createBoardRuntime({boardAdapter:adapter,host:{canInteract:()=>false,canPresentActions:()=>false,loadPieceMoves:async()=>({actions:[],previewActions:[]})}});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
  await runtime.loadSnapshot(state,{legalActions:[{type:'end_turn'}],selectionState:{selectedPieceId:'A',source:{row:4,col:2},target:null}});
  assert.match(html,/Supply and command lines for piece at/);assert.match(html,/4/);assert.match(html,/2/);assert.doesNotMatch(html,/data-board-preview-action|Select a rush|End turn|Retreat|Follow/);
  runtime.setInspection({kind:'command',pieceId:'A'});assert.match(html,/Supply and command lines/);assert.doesNotMatch(html,/data-board-preview-action/);
 }
});

test('message and ordinary Pass share one guarded admission with stale-state and inspection fences',async()=>{
 let click,canInteract=true,release;const applied=[],external=[];
 const label={innerHTML:'',textContent:'',addEventListener:(kind,callback)=>{if(kind==='click')click=callback},removeEventListener:noop};
 const state={sideToMove:'P1',turnIndex:0,continuation:null,pieces:[]};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>canInteract,applyAction:async(_state,action)=>{applied.push(action);return new Promise(resolve=>{release=()=>resolve({accepted:true,state:{...state,turnIndex:1},legalActions:[]})})}},controls:{onBoardMessageAction:id=>external.push(id)}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});await runtime.loadSnapshot(state,{legalActions:[{type:'pass'}]});
 const fire=(message=true)=>click({target:{closest:selector=>selector===(message?'[data-board-message-action]':'[data-board-preview-action]')?{getAttribute:()=> 'pass'}:null}});
 runtime.setInteractionBlocked(true);fire();assert.equal(applied.length,0);runtime.setInteractionBlocked(false);
 canInteract=false;fire();assert.equal(applied.length,0);canInteract=true;
 runtime.setInspection({kind:'supply',owner:'P1'});fire();assert.equal(applied.length,0);runtime.clearInspection();
 await runtime.loadSnapshot({...state,continuation:{type:'rush'}},{legalActions:[{type:'pass'}]});fire();assert.equal(applied.length,0);
 await runtime.loadSnapshot(state,{legalActions:[]});fire();assert.equal(applied.length,0);
 await runtime.loadSnapshot(state,{legalActions:[{type:'pass'}]});fire();fire(false);assert.deepEqual(applied,[{type:'pass'}]);assert.deepEqual(external,[]);
 release();await new Promise(resolve=>setTimeout(resolve,0));fire();assert.equal(applied.length,1);
});

test('complete asynchronous blocked-only previews initialize the action layer',async()=>{
 let complete, phase;
 const pending=new Promise(resolve=>complete=resolve);
 const piece={id:'A',owner:'P1',kind:'unit',position:{row:4,col:4},supplied:true,commanded:true};
 const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece]};
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:view=>phase=view.selectedPieceOverlayPhase,getPieceById:(state,id)=>state.pieces.find(p=>p.id===id),getSelectedPieceSummary:()=>null},
   host:{asyncPieceMoves:true,canInteract:()=>true,loadPieceMoves:()=>pending}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null});
 const loading=runtime.loadSnapshot(state,{legalActions:[],selectionState:{selectedPieceId:'A',source:piece.position,target:null}});
 const blocked={type:'rush',actorId:'A',from:piece.position,to:{row:4,col:5},legal:false,blockedReason:'SUPPLY_DESTINATION_UNSUPPLIED'};
 complete({state,actions:[],previewActions:[blocked]});await loading;
 assert.equal(phase,'actionPreviews');
 destroyUninitializedNodeRuntime(runtime);
});

test('production bind path suspends new preview requests until pageshow',async()=>{
 const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
 const windowListeners=new Map();let queries=0;
 try{
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false,addEventListener:noop,removeEventListener:noop}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener:(name,fn)=>windowListeners.set(name,fn),removeEventListener:noop}});
  const piece={id:'A',owner:'P1',kind:'unit',position:{row:4,col:4},supplied:true,commanded:true};
  const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece]};
  const options={legalActions:[],selectionState:{selectedPieceId:'A',source:piece.position,target:null}};
  const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:noop,getPieceById:(s,id)=>s.pieces.find(p=>p.id===id),getSelectedPieceSummary:()=>null},
   host:{asyncPieceMoves:true,canInteract:()=>true,loadPieceMoves:async()=>{queries++;return {state,actions:[],previewActions:[]};}}});
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null});await runtime.loadSnapshot(state,options);
  const before=queries;assert.ok(before>0);
  windowListeners.get('pagehide')();
  await runtime.loadSnapshot(state,options);await runtime.reloadSelectedPieceMoves();assert.equal(queries,before);
  windowListeners.get('pageshow')();await Promise.resolve();await Promise.resolve();assert.ok(queries>before);
  runtime.destroy();
 }finally{
  if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete globalThis.document;
  if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else delete globalThis.window;
 }
});

test('whole-turn overlays reach the adapter without selected-cell state',async()=>{
 const rendered=[];
 const runtime=createBoardRuntime({boardAdapter:{mount:noop,render:input=>rendered.push(input),getSelectedPieceSummary:()=>null},host:{canInteract:()=>false}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null});
 const actions=[{recordedAction:{type:'move',from:{row:1,col:1},to:{row:1,col:2}},recordedActionStartPiece:{id:'A',owner:'P1'}}];
 await runtime.loadSnapshot({pieces:[],sideToMove:'P1',turnIndex:1},{legalActions:[],overlayMode:'recorded-turn',recordedActions:actions});
 assert.equal(rendered.at(-1).overlay.mode,'recorded-turn');
 assert.deepEqual(rendered.at(-1).overlay.recordedActions,actions);
 assert.equal(rendered.at(-1).overlay.selection,null);
});
