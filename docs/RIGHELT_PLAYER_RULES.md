# Righelt: Player Rules Guide

Righelt is a two-player abstract strategy game about structure, pressure, and supply lines.

Your goal is simple:

- **Win by cutting your opponent Commander off from their supply point.**

If both Commanders are cut off at the same time, the game is a draw.

## 1. Board and Setup

- The board is a 10x10 grid.
- Each player has:
  - 1 **Commander**
  - 1 **Supply Point** (fixed home point)
- At the start, only the two Commanders are on the board.
- Players alternate turns.

## 2. Core Idea: Active vs Inactive Pieces

A piece can act only when it has both:

- **Supply**: it has a route back to its own supply point.
- **Command**: it is connected into its side’s command network from the Commander.

If either is missing, the piece is inactive.

Important:

- The **Commander is not automatically supplied**.
- The Commander must also have a valid supply route.
- If a Commander loses supply, that can end the game immediately.

## 3. What You Can Do On Your Turn

On your turn, you normally do one of the following:

- **Pass**
- **Move** (Commander only)
- **Project** (create a new unit)
- **Rush**
- **Push**

Some actions (especially Push and Rush) can create short continuation sequences before turn control fully passes.

During those continuation sequences, a piece that started the sequence able to act can still finish that sequence even if the board position has already cut its live supply or command.
The interface may show that piece as it would look if the sequence stopped immediately, but it remains usable for the continuation while that sequence is still open.
That freeze does not let any piece move into a square where it would be unsupplied.

## 4. Actions

## 4.1 Pass

Do nothing and end your turn.

## 4.2 Move (Commander only)

- Move your Commander one square orthogonally (up/down/left/right) to an empty square.
- The destination must still leave your Commander supplied.

## 4.3 Project (create a unit)

- Choose one of your active pieces.
- Place a new unit exactly two squares away in a straight orthogonal line.
- The middle square and destination must both be empty.
- The destination must be a square where that new unit is supplied.
- The source piece stays where it is.

This is how your board presence grows.

## 4.4 Rush

A tactical one-step move (including diagonals) that is only legal under the following conditions:

- Destination must be empty.
- Destination must still leave the rushing piece supplied.
- Orthogonal rushes require enemy contact near the destination.
- Diagonal rushes require enemy contact in the relevant corner-adjacent lanes.
- In a rush sequence, each individual piece can rush at most once.
- After your first rush, extra rushes are optional: you may pass to end the rush sequence and end your turn.
- During the rush sequence, the game still remembers which of your pieces were allowed to keep acting from the start of the sequence, even if the board display now shows a broken supply/command line.

Use Rush for tempo and local repositioning around conflict.

Important legality note:
- You cannot choose a destination that would make the moved/created piece unsupplied.
- That remains true inside continuation sequences as well: frozen command/supply only preserves who may keep acting, not permission to end a move on an unsupplied square.
- It is allowed to make a move that later leaves a piece uncommanded after resolution.

## 4.5 Push

Push lets you displace an enemy piece, but only if your local formation is stronger.

- The enemy piece you push must be directly orthogonally adjacent to the pushing piece.
- You can push only if your local **group strength** is greater than the defender’s.
- If legal, your piece advances into the enemy piece’s square and the enemy piece is temporarily stacked there as a pushed piece.
- The pushed square must still leave the pushing piece supplied.
- The pushed piece’s owner must then resolve a forced retreat.
- After that retreat, the pushing player completes any required **follow** moves through the vacated trail.
- During that push continuation, the display can show that some of the attacker's pieces would now be inactive if play stopped immediately, but pieces that were still entitled to continue from the start of the push remain usable until the push sequence finishes.

### What is group strength?

Group strength is the number of your own pieces in the connected local formation around the piece doing the push.

- Count all friendly pieces connected by orthogonal (up/down/left/right) adjacency at distance 1.
- Diagonal contact does not connect groups for push strength.
- Do the same count for the defending piece’s formation.
- A push is legal only when the attacker’s count is strictly higher than the defender’s.

So if your attacking formation has strength 4 and the defender’s has strength 3, you may push.  
If strengths are equal, or the defender is stronger, you cannot push.

### Retreat rule

A pushed piece must retreat to an adjacent orthogonal empty square.

- After a push, play temporarily passes to the owner of the pushed piece.
- During that brief retreat step, retreat is the only action they may take.
- They may still inspect other pieces, but no other actions are legal.
- The vacated follow trail square is reserved for the follow sequence and is not a legal retreat destination.
- The retreat destination must still leave the retreating piece supplied.
- If there is only one retreat square, that retreat is effectively forced.
- If there is no legal retreat square, the pushed piece is destroyed immediately.
- If the pushed piece is destroyed because there is no retreat square, play does not pause for a retreat step and stays with the pushing player for follow completion.

### Follow rule

After retreat finishes, play immediately returns to the pushing player.

- Friendly pieces may need to **follow** into the vacated chain to keep the pushing structure connected.
- A follow move is only legal if that destination still leaves the following piece supplied.
- If only one piece can make the next required follow, that piece is effectively forced.
- If that forced piece has only one follow square, that move is effectively forced.
- When no more follow moves are possible, the push sequence ends.
- If that means only `Pass` would remain, the turn ends automatically and normal play continues with the other player.

## 5. Networks: Supply and Command

Righelt is fundamentally a network game.

## 5.1 Supply network

Every piece (including Commander) needs a route back to its own supply point.

Supply routes use orthogonal travel through empty or friendly-occupied squares.

Supply routes are blocked by:
- enemy pieces
- enemy command lines crossing board cells between their linked pieces

If a non-Commander has no supply route after resolution, it is removed from the board.
If a Commander has no supply route after resolution, the game ends immediately (win/loss/draw as applicable).

## 5.2 Command network

Your Commander controls pieces through friendly links.

- Friendly alignments create command links.
- Opposing link structures can cut each other where they cross.
- If a piece is cut out of command, it cannot act.

## 6. Winning the Game

You win when, after all effects of a move settle, your opponent’s Commander has no supply route.

- Opponent Commander unsupplied, yours supplied -> you win.
- Both Commanders unsupplied at the same time -> draw.

## 7. Strategic Tips

- Protect your Commander’s supply first, then attack theirs.
- Build layered networks; single-route structures are fragile.
- Push is strongest when prepared by formation, not played alone.
- Cutting one key link can collapse both command and supply efficiency.
- Sometimes passing is correct to avoid overextending your own network.
