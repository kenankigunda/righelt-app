function Player(board, colors, supply) {
	this.board = board;
	board.addPlayer(this);
	this.enlisted = this.local();
	// Set the color.
	if (typeof(colors) === 'string') {
		colors = {regular: colors};
	}
	this.colors = $.extend({
		regular: 'purple',
		focused: 'yellow',
		selected: 'yellow',
		dormant: '#ddd',
	}, colors);
	// Set the display options.
	this.getDisplaySettings();
	// Set the state.
	this.supply = supply;
	supply.supply(this);
	this.pieces = {
			commander: null,
			selected: null,
			list: [],
			shift: {
				type: null,
				list: [],
				queue: [],
			}
	};
	this.points = {
			follow: null,
	}
	this.clearState();
	// Draw the player.
	this.draw();
	// Set the player status.
	this.status = new PlayerStatus(this);
}

/// LOCALITY

Player.local = function() {
	return parseInt($('#info-item-player-index .value').text());
}

Player.prototype.local = function() {
	if (this.index == Player.local()) {
		return true;
	} else {
		return false;
	}
}

Player.prototype.agent = function() {
	return this.local() || this.board.single();
}

/// IDENTIFICATION

Player.prototype.rename = function(name) {
	this.board.channel.playersName(this.index, name);
	$('.play-account-name').text(name);
	this.$('.play-options-player-name').text(name);
}

/// TURNS

Player.prototype.focus = function() {
	this.shape.fill(this.color({selected: true}));
}

Player.prototype.blur = function() {
	this.shape.fill(this.color());
}

Player.prototype.selected = function() {
	return (this.board.players.current == this);
}

Player.prototype.select = function(options) {
	// Send the select to the server (off by default).
	var settings = $.extend({
		send: false,
	}, options);
	if (settings.send) {
		this.board.channel.playersSend('select', this.index);
	}
	// Deselect the current player.
	var current = this.board.players.current;
	if (current != null) {
		current.updateOnDeselect();
	}
	// Select the new player.
	this.board.players.current = this;
	this.updateOnSelect();
	// Update all the players.
	this.board.players.list.forEach(function(player) {
		player.updateOnAnySelect();
	});
}

Player.prototype.updateOnSelect = function() {	
	// Check if we should draw any action.
	this.board.checkDrawAction();
}

Player.prototype.updateOnDeselect = function() {
	// Check if we should clear any action.
	this.checkClearAction();
	// Deselect the selected piece.
	var selected = this.pieces.selected;
	if (selected != null) {
		selected.deselect();
	}
	// End the current shift.
	this.endShift();
}

Player.prototype.updateOnAnySelect = function() {
	// Redraw the player icon.
	this.shape.fill({
		color: this.color(),
	});
}

Player.prototype.next = function() {
	var next = (this.index + 1) % this.board.players.list.length;
	return this.board.players.list[next];
}

Player.prototype.advance = function(options) {
	this.next().select(options);
}

Player.prototype.drawAdvance = function() {
	var player = this;
	return $('<div class="play-options-action">')
	.css('background-color', this.colors.regular)
	.click(function() {
		player.advance({send: true});
	});
}

/// PIECES

Player.prototype.addPiece = function(piece) {
	this.pieces.list.push(piece);
}

Player.prototype.removePiece = function(piece) {
	this.pieces.list = $.grep(this.pieces.list, function(candidate) {
		return piece != candidate;
	});
}

Player.prototype.selectPiece = function(piece) {
	// Deselect the current piece.
	if (this.pieces.selected !== null) {
		this.pieces.selected.deselect();
	}
	// Select the new piece.
	this.pieces.selected = piece;
}


/// ACTION BUTTONS

Player.prototype.drawAction = function(action) {
	this.board.drawAction(action);
}

Player.prototype.checkDrawAction = function() {
	this.clearAction();
}

Player.prototype.clearAction = function() {
	if (this.agent() && !this.shifting()) {
		this.drawAction(this.drawAdvance().text('pass'));
	} else {
		$('#play-options-actions').html('');
	}
}

Player.prototype.checkClearAction = function() {
	this.checkClearBattle();
}

/// ACTION CHOICES

Player.prototype.chooseRushOrMove = function(piece, source, target) {
	var rush = this.drawChoose(piece, source, target, 'rush', piece.endRushTo);
	var move = this.drawChoose(piece, source, target, 'move', piece.endMoveTo);
	$('#play-options-actions').html('');
	$('#play-options-actions').append(move, rush);
}

Player.prototype.drawChoose = function(piece, source, target, name, callback) {
	var player = this;
	return $('<div class="play-options-action">')
	.text(name)
	.css('background-color', this.colors.regular)
	.click(function() {
		callback.call(piece, source, target);
	});
}

/// PIECE SHIFTS

Player.prototype.startShift = function(piece, type, options) {
	options = $.extend({
		agent: this.agent(),
		draw: true,
	}, options);
	piece.shifted = true;
	this.pieces.shift.list.push(piece);
	this.pieces.shift.type = type;
	// Create an end button for an agent player.
	if (options.agent && options.draw)  {
		var player = this;
		var end = this.drawAdvance().text('end ' + type);
		this.drawAction(end);
	}
}

Player.prototype.continueShift = function(piece) {
	piece.shifted = true;
	this.pieces.shift.list.push(piece);
}

Player.prototype.clearShift = function() {
	this.board.checkDrawAction();
}

Player.prototype.endShift = function(shift) {
	// Check if we should end the shift.
	if (typeof(shift) === 'undefined') {
		end = true;
	} else {
		end = this.pieces.shift.type == shift;
	} if (end) {
		// End the shift.
		this.points.follow = null;
		this.pieces.shift.type = null;
		this.clearShift();
		this.pieces.shift.list.forEach(function(piece) {
			piece.shifted = false;
			if (!piece.supplied) piece.remove();
		});
		this.pieces.shift.list = [];
		this.pieces.shift.queue = [];
	}
}

Player.prototype.toShiftQueue = function(source, target) {
	this.pieces.shift.queue.push({
		source: source,
		target: target,
	});
}

/// TODO FIX!!!!
Player.prototype.clearShiftQueue = function() {
	var player = this;
	window.setTimeout(function() {
		player.pieces.shift.queue.forEach(function(queued) {
			player.board.channel.pointsSend(player.pieces.shift.type, player, queued.source, queued.target);
		});
		player.pieces.shift.queue = [];
	}, 200);
}

Player.prototype.shifting = function() {
	return this.pieces.shift.type != null;
}

Player.prototype.pushing = function() {
	return this.pieces.shift.type == 'push';
}

Player.prototype.retreating = function() {
	return this.pieces.shift.type == 'retreat';
}

Player.prototype.rushing = function() {
	return this.pieces.shift.type == 'rush';
}

Player.prototype.canRush = function() {
	return !this.shifting() || this.rushing();
}

/// BATTLES

Player.prototype.startPushRushBattle = function() {
	this.board.startBattle(this, 'push-rush');
}

Player.prototype.battling = function() {
	return this.board.players.battle.starter == this;
}

Player.prototype.checkClearBattle = function() {
	if (this.board.battling() && !this.shifting()) {
		this.board.clearBattle();
	}
}

/// STATE SUMMARY

Player.prototype.clearState = function() {
	this.clearSupplyCommand();
	this.clearHinting();
}

Player.prototype.updateState = function() {
	this.checkEdges();
	this.pieces.commander.setCommand();
	Group.recomposeFor(this);
}

Player.prototype.displayState = function() {
	this.displaySupplyCommand();
	this.displayHinting();
}

/// SUPPLY and COMMAND

Player.prototype.clearSupplyCommand = function() {
	this.edges = [];
	this.paths = [];
	this.grid = this.board.createGrid();
}

Player.prototype.displaySupplyCommand = function() {
	this.displayEdges();
	this.displayPaths();
}

Player.prototype.addEdge = function(edge) {
	this.edges.push(edge);
}

Player.prototype.addPath = function(path) {
	this.paths.push(path);
}

Player.prototype.checkEdges = function() {
	this.edges.forEach(function(edge) {
		edge.checkCut();
	});
}

Player.prototype.displayEdges = function() {
	this.edges.forEach(function(edge) {
		edge.display();
	});
}

Player.prototype.displayPaths = function() {
	this.paths.forEach(function(path) {
		path.display();
	});
}

Player.prototype.setSupply = function() {
	var supplied = true;
	this.pieces.list.forEach(function(piece) {
		supplied = piece.findSupply()? supplied : false;
	}); return supplied;
}

/// HINTING

Player.prototype.clearHinting = function() {
	this.removeHinting();
	this.hints = {
			move: [],
			rush: [],
			push: [],
			follow: [],
			retreat: [],
	};
}

Player.prototype.addHint = function(type, hint) {
	this.hints[type].push(hint);
}

Player.prototype.displayHinting = function() {
	if (this.hints != null) {
		$.each(this.hints, function(type, hints) {
			hints.forEach(function(hint) {
				hint.display();
			});
		});
	}
}

Player.prototype.removeHinting = function() {
	if (this.hints != null) {
		$.each(this.hints, function(type, hints) {
			hints.forEach(function(hint) {
				hint.remove();
			});
		});
	}
}

/// DISPLAY

Player.icons = {
		size: {
			width: 25,
			margin: 2,
		},
}

Player.canvas = {
		size: {
			width: Player.icons.size.width + (2 * Player.icons.size.margin),
		},
}

Player.prototype.color = function(options) {
	options = $.extend({
		selected: this.selected(),
	}, options);
	if (options.selected) {
		return this.colors.selected;
	} else {
		return this.colors.regular;
	}
}

Player.prototype.stroke = function() {
	return this.colors.regular;
}

Player.prototype.attr = function() {
	return {
		x: Player.icons.size.margin,
		y: Player.icons.size.margin,
		fill: this.color(),
		stroke: this.stroke(),
		'class': 'player',
	};
}

Player.prototype.createDisplayWrapper = function() {
	var wrapper = $('#play-options-player-n').clone().attr('id', this.view.id);
	$('#play-options-players').append(wrapper);
}

Player.prototype.setCanvasId = function() {
	this.$('.play-options-player-canvas').attr('id', this.view.id + '-canvas');
}

Player.prototype.markLocal = function() {
	this.$().addClass('play-options-player-local');
}

Player.prototype.allowRename = function() {
	var player = this;
	this.$('.play-options-player-name').on('blur', function() {
		player.rename($(this).text());
	});
}

Player.prototype.appendSettings = function() {
	var settings = $('#play-options-player-n-settings').html().replace(/-n-/g, '-' + this.index + '-');
	this.$('.play-options-player-settings').append($(settings));
	this.markSettings();
	this.watchSettings();
}

Player.prototype.startDraw = function() {
	this.view = {};
	this.view.id = 'play-options-player-' + this.index;
	this.createDisplayWrapper();
	this.setCanvasId();
	if (this.local()) {
		this.markLocal();
		this.allowRename();
		this.appendSettings();
	}
}

Player.prototype.$ = function(selector) {
	if (typeof(selector) === 'undefined') {
		selector = '';
	} return $('#' + this.view.id + ' ' + selector);
}

Player.prototype.createCanvas = function() {
	return SVG(this.view.id + '-canvas')
	.size(Player.canvas.size.width, 4 + Player.canvas.size.width);
}

Player.prototype.draw = function() {
	var player = this;
	this.startDraw();
	this.canvas = this.createCanvas();
	this.shape = this.canvas
	.rect(Player.icons.size.width, Player.icons.size.width)
	.attr(this.attr())
//	.on('click', function() {
//		player.select({send: true});
//	}).on('mouseover', function() {
//		player.focus();
//	}).on('mouseout', function() {
//		player.blur();
//	});
}

/// DISPLAY: Settings

Player.prototype.getDisplaySettings = function(setting) {
	// Get the saved settings.
	if ((typeof(Storage) !== 'undefined') && (typeof(localStorage.display) != 'undefined')) {
		var settings = JSON.parse(localStorage.display);
	} else {
		var settings = {};
	}
	// Overwrite the default settings.
	this.display = $.extend({
		supply: 'none',
		command: 'none',
		move: 'selected',
		rush: 'selected',
		push: 'selected',
		follow: 'selected',
		retreat: 'selected',
	}, settings);
}

Player.prototype.markSettings = function() {
	var player = this;
	$.each(this.display, function(setting, value) {
		player.$('#play-options-player-' + player.index + '-' + setting + '-show-' + player.display[setting])
		.attr('checked', 'checked');
	});
}

Player.prototype.watchSettings = function() {
	var player = this;
	this.$('input').change(function() {
		var setting = $(this).attr('data-setting');
		player.updateOnSetting(setting, this.value);
	});
}

Player.prototype.putSetting = function(setting, value) {
	// Update the setting.
	this.display[setting] = value;
	// Copy rush settings to moves and retreats.
	if (setting == 'rushing') {
		this.display.moving = value;
		this.display.following = value;
		this.display.retreating = value;
	}
}

Player.prototype.updateOnSetting = function(setting, value) {
	this.putSetting(setting, value);
	localStorage.display = JSON.stringify(this.display);
	this.board.players.list.forEach(function(player) {
		// Display the player's state.
		player.displayState();
		// Display the selected piece's state.
		if (player.pieces.selected != null) {
			player.pieces.selected.showState();
		}
	});
}

/// DISPLAY: Spotlight

Player.prototype.spotlight = function() {
	return (this.display.spotlight == 'on') && this.selected();
}

/// DISPLAY: Player Status

function PlayerStatus(player) {
	this.board = player.board;
	this.player = player;
	this.name = "waiting for player";
	this.connected  = false;
	this.draw();
}

// USER DETAILS: Updates

PlayerStatus.prototype.update = function(name, connected) {
	this.board.enlist(this.player);
	this.name = name;
	this.connected = connected;
	this.display.text(name);
	this.display.css(this.css());
}

/// USER DETAILS: Drawing

PlayerStatus.prototype.opacity = function() {
	if (this.connected) {
		return 1;
	} else {
		return 0.25;
	}
}

PlayerStatus.prototype.fontWeight = function() {
	if (this.player.local()) {
		return 'bold';
	} else {
		return 'normal';
	}
}

PlayerStatus.prototype.css = function() {
	return {
		color: this.player.colors.regular,
		opacity: this.opacity(),
		'font-weight': this.fontWeight(),
	};
}

PlayerStatus.prototype.attr = function() {
	return {
		contenteditable: this.player.local(),
	};
}

PlayerStatus.prototype.draw = function() {
	this.display = this.player.$('.play-options-player-name')
	.text(this.name)
	.css(this.css())
	.attr(this.attr());
}