// Invitation intent changes presentation only. Existing server tokens own permissions.
export const invitationOptions = (game) => {
  const seat = !game?.player1 ? 'red' : !game?.player2 ? 'blue' : null;
  const options = [];
  if (seat) options.push({ role: seat, label: `Invite someone to play as ${seat}`, token: game.inviteToken || game.id });
  options.push({role:'viewer', label:'Invite someone to view', token:game?.inviteTokens?.viewer || game?.id});
  return options;
};
