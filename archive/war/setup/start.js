$(document).ready(function() {
	// Create the drawing canvas, board, and channel.
	var canvas = SVG('play-canvas').size(400, 400);
	var board = new Board(canvas);
	var channel = new Channel(board);
	// Create the players.
	var p1 = new Player(board, "green", board.points[0][9]);
	var p2 = new Player(board, "purple", board.points[9][0]);
	p1.select();
	board.setLocal();
	// Create the commanders.
	Start.createCommander(board, p1, 3, 6);
	Start.createCommander(board, p2, 6, 3);
	// Initialize the supply and command chains.
	board.resetSupplyCommand();
	// Initialize the channel.
	channel.init();
});

Start = {};

Start.createCommander = function(board, player, row, col) {
	new Commander(board, player, board.points[row][col]);
}
