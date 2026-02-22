function Commander(board, player, point) {
	Piece.call(this, board, player, point);
	player.pieces.commander = this;
}

Commander.prototype = Object.create(Piece.prototype);
Commander.prototype.constructor = Commander;

/// ACTIONS: Move

Commander.prototype.canMove = function(point) {
	if (typeof(point) === 'undefined') {
		var moveable = true;
	} else {
		var moveable = ($.inArray(point, this.moves.moveables) != -1);
	} return moveable && !this.player.battling() && !this.player.shifting() && !this.pushed && this.supplied && this.commanded;
}

Commander.prototype.findMoveables = function() {
	if (!this.canMove()) return;
	this.moves.moveables = this.point.getAdjacents().filter(function(adjacent) {
		return adjacent.piece == null;
	});
	this.moves.moveables.forEach(function(moveable) {
		this.addHint(new MoveHint(this, moveable));
	}, this);
}

/// ACTIONS: Remove

Commander.prototype.remove = function() {
	// Cannot remove commander.
}

Commander.prototype.forceRemove = function() {
	// Cannot remove commander.
}

/// SUPPLY and COMMAND

Commander.prototype.findSupply = function() {
	Piece.prototype.findSupply.call(this);
	return true;
}

/// DRAWING

Commander.prototype.cssClass = function(options) {
	var cssClass = Piece.prototype.cssClass.call(this, options);
	return cssClass + ' piece-commander';
}

Commander.prototype.placeUsing = function(options) {
	return {
		x: options.point.attr().cx - (this.size.width / 2) + options.offset,
		y: options.point.attr().cy - (this.size.width / 2) + options.offset,
	};
}

Commander.prototype.startDraw = function() {
	return this.board.canvas.rect(this.size.width, this.size.width);
}