// Invitation intent changes presentation only. Existing server tokens own permissions.
export const invitationOptions = (game) => {
  const seat = !game?.player1 ? 'red' : !game?.player2 ? 'blue' : null;
  const options = [];
  if (seat) options.push({ role: seat, label: `Invite someone to play as ${seat}`, token: game.inviteToken || game.id });
  options.push({role:'viewer', label:'Invite someone to view', token:game?.inviteTokens?.viewer || game?.id});
  return options;
};

// The host sharing links and the arriving guest use the same top-of-game surface.
// Callers provide trusted, escaped markup. Only the board region is inert.
export const renderInvitationSurface = ({content, background, host=false}) => `
  <section class="invite-gate" ${host?'data-host-invite':''}>
    <section class="panel invite-gate-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="invite-surface-title">
      ${content}
    </section>
    <div class="invite-gate-content" inert aria-hidden="true" ${host?'data-testid="game-shell"':''}>${background}</div>
  </section>`;
