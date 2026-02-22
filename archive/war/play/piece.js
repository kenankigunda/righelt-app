function Piece(board, player, point, options) {
	options = $.extend({
		permanent: true,
	}, options);
	// Set the parent board and player.
	this.board = board;
	this.player = player;
	if (options.permanent) {
		this.board.addPiece(this);
		this.player.addPiece(this);
	}
	// Set the location.
	this.point = point;
	point.piece = this; 
	// Set the size.
	this.size = {
			width: 20,
	};
	// Set the state.
	this.focused = false;
	this.selected = false;
	this.shifted = false;
	this.pushed = false;
	this.paths = {};
	this.edges = {};
	this.clearState({
		supplied: true,
		commanded: true,
	});
	// Draw the piece.
	this.draw();
}

/// HELPERS: Travel

Piece.direction = function(source, target) {
	return Point.direction(source.point, target.point);
}

Piece.prototype.travel = function(options, callbacks) {
	this.point.travel(options, callbacks);
}

/// ADJACENCT PIECES

Piece.prototype.isAdjacentTo = function(piece) {
	return this.point.isAdjacentTo(piece.point);
}

/// ACTIONS: Select

Piece.prototype.select = function() {
	if (this.player.selected()) {
		this.selected = true;
		this.updateOnSelect();
	} else {
		var source = this.board.players.current.pieces.selected;
		if (source != null && source.player.agent()) {
			source.pushTo(this);
		}
	}
}

Piece.prototype.deselect = function() {
	this.selected = false;
	this.updateOnSelect();
}

Piece.prototype.updateOnSelect = function() {
	if (this.selected) {
		// Select the piece on the player.
		this.player.selectPiece(this);
		// Create projections.
		this.projectAll();
		// Show the supply and command paths.
		this.showSupplyPath()
		this.showCommandPath();
		// Show the move hinting.
		this.showHinting();
		// More stuff, by subclasses.
		this.moreOnSelect();
	} else {
		// Deselect the piece on the player.
		if (this.player.pieces.selected == this) {
			this.player.pieces.selected = null;
		} 
		// Remove projections.
		this.unprojectAll();
		// Hide the supply and command paths.
		this.hideSupplyPath();
		this.hideCommandPath();
		// Hide the move hinting.
		this.hideHinting();
		// More stuff, by subclasses.
		this.moreOnDeselect();
	}
	this.shape.fill({
		color: this.color(),
	});
}

Piece.prototype.moreOnSelect = function() {
	console.log('Group: ' + this.group);
};
Piece.prototype.moreOnDeselect = function() {};

/// ACTIONS: General

Piece.prototype.resetMoves = function() {
	this.moves = {
			projections: [],
			moveables: [],
			rushables: [],
			pushables: [],
			followables: [],
			retreatables: [],
			preview: null,
	};
}

Piece.prototype.hasNoMoves = function() {
	var hasNoMoves = true;
	$.each(this.moves, function(type, list) {
		if ($.isArray(list)) {
			console.log(type + ': ' + list.length);
			hasNoMoves = list.length == 0;
			return hasNoMoves;
		} else {
			console.log(type + ': not a list');
		}
	});
	return hasNoMoves;
}

Piece.prototype.to = function(point) {
	// Clear the old state.
	this.unpush();
	this.point.clear(this);
	// Move the new point.
	this.point = point;
	this.point.piece = this;
	// Set the new state.
	this.shape.attr(this.attr());
	this.deselect();
	this.board.resetSupplyCommand();
}

Piece.prototype.goTo = function(point) {
	if (!this.player.agent()) return;
	if (this.canRush(point) && (this.canMove(point))) {
		var source = this.point;
		this.startMoveOrRushTo(point);
		this.player.chooseRushOrMove(this, source, point);
	} else if (this.canRush(point)) {
		this.rushTo(point);
	} else if (this.canMove(point)) {
		this.moveTo(point);
	} else if (this.canFollow(point)) {
		this.followTo(point);
	} else if (this.canRetreat(point)) {
		this.retreatTo(point);
	}
}

/// ACTIONS: Move
/// Only commanders can move.

Piece.prototype.canMove = function(point) {
	return false;
}

Piece.prototype.findMoveables = function() {
}

Piece.prototype.moveTo = function(point, options) {
	if (!this.canMove(point)) return;
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		this.board.channel.piecesSend('move', this, point);
	}
	// Place the piece.
	this.to(point);
	this.board.clearBattle();
	this.player.advance();
}

Piece.prototype.endMoveTo = function(source, target, options) {
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		console.log(this);
		this.board.channel.pointsSend('move', this.player, source, target);
	}
	// Place the piece.
	this.board.clearBattle();
	this.player.advance();
}

/// ACTIONS: Rush

Piece.prototype.canRush = function(point) {
	if (typeof(point) === 'undefined') {
		var rushable = true;
	} else {
		var rushable = ($.inArray(point, this.moves.rushables) != -1);
	} return rushable && this.player.canRush() && !this.shifted && !this.pushed && this.supplied && this.commanded;
}

Piece.prototype.addRushable = function(point) {
	this.moves.rushables.push(point);
	this.addHint(new RushHint(this, point));
}

Piece.prototype.findRushable = function(options) {
	var self = this;
	this.travel(options, {
		onstep: function(step, options) {	
			if (options.target.isRushableFrom(self, options)) {
				self.addRushable(options.target);
			} return false;
		},
	});
} 

Piece.prototype.findRushables = function() {
	if (!this.canRush()) return;
	// Search vertically and horizontally.
	this.findRushable({drow: 1});
	this.findRushable({drow: -1});
	this.findRushable({dcol: 1});
	this.findRushable({dcol: -1});
	// Search diagonally.
	this.findRushable({drow: 1, dcol: 1});
	this.findRushable({drow: 1, dcol: -1});
	this.findRushable({drow: -1, dcol: 1});
	this.findRushable({drow: -1, dcol: -1});	
}

Piece.prototype.rushTo = function(point, options) {
	if (!this.canRush(point)) return;
	// Clear the shift queue.
	this.player.clearShiftQueue();
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		this.board.channel.piecesSend('rush', this, point);
	}
	// Execute the move.
	this.player.startShift(this, 'rush');
	this.player.startPushRushBattle();
	this.to(point);
}

Piece.prototype.endRushTo = function(source, target, options) {
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		this.board.channel.pointsSend('rush', this.player, source, target);
	}
	// Execute the move.
	this.player.startShift(this, 'rush');
	this.player.startPushRushBattle();
}

/// ACTIONS: Move or Rush

Piece.prototype.startMoveOrRushTo = function(point, options) {
	this.player.startShift(this, 'rush', {draw: false});
	this.player.toShiftQueue(this.point, point);
	this.to(point);
}

/// ACTIONS: Push

Piece.prototype.canPush = function(piece) {
	if (typeof(piece) === 'undefined') {
		var pushable = true;
	} else {
		var pushable = ($.inArray(piece, this.moves.pushables) != -1);
	} return pushable && !this.player.shifting() && !this.shifted && !this.pushed && this.supplied && this.commanded;
}

Piece.prototype.addPushable = function(piece) {
	this.moves.pushables.push(piece);
	this.addHint(new PushHint(this, piece));
}

Piece.prototype.findPushable = function(options) {
	var self = this;
	this.travel(options, {
		onstep: function(step, options) {	
			// Stop and check for an opponent piece.
			var piece = options.target.piece;
			if ((piece != null) && (piece.player != self.player)) {
				if (self.group.strength() > piece.group.strength()) {
					self.addPushable(piece);
				}
			} return false;
		},
	});
}

Piece.prototype.findPushables = function() {
	if (!this.canPush()) return;
	this.findPushable({drow: 1});
	this.findPushable({drow: -1});
	this.findPushable({dcol: 1});
	this.findPushable({dcol: -1});
}

Piece.prototype.pushTo = function(target, options) {
	if (!this.canPush(target)) return;
	// Send the push to the server.
	var settings = $.extend({
		send: true,
	}, options);
	if (settings.send) {
		this.board.channel.piecesSend('push', this, target.point);
	}
	// Execute the move.
	this.player.startShift(this, 'push');
	this.player.startPushRushBattle();
	target.push();
	this.player.points.follow = this.point;
	this.to(target.point);
}

Piece.prototype.push = function() {
	this.player.startShift(this, 'retreat', {draw: false});
	this.pushed = true;
	this.point.pushed = this;
	this.unpreviewPushed();
	this.shape.attr(this.attr());
}

Piece.prototype.unpush = function() {
	this.player.endShift('retreat');
	this.pushed = false;
	if (this.point.pushed == this) {
		this.point.pushed = null;
	}
}

/// ACTIONS: Follow

Piece.prototype.canFollow = function(point) {
	if (typeof(point) === 'undefined') {
		var followable = true;
	} else {
		var followable = ($.inArray(point, this.moves.followables) != -1);
	} return followable && this.player.pushing() && !this.shifted && !this.pushed;
}

Piece.prototype.addFollowable = function(point) {
	this.moves.followables.push(point);
	this.addHint(new FollowHint(this, point));
}

Piece.prototype.findFollowable = function(options) {
	var self = this;
	this.travel(options, {
		onstep: function(step, options) {	
			if (options.target.isFollowableFrom(self, options)) {
				self.addFollowable(options.target);
			} return false;
		},
	});
} 

Piece.prototype.findFollowables = function() {
	if (!this.canFollow()) return;
	this.findFollowable({drow: 1});
	this.findFollowable({drow: -1});
	this.findFollowable({dcol: 1});
	this.findFollowable({dcol: -1});
}

Piece.prototype.followTo = function(point, options) {
	if (!this.canFollow(point)) return;
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		this.board.channel.piecesSend('follow', this, point);
	}
	// Execute the move.
	this.player.continueShift(this);
	this.player.points.follow = this.point;
	this.to(point);
}

/// ACTIONS: Retreat

Piece.prototype.canRetreat = function(point) {
	if (typeof(point) === 'undefined') {
		var retreatable = true;
	} else {
		var retreatable = ($.inArray(point, this.moves.retreatables) != -1);
	} return retreatable && this.pushed;
}

Piece.prototype.addRetreatable = function(point) {
	this.moves.retreatables.push(point);
	this.addHint(new RetreatHint(this, point));
}

Piece.prototype.ensureRetreatable = function() {
	// If the piece cannot retreat, remove it.
	if (this.moves.retreatables.length == 0) {
		this.remove();
		this.player.endShift('retreat');
	}
}

Piece.prototype.findRetreatable = function(options) {
	var self = this;
	this.travel(options, {
		onstep: function(step, options) {	
			if (options.target.isRetreatableFrom(self, options)) {
				self.addRetreatable(options.target);
			} return false;
		},
	});
} 

Piece.prototype.findRetreatables = function() {
	if (!this.canRetreat()) return;
	this.findRetreatable({drow: 1});
	this.findRetreatable({drow: -1});
	this.findRetreatable({dcol: 1});
	this.findRetreatable({dcol: -1});
	this.ensureRetreatable();
}

Piece.prototype.retreatTo = function(point, options) {
	if (!this.canRetreat(point)) return;
	// Send the move to the server.
	options = $.extend({
		send: true,
	}, options);
	if (options.send) {
		this.board.channel.piecesSend('retreat', this, point);
	}
	// Execute the move.
	this.to(point);
}

/// ACTIONS: Preview

Piece.prototype.focus = function() {
	this.point.focus();
	if (this.player.selected()) {
		this.focused = true;
		this.shape.fill(this.color());
	}
}

Piece.prototype.blur = function() {
	this.point.blur();
	this.focused = false;
	this.shape.fill(this.color());
}

Piece.prototype.preview = function() {
	this.shape.attr({
		'class': this.cssClass({state: 'previewing'}),
	});
}

Piece.prototype.unpreview = function() {
	this.shape.attr({
		'class': this.cssClass(),
	});
}

Piece.prototype.previewPushed = function() {
	this.shape.attr(this.attr({pushed: true}));
}

Piece.prototype.unpreviewPushed = function() {
	this.shape.attr(this.attr());
}

Piece.prototype.startPreview = function(hint) {
	// Preview this piece.
	this.preview();
	// If pushing, preview the pushed piece.
	if (hint.type() == 'push') {
		hint.target.previewPushed();
	}
}

Piece.prototype.endPreview = function(hint) {
	// Unpreview this piece.
	this.unpreview();
	// If pushing, unpreview the pushed piece.
	if (hint.type() == 'push') {
		hint.target.unpreviewPushed();
	}
}

/// ACTIONS: Project

Piece.prototype.canProject = function() {
	return this.supplied && this.commanded && !this.player.shifting() && !this.player.battling() && !this.pushed;
}

Piece.prototype.project = function(options) {
	var self = this;
	options = $.extend({
		distance: 2,
	}, options);
	this.travel(options, {
		onstep: function(step, options) {			
			if (step < options.distance) {
				// If we're still in range, keep going if the point is empty.
				return options.target.piece == null;
			} else {
				// If we've hit our range, stop and project if the point is empty.
				if (options.target.piece == null) {
					self.moves.projections.push(new Projection(self, options.target));
				} return false;
			}
		},
	});
}

Piece.prototype.projectAll = function() {
	if (!this.player.agent()) return;
	if (!this.canProject()) return;
	this.project({drow: 1});
	this.project({drow: -1});
	this.project({dcol: 1});
	this.project({dcol: -1});
}

Piece.prototype.unprojectAll = function() {
	this.moves.projections.forEach(function(projection) {
		projection.remove();
	});
	this.moves.projections = [];
}

/// ACTIONS: Remove

Piece.prototype.canRemove = function() {
	return !this.player.pushing();
}

Piece.prototype.remove = function() {
	this.deselect();
	this.shape.remove();
	this.board.removePiece(this);
	this.player.removePiece(this);
	if (this.point.piece == this) {
		this.point.piece = null;
	}
}

/// GROUPING

Piece.prototype.resetGroup = function() {
	this.group = null;
}

Piece.prototype.findGroup = function() {
	if (this.group != null) return;
	this.addToGroup(new Group());
}

Piece.prototype.addToGroup = function(group) {
	if (this.group != null) return;
	// Add this piece to the group.
	group.add(this);
	// Recurse on the adjacent pieces.
	var self = this;
	this.forEdges(function(edge) {
		var across = edge.across(self);
		if (self.isAdjacentTo(across)) {
			across.addToGroup(group);
		}
	});
}

/// STATE SUMMARY

Piece.prototype.clearState = function(options) {
	options = $.extend({
		supplied: false,
		commanded: false,
		subcommander: null,
	}, options);
	this.resetEdges();
	this.resetSupply(options);
	this.resetCommand(options);
	this.resetMoves();
	this.resetGroup();
	this.clearHinting();
}

Piece.prototype.updateState = function() {
	this.findMoveables();
	this.findRushables();
	this.findPushables();
	this.findFollowables();
	this.findRetreatables();
	this.shape.fill(this.color());
}


Piece.prototype.showState = function() {
	this.showSupplyPath();
	this.showCommandPath();
	this.showHinting();
}

/// SUPPLY and COMMAND

Piece.prototype.canEdge = function() {
	return !this.pushed;
}

Piece.prototype.createEdge = function(options) {
	options = $.extend({
		drow: 0,
		dcol: 0,
		distance: 0,
	}, options);
	// Create only if there is no preexisting edge.
	if (this.edges[options.drow][options.dcol] == null) {
		var self = this;
		this.travel(options, {
			onstep: function(step, options) {
				if (options.target.piece == null) {
					// If we're at an empty space, keep going if we're still in range.
					return (options.distance == 0) || (step < options.distance);
				} else {
					// If we've reached another piece, stop.
					var piece = options.target.piece;
					if (piece.player == self.player) {
						// If the piece is friendly, try to create an edge.
						if (self.canEdge() && piece.canEdge()) {
							new Edge(self, options.target.piece);
						}
					} return false;
				}
			},
		});
	};
}

Piece.prototype.createEdges = function() {
	// Search vertically and horizontally.
	this.createEdge({drow: 1});
	this.createEdge({drow: -1});
	this.createEdge({dcol: 1});
	this.createEdge({dcol: -1});
	// Search one step diagonally.
	this.createEdge({drow: 1, dcol: 1, distance: 1});
	this.createEdge({drow: 1, dcol: -1, distance: 1});
	this.createEdge({drow: -1, dcol: 1, distance: 1});
	this.createEdge({drow: -1, dcol: -1, distance: 1});	
}

Piece.prototype.forEdges = function(callback) {
	if (this.edges != null) {
		$.each(this.edges, function(drow, edgerow) {
			$.each(edgerow, function(dcol, edge) {
				callback(edge);
			});
		});
	}
}

Piece.prototype.removeEdges = function() {
	this.forEdges(function(edge) {
		edge.remove();
	});
}

Piece.prototype.resetEdges = function() {
	this.removeEdges();
	this.edges = {};
	this.edges[0] = {};
	this.edges[1] = {};
	this.edges[-1] = {};
}

Piece.prototype.placeOnGrid = function() {
	this.player.grid.setWalkableAt(this.point.position.col, this.point.position.row, false);
}

Piece.prototype.resetSupply = function(options) {
	this.supplied = options.supplied;
	if (this.paths.supply != null) {
		this.paths.supply.remove();
		this.paths.supply == null;
	}
}

Piece.prototype.findSupply = function() {
	var self = this;
	var keep = true;
	self.supplied = true;
	var finder = new PF.AStarFinder();
	this.board.players.list.forEach(function(player) {
		if (player != self.player) {
			// Work against the enemy grid.
			var grid = player.grid.clone();
			// Find a path to the supply.
			var path = finder.findPath(
					self.point.position.col, 
					self.point.position.row,
					self.player.supply.position.col, 
					self.player.supply.position.row,
					grid);
			// Set the piece's path.
			if (path.length > 0) {
				self.paths.supply = new Path(self, path);
			} else {
				// If there is no path, the piece is dead.
				if (self.canRemove()) {
					self.remove();
					keep = false;
				} self.supplied = false;
			}
		}
	});
	// Indicate whether the piece should be kept.
	return keep;
}

Piece.prototype.resetCommand = function(options) {
	this.commanded = options.commanded;
	this.subcommander = options.subcommander;
}

Piece.prototype.setCommand = function(subcommander) {
	// If this piece is already commanded, skip it.
	if (this.commanded) return;
	// Make the piece commanded.
	this.commanded = true;
	if (typeof(subcommander) === 'undefined') {
		this.subcommander = null;
	} else {
		this.subcommander = subcommander;
	}
	var self = this;
	// Recurse on the adjacent pieces.
	this.forEdges(function(edge) {
		// Look for valid uncut edges.
		if (edge != null && !edge.cut) {
			edge.across(self).setCommand(self);
		}
	});
}

// DISPLAY: Supply and Command

Piece.prototype.showSupplyPath = function() {
	if (this.paths.supply != null) {
		if (this.board.players.local.display.supply == 'selected') {
			this.paths.supply.show();
		}
	}
}

Piece.prototype.hideSupplyPath = function() {
	if (this.paths.supply != null) {
		if (this.board.players.local.display.supply == 'selected') {
			this.paths.supply.hide();
		}
	}
}

Piece.prototype.showCommandPath = function() {
	if (this.subcommander != null) {
		if (this.board.players.local.display.command == 'selected') {
			var d = Piece.direction(this, this.subcommander);
			var edge = this.edges[d.drow][d.dcol];
			if (edge != null) {
				edge.show();
				this.subcommander.showCommandPath();
			}
		}
	}
}

Piece.prototype.hideCommandPath = function() {
	if (this.subcommander != null) {
		if (this.board.players.local.display.command == 'selected') {
			var d = Piece.direction(this, this.subcommander);
			var edge = this.edges[d.drow][d.dcol];
			if (edge != null) {
				edge.hide();
				this.subcommander.hideCommandPath();
			}
		}
	}
}

/// DISPLAY: Hinting

Piece.prototype.clearHinting = function() {
	this.hints = {
			move: [],
			rush: [],
			push: [],
			follow: [],
			retreat: [],
	};
}

Piece.prototype.addHint = function(hint) {
	this.hints[hint.type()].push(hint);
}

Piece.prototype.showHinting = function() {
	if (!this.player.agent()) return;
	var self = this;
	$.each(this.hints, function(type, hints) {
		if (self.board.players.local.display[type] == 'selected') {
			hints.forEach(function(hint) {
				hint.show();
			});
		}
	});
}

Piece.prototype.hideHinting = function() {
	if (!this.player.agent()) return;
	var self = this;
	$.each(this.hints, function(type, hints) {
		if (self.board.players.local.display[type] == 'selected') {
			hints.forEach(function(hint) {
				hint.hide();
			});
		}
	});
}

/// DRAWING

Piece.prototype.cssClass = function(options) {
	options = $.extend({
		state: '',
	}, options);
	return 'piece ' + options.state; 
} 

Piece.prototype.place = function(options) {
	options = $.extend({
		point: this.point,
		pushed: this.pushed,
		state: '',
	}, options);
	if (options.pushed && (options.point == this.point)) {
		options.offset = -this.board.size.offset / 2;
	} else {
		options.offset = 0;
	} return this.placeUsing(options);
}

Piece.prototype.placeUsing = function(options) {
	return {
		cx: options.point.attr().cx + options.offset,
		cy: options.point.attr().cy + options.offset,
	};
}

Piece.prototype.color = function(options) {
	options = $.extend({
		selected: this.selected,
		focused: this.focused,
		supplied: this.supplied,
		commanded: this.commanded,
	}, options);
	if (options.selected) {
		return this.player.colors.selected;
	} else if (options.focused) {
		return this.player.colors.focused;
	} else if (options.supplied && options.commanded) {
		return this.player.colors.regular;
	} else {
		return this.player.colors.dormant;
	}
}

Piece.prototype.stroke = function() {
	return this.player.colors.regular;
}

Piece.prototype.attr = function(options) {
	return $.extend(this.place(options), {
		fill: this.color(),
		stroke: this.stroke(),
		'stroke-width': '2px',
		'class': this.cssClass(options),
	});
}

Piece.prototype.startDraw = function() {
	return this.board.canvas.circle(this.size.width);
}

Piece.prototype.draw = function() {
	var piece = this;
	this.shape = this.startDraw()
	.attr(this.attr())
	.on('click', function() {
		piece.select();
	})
	.on('mouseover', function() {
		piece.focus();
	}).on('mouseout', function() {
		piece.blur();
	});
}

/// STRING REPRESENTATION

Piece.prototype.toString = function() {
	return this.point.toString();
}