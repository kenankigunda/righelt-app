function Point(board, position) {
	// Set the relations.
	this.board = board;
	this.piece = null;
	this.pushed = null;
	// Set the unscaled position.
	this.position = $.extend({
		row: 0,
		col: 0,
	}, position);
	// Set the scaled position.
	$.extend(this.position, {
		x: this.board.scale(this.position.col),
		y: this.board.scale(this.position.row),
	});
	// Set the size.
	this.size = {
			width: 3,
			mask: {
				width: 20,
			}
	};
	// Set the ownership state.
	this.owners = {
			supply: null,
	};
	// Set the lazy-loaded adjacent points array.
	this.adjacents = null;
	// Draw the point.
	this.draw();
}

/// HELPERS: Travel

Point.distance = function(source, target) {
	return {
		drow: Math.abs(target.position.row - source.position.row),
		dcol: Math.abs(target.position.col - source.position.col),
	}
}

Point.direction = function(source, target) {
	return {
		drow: sign(target.position.row - source.position.row),
		dcol: sign(target.position.col - source.position.col),
	}
}

Point.prototype.travel = function(options, callbacks) {
	options = $.extend({
		drow: 0,
		dcol: 0,
	}, options);
	callbacks = $.extend({
		onstep: function() {},
		onout: function() {return false},
	}, callbacks);
	// Start at this point.
	var row = this.position.row;
	var col = this.position.col;
	var step = 0;
	var onwards = true;
	var inbounds = true;
	var target;
	// Continue while travel is in bounds and valid.
	while (onwards) {
		// Move to next point.
		step++;
		row += options.drow;
		col += options.dcol;
		// Check if in range.
		inbounds = this.board.inRange({row: row, col: col});
		if (inbounds) {
			// See what we should do with the next point.
			options.target = this.board.points[row][col];
			onwards = callbacks.onstep(step, options);
		} else {
			// See what we should do when out of bounds.
			onwards = callbacks.onout(step, options);
		}
	}
}

// ADJACENT POINTS

Point.prototype.isAdjacentTo = function(point) {
	var d = Point.distance(this, point);
	return (d.drow == 1) != (d.dcol == 1);
}

Point.prototype.addAdjacent = function(drow, dcol) {
	// Get the position of the adjacent.
	position = {
			row: this.position.row + drow,
			col: this.position.col + dcol,
	};
	// Add the adjacent if it is in bounds.
	if (this.board.inRange(position)) {
		this.adjacents.push(this.board.points[position.row][position.col]);
	}
}

Point.prototype.getAdjacents = function() {
	if (this.adjacents == null) {
		this.adjacents = [];
		this.addAdjacent(0, 1);
		this.addAdjacent(0, -1);
		this.addAdjacent(1, 0);
		this.addAdjacent(-1, 0);
	} return this.adjacents;
}

Point.prototype.getCoadjacents = function(direction) {
	return [this.board.points[this.position.row + direction.drow][this.position.col],
	        this.board.points[this.position.row][this.position.col + direction.dcol]];
}

/// SUPPLY POINTS

Point.prototype.supply = function(player) {
	this.owners.supply = player;
	this.size.width = 10;
	this.shape.size(this.size.width, this.size.width);
	this.shape.fill(this.color());
}

/// PIECES

Point.prototype.clear = function(piece) {
	if (this.piece == piece) {
		this.piece = null;
	}
}

Point.prototype.hasOpponentOf = function(piece) {
	if (this.piece == null) {
		return false;
	} else {
		return this.piece.player != piece.player;
	}
}

Point.prototype.adjacentHasOpponentOf = function(piece) {
	return this.getAdjacents().some(function(adjacent) {
		return adjacent.hasOpponentOf(piece);
	});
}

Point.prototype.isOrthogonallyRushableFrom = function(piece) {
	// During push, allow all orthogonal rushes.
	if (piece.player.pushing()) return true;
	// Check if any adjacent point has an opponent.
	return this.adjacentHasOpponentOf(piece);
}

Point.prototype.isDiagonallyRushableFrom = function(piece, direction) {
	// After being pushed, disallow diagonal rushes.
	if (piece.pushed) return false;
	// Check if any coadjacent point has an opponent.
	return piece.point.getCoadjacents(direction).some(function(coadjacent) {
		return coadjacent.hasOpponentOf(piece);
	});
}

Point.prototype.isRushableFrom = function(piece, direction) {
	// Only empty points can be rushed.
	if (this.piece != null) return false;
	// Check the direction of the rush.
	if ((direction.drow == 0) || (direction.dcol == 0)) {
		return this.isOrthogonallyRushableFrom(piece);
	} else {
		return this.isDiagonallyRushableFrom(piece, direction);
	}
}

Point.prototype.isRetreatableFrom = function(piece) {
	// Only empty points can be retreated to.
	return this.piece == null;
}

Point.prototype.isFollowableFrom = function(piece) {
	// Check if the point is the follow point.
	return this == piece.player.points.follow;
}

/// ACTIONS

Point.prototype.select = function() {
	var current = this.board.players.current;
	if (current !== null) {
		var selected = current.pieces.selected;
		if (selected !== null) {
			selected.goTo(this);
		}
	}
}

Point.prototype.focus = function() {
	$('#play-messages-point').text(this.toString());
}

Point.prototype.blur = function() {
	$('#play-messages-point').text('');
}

/// DRAWING

Point.prototype.color = function() {
	if (this.owners.supply != null) {
		return this.owners.supply.colors.regular;
	} else {
		return 'black';
	}
}

Point.prototype.attr = function() {
	return {
		cx: this.position.x,
		cy: this.position.y,
		fill: this.color(),
		'class': 'point',
	};
}

Point.prototype.maskattr = function() {
	return {
		x: this.position.x - (this.size.mask.width / 2),
		y: this.position.y - (this.size.mask.width / 2),
		'class': 'point-mask',
	}
}

Point.prototype.draw = function() {
	var point = this;
	this.shape = this.board.canvas
	.circle(this.size.width)
	.attr(this.attr());
	this.mask = this.board.canvas
	.rect(this.size.mask.width, this.size.mask.width)
	.attr(this.maskattr())
	.on('click', function() {
		point.select();
	}).on('mouseover', function() {
		point.focus();
	}).on('mouseout', function() {
		point.blur();
	});
}

/// STRINGS

Point.prototype.toString = function() {
	return this.position.row + '' + this.position.col;
}