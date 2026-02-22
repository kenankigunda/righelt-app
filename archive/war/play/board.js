function Board(canvas, size) {
	// Set the parent canvas.
	this.canvas = canvas;
	// Set the unscaled size.
	this.size = $.extend({
		rows: 10,
		cols: 10,
		scale: 40,
		offset: 20,
	}, size);
	// Set the scaled size.
	$.extend(this.size, {
		height: this.scale(this.size.rows, {offset: 0}),
		width: this.scale(this.size.cols, {offset: 0}),
		offset: this.size.scale / 2,
	});
	// Draw the board.
	this.draw();
	// Create the points.
	this.createPoints();
	// Create the piece list.
	this.pieces = [];
	// Create the player list.
	this.players = {
			agents: 2,
			enlisted: 0,
			next: 0,
			current: null,
			list: [],
			battle: {
				type: null,
				starter: null,
			}
	};
	this.startEnlistedCount();
}

/// POINTS

Board.prototype.createPoints = function() {
	this.points = {};
	for (var row = 0; row < this.size.rows; row++) {
		this.points[row] = {};
		for (var col = 0; col < this.size.cols; col++) {
			this.points[row][col] = new Point(this, {row: row, col: col});
		}
	}
}

Board.prototype.getPoint = function(stringpoint) {
	var rowcol = stringpoint.split('');
	var row = parseInt(rowcol[0]);
	var col = parseInt(rowcol[1]);
	return this.points[row][col];
}

Board.prototype.inRange = function(position) {
	var position = $.extend({
		row: 0,
		col: 0,
	}, position);
	var inRange = true;
	if (position.row < 0 || position.row >= this.size.rows) {
		inRange = false;
	}
	if (position.col < 0 || position.col >= this.size.cols) {
		inRange = false;
	}
	return inRange;
}

/// PIECES

Board.prototype.addPiece = function(piece) {
	this.pieces.push(piece);
}

Board.prototype.removePiece = function(piece) {
	this.pieces = $.grep(this.pieces, function(candidate) {
		return piece != candidate;
	});
}

Board.prototype.clearSelect = function() {
	var current = this.players.current;
	if (current !== null) {
		var selected = current.pieces.selected;
		if (selected !== null) {
			selected.deselect();
		}
	}
}

/// SUPPLY and COMMAND

Board.prototype.resetSupplyCommand = function() {
	do {
		var valid = this.trySupplyCommand();
	} while (!valid);
}

Board.prototype.trySupplyCommand = function() {
	// Clear the player state.
	this.players.list.forEach(function(player) {
		player.clearState();
	});
	// Clear the piece state and place the pieces on the pathfinding grid.
	this.pieces.forEach(function(piece) {
		piece.clearState();
		piece.placeOnGrid();
	});
	// Create the edges between the pieces.
	this.pieces.forEach(function(piece) {
		piece.createEdges();
	});
	// Try to supply the pieces of the other players.
	var supplied = this.players.list.every(function(player) {
		if (player.selected()) {
			return true;
		} else {
			return player.setSupply();
		}
	});
	if (!supplied) {
		return false;
	}
	// Try to supply the pieces of the current player.
	supplied = this.players.current.setSupply();
	if (!supplied) {
		return false;
	}
	// Update the players.
	this.players.list.forEach(function(player) {
		player.updateState();
	});
	// Update the pieces.
	this.pieces.forEach(function(piece) {
		piece.updateState();
	});
	return true;
}

Board.prototype.createGrid = function() {
	return new PF.Grid(this.size.rows, this.size.cols);
}

/// PLAYERS

Board.prototype.startEnlistedCount = function() {
	this.players.enlisted = parseInt($('#info-item-game-num-players .value').text());
}

Board.prototype.enlist = function(player) {
	if (!player.enlisted) {
		this.players.enlisted++;
		player.enlisted = true;
	}
}

Board.prototype.single = function() {
	return this.players.enlisted < 2;
}

Board.prototype.addPlayer = function(player) {
	this.players.list.push(player);
	player.index = this.players.next++;
	if (player.index < this.players.enlisted) {
		player.enlisted = true;
	}
}

Board.prototype.setLocal = function() {
	var local = Player.local();
	if (local < this.players.agents) {
		// Mark the local as an agent.
		this.players.local = this.players.list[local]; 
	} else {
		// Mark the local as a viewer.
		this.players.local = new Viewer(this);
	}
}

Board.prototype.getAgentOrLocalViewer = function(index) {
	if (index < this.players.agents) {
		return this.players.list[index];
	} else if (this.players.local.index == index) {
		return this.players.local;
	}
}

/// ACTION BUTTONS

Board.prototype.drawAction = function(action) {
	var current = this.players.current;
	if ((current != null) && current.agent()) {
		$('#play-options-actions').empty().append(action);
	} else {
		this.clearAction();
	}
}

Board.prototype.checkDrawAction = function() {
	var player = this.players.current;
	var type = this.players.battle.type;
	if ((player != null) && ((type == null) || player.shifting())) {
		// If there is no battle action or the player is shifting,
		// check the player action.
		player.checkDrawAction();
	} else if (type != null) {
		// If there is a battle action and the player is not shifting,
		// draw the battle action.
		this.drawBattle();
	} else {
		// If no condition is met, clear the action.
		this.clearAction();
	}
}

Board.prototype.clearAction = function() {
	var current = this.players.current;
	if (current == null) {
		$('#play-options-actions').html('');
	} else {
		current.clearAction();
	}
}

/// BATTLES

Board.prototype.startBattle = function(player, type) {
	if (this.players.battle.type == null) {
		this.players.battle.starter = player;
		this.players.battle.type = type;
	}
}

Board.prototype.drawBattle = function() {
	var board = this;
	var end = $('<div class="play-options-action">')
	.text('end ' + this.players.battle.type + ' battle')
	.css('background-color', this.players.current.colors.regular)
	.click(function() {
		board.endBattle();
	});
	this.drawAction(end);
}

Board.prototype.clearBattle = function() {
	this.players.battle.type = null;
	this.players.battle.starter = null;
	this.clearAction();
}

Board.prototype.endBattle = function() {
	var starter = this.players.battle.starter;
	this.clearBattle();
	starter.advance({send: true});
}

Board.prototype.battling = function() {
	return this.players.battle.type != null;
}

/// DRAWING

Board.prototype.scale = function(unscaled, options) {
	options = $.extend({
		offset: this.size.offset,
	}, options);
	return options.offset + (this.size.scale * unscaled);
}

Board.prototype.scaleAll = function(array) {
	var board = this;
	var scaled = [];
	$.each(array, function(index, value) {
		scaled[index] = board.scale(value);
	}); return scaled;
}

Board.prototype.scalePath = function(path) {
	var board = this;
	var scaled = [];
	$.each(path, function(index, point) {
		scaled[index] = board.scaleAll(point);
	}); return scaled;
}

Board.prototype.attr = function() {
	return {
		x: 0,
		y: 0,
		'class': 'board',
	};
}

Board.prototype.draw = function() {
	var board = this;
	this.shape = this.canvas
	.rect(this.size.width, this.size.height)
	.attr(this.attr())
	.on("click", function() {
		board.clearSelect();
	})
}