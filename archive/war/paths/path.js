function Path(source, path) {
	this.board = source.board;
	this.player = source.player;
	this.player.addPath(this);
	// Record the source and path.
	this.source = source;
	this.path = {
			unscaled: path,
			scaled: this.board.scalePath(path),
	};
	// Draw the path.
	this.draw();
	this.display();
}

/// ACTIONS: Remove

Path.prototype.remove = function() {
	this.shape.remove();
}

/// DRAWING

Path.prototype.attr = function() {
	return {
		stroke: this.player.colors.regular,
		'stroke-dasharray': '5 5',
		fill: 'transparent',
	};
}

Path.prototype.draw = function() {
	this.shape = this.board.canvas
	.polyline(this.path.scaled)
	.attr(this.attr())
	.back();
	this.board.shape.back();
}

Path.prototype.display = function() {
	if (this.board.players.local.display.supply == 'all') {
		this.show();
	} else {
		this.hide();
	}
}

Path.prototype.show = function() {
	this.shape.show();
}

Path.prototype.hide = function() {
	this.shape.hide();
}