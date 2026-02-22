function Projection(source, target) {
	Piece.call(this, source.board, source.player, target, {
		permanent: false,
	});
	this.source = source;
}

Projection.prototype = Object.create(Piece.prototype);
Projection.prototype.constructor = Projection;

/// ACTIONS: Select

Projection.prototype.select = function(options) {
	// Send the project to the server.
	var settings = $.extend({
		send: true,
	}, options);
	if (settings.send) {
		this.board.channel.piecesSend('project', this.source, this.point);
	}
	// Create a new piece.
	new Piece(this.board, this.player, this.point);
	this.source.deselect();
	this.board.resetSupplyCommand();
	this.board.clearBattle();
	this.player.advance();
}

/// ACTIONS: Focus

Projection.prototype.focus = function() {
	$('#play-messages-point').text(this.toString());
}

Projection.prototype.blur = function() {
	$('#play-messages-point').text('');	
}

/// DRAWING

Projection.prototype.cssClass = function() {
	return 'piece piece-projection';
}

/// STRINGS

Projection.prototype.toString = function() {
	return 'project ' + this.source.point + ' ' + this.point;
}