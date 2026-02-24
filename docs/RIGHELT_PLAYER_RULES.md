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

## 4. Actions

## 4.1 Pass

Do nothing and end your turn.

## 4.2 Move (Commander only)

- Move your Commander one square orthogonally (up/down/left/right) to an empty square.

## 4.3 Project (create a unit)

- Choose one of your active pieces.
- Place a new unit exactly two squares away in a straight orthogonal line.
- The middle square and destination must both be empty.
- The source piece stays where it is.

This is how your board presence grows.

## 4.4 Rush

A tactical one-step move (including diagonals) that is only legal under the following conditions:

- Destination must be empty.
- Orthogonal rushes require enemy contact near the destination.
- Diagonal rushes require enemy contact in the relevant corner-adjacent lanes.
- In a rush sequence, each individual piece can rush at most once.
- After your first rush, extra rushes are optional: you may pass to end the rush sequence and end your turn.

Use Rush for tempo and local repositioning around conflict.

## 4.5 Push

Push lets you displace an enemy piece, but only if your local formation is stronger.

- You can push only if your local **group strength** is greater than the defender’s.
- If legal, your piece advances into the enemy piece’s square and the enemy piece is forced to retreat.
- Friendly pieces may then **follow** into the vacated trail during the push sequence.

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

- If there is no legal retreat square, that piece is removed.

## 5. Networks: Supply and Command

Righelt is fundamentally a network game.

## 5.1 Supply network

Every piece (including Commander) needs a route back to its own supply point.

If routes collapse, pieces can become inactive and vulnerable.

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
