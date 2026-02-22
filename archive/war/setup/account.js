$(document).ready(function() {
	leaveClosedGame();
	leaveOpenGame();
});

function leaveClosedGame() {
	$('.play-account-game-closed .play-account-game-leave').click(function() {
		var player = $(this).data('player');
		$.post('/leave', {
			player: player,
		});
		console.log('leave: ' + player);
		$('#play-account-game-' + player).remove();
	});
}

function leaveOpenGame() {
	element = $('.play-account-game-open .play-account-game-leave');
	var player = element.data('player');
	$('<a>').attr({
		'class': 'play-account-game-leave',
		'href': '/leave?open=true&player=' + player,
	}).appendTo('#play-account-game-' + player).append(element);
}