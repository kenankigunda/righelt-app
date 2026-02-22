function Edge(start, end) {
	this.board = start.board;
	this.player = start.player;
	this.player.addEdge(this);
	// Record the endpoint pieces.
	this.start = start;
	this.end = end;
	this.place();
	// Set the state.
	this.cut = false;
	// Draw the edge.
	this.draw();
	this.display();
}

/// ENDPOINTS

Edge.prototype.across = function(piece) {
	if (piece == this.start) {
		return this.end;
	} else if (piece == this.end) {
		return this.start;
	}
}

/// ACTIONS: Placing

Edge.prototype.place = function() {
	var d = Piece.direction(this.start, this.end);
	this.start.edges[d.drow][d.dcol] = this;
	this.end.edges[-d.drow][-d.dcol] = this;
	this.placeOnGrid(d.drow, d.dcol);
}

Edge.prototype.placeOnGrid = function(drow, dcol) {
	// Mark all the points between the start and end as unwalkable.
	var row = this.start.point.position.row + drow;
	var col = this.start.point.position.col + dcol;
	while (row != this.end.point.position.row || col != this.end.point.position.col) {
		this.player.grid.setWalkableAt(col, row, false);
		row += drow;
		col += dcol;
	}
}

function sign(number) {
	return (number)? (number < 0)? -1 : 1 : 0;
}

/// ACTIONS: Intersections

Edge.prototype.checkCut = function() {
	if (this.cut) return; // Don't check if edge is already known to be cut.
	var self = this;
	this.board.players.list.forEach(function(player) {
		if (player != self.player) {
			$.each(player.edges, function(index, edge) {
				// Go through all unfriendly edges and check for intersection.
				if (self.intersects(edge)) {
					// If intersection, mark the edges as cut and exit.
					self.markCut();
					edge.markCut();
					return false;
				}
			})
		}
	})
}

Edge.prototype.markCut = function() {
	this.cut = true;
	this.shape.opacity(this.opacity());
}

Edge.prototype.intersects = function(edge) {
	return isIntersect(
			this.start.point.position, 
			this.end.point.position,
			edge.start.point.position,
			edge.end.point.position
	);
}

/// Intersect detection helpers, from Stack Overflow:
/// http://stackoverflow.com/questions/9043805/test-if-two-lines-intersect-javascript-function/16725715#16725715
/// Modified to use righelt point positions.

function ccw(p1, p2, p3) {
	a = p1.row; b = p1.col; 
	c = p2.row; d = p2.col;
	e = p3.row; f = p3.col;
	return (f - b) * (c - a) > (d - b) * (e - a);
}

function isIntersect(p1, p2, p3, p4) {
	return (ccw(p1, p3, p4) != ccw(p2, p3, p4)) && (ccw(p1, p2, p3) != ccw(p1, p2, p4));
}

/// ACTIONS: Remove

Edge.prototype.remove = function() {
	this.shape.remove();
}

/// DRAWING

Edge.prototype.opacity = function() {
	if (this.cut) {
		return 0.25;
	} else {
		return 1;
	}
}

Edge.prototype.attr = function() {
	return {
		stroke: this.player.colors.regular,
		opacity: this.opacity(),
	};
}

Edge.prototype.draw = function() {
	this.shape = this.board.canvas
	.line(this.start.point.position.x, this.start.point.position.y, 
			this.end.point.position.x, this.end.point.position.y)
	.attr(this.attr())
	.back();
	this.board.shape.back();
}

Edge.prototype.display = function() {
	if (this.board.players.local.display.command == 'all') {
		this.show();
	} else {
		this.hide();
	}
}

Edge.prototype.show = function() {
	this.shape.show();
}

Edge.prototype.hide = function() {
	this.shape.hide();
}

/// STRINGS

Edge.prototype.toString = function() {
	return this.start.point + ' > ' + this.end.point;
}