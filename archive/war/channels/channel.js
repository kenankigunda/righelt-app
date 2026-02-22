function Channel(board) {
	this.board = board;
	board.channel = this;
	this.key = $('#info-item-channel-key .value').text();
	this.channel = new goog.appengine.Channel(this.key);
	this.socket = this.channel.open();
	this.connected = false;
	this.queue = [];
	// Set the callbacks.
	var self = this;
	this.socket.onmessage = function(message) {
		self.onMessage(message);
	};
	this.socket.onopen = function() {
		self.onOpen();
	};
}

/// CHANNEL START

// Initializes the game state.
Channel.prototype.init = function() {
	// Read the game moves.
	var self = this;
	$('.info-item-game-move .value').each(function() {
		var message = {};
		message.data = $(this).text().trim();
		self.onMessage(message);
	});
	// Load the page in.
	window.setTimeout(function() {
		$('#play-load').css('opacity', '1');
	}, 200);
}

// Responds when the channel opens.
Channel.prototype.onOpen = function() {
	this.connected = true;
}

/// CHANNEL MESSAGES
/// agent, domain, action[, patient]
///
/// agent - the index of the player who instigated the action
/// domain - the type of entity affected by the action, e.g. players, pieces
/// action - the action to perform, e.g. select (a player) or rushing (a piece)
/// patient - the index of the player who is affected by the action

// Records a message in the game log.
Channel.prototype.log = function(message) {
	// Log the message.
	console.log(message);
	// Write piece actions to the play log.
	var tokens = message.split(/\s*,\s*/);
	var domain = tokens[1];
	if (domain == 'pieces') {
		var action = tokens[2];
		var patient = parseInt(tokens[3])
		$('#play-log').append('<div class="play-log-player-' +  patient + '">' + action + '</div>');
		// Set the player log entry color.
		$('.play-log-player-' + patient).css('color', this.board.players.list[patient].colors.regular);
	}
}

// Send a message to the server.
Channel.prototype.send = function(data) {
	data = $.extend({
		target: '/move',
		message: 'null',
	}, data);
	// Prepare the message.
	data.player = $('#info-item-player-id .value').text().trim();
	data.index = $('#info-item-player-index .value').text().trim();
	// Send the message.
	data.message = data.index + ', ' + data.message;
	$.post(data.target, data);
	// Log the message.
	this.log(data.message);
}

// Send a player action.
Channel.prototype.playersSend = function(type, index, details) {
	if (typeof(details) === 'undefined') {
		details = '';
	}
	this.send({
		message: 'players, ' + type + ' ' + index + ' ' + details,
	});
}

// Send a player rename.
Channel.prototype.playersName = function(index, name) {
	this.send({
		target: '/name',
		index: index,
		name: name,
		message: 'players, rename ' + index + ' ' + escape(name),
	});
}

// Send a piece action.
Channel.prototype.piecesSend = function(type, piece, point) {
	this.pointsSend(type, piece.player, piece.point, point);
}

Channel.prototype.pointsSend = function(type, player, source, target) {
	var start = this.piecesPoint(source);
	var end = this.piecesPoint(target);
	var action = 'pieces, ' + type + start + end;
	var patient = player.index;
	var message = action + ", " + patient;
	this.send({
		message: message,
	});
}

/// TODO: Remove queue?
// Queue an action to be sent with the next piece action.
Channel.prototype.piecesQueue = function(type, piece, point) {
	this.pointsQueue(type, piece.player, piece.point, point);
}

Channel.prototype.pointsQueue = function(type, player, source, target) {
	var start = this.piecesPoint(source);
	var end = this.piecesPoint(target);
	var action = 'pieces, ' + type + start + end;
	var patient = player.index;
	var message = action + ", " + patient;
	this.queue.push(message);
}

Channel.prototype.sendQueued = function() {
	var channel = this;
	this.queue.forEach(function(message) {
		window.setTimeout(function() {
			channel.send({
				message: message,
			});
		}, 200);
	});
	this.queue = [];
}

// Interpret an optional point.
Channel.prototype.piecesPoint = function(point) {
	if (typeof(point) === 'undefined') {
		return '';
	} else {
		return ' ' + point.toString();
	}
}

// Receive a message from the server.
Channel.prototype.onMessage = function(message) {
	// Log the message.
	var command = message.data.trim();
	this.log(command);
	// Parse the message.
	var tokens = command.split(/\s*,\s*/);
	var handler;
	switch (tokens[1]) {
	case "players":
		handler = this.playersReceive; 
		break;
	case "pieces":
		handler = this.piecesReceive; 
		break;
	} handler.call(this, tokens[2]);
}

// Receive a player action.
Channel.prototype.playersReceive = function(action) {
	var tokens = action.split(/\s+/);
	var index = parseInt(tokens[1]);
	var player = this.board.getAgentOrLocalViewer(index);
	if (player == null) return;
	switch (tokens[0]) {
	case "connect":
		player.status.update(unescape(tokens[2]), true);
		break;
	case "disconnect":
		player.status.update(unescape(tokens[2]), false);
		break;
	case "select":
		player.select();
		break;
	}
}

// Receive a piece action.
Channel.prototype.piecesReceive = function(action) {
	var tokens = action.split(/\s+/);
	var typing = tokens[0].split('.');
	var type = typing[0];
	var state = (typing.length > 1)? typing[1] : "";
	if (tokens.length > 1) {
		var oldpoint = this.board.getPoint(tokens[1]);
	} if (tokens.length > 2) {
		var newpoint = this.board.getPoint(tokens[2]);
	} this.piecesParse(type, state, oldpoint, newpoint);
}

// Parse a piece action.
Channel.prototype.piecesParse = function(type, state, oldpoint, newpoint) {
	// Interpret the move.
	var silent = {send: false};
	switch (type) {
	case 'move':
		oldpoint.piece.moveTo(newpoint, silent);
		break;
	case 'rush':
		oldpoint.piece.rushTo(newpoint, silent);
		break;
	case 'push':
		oldpoint.piece.pushTo(newpoint.piece, silent);
		break;
	case 'follow':
		oldpoint.piece.followTo(newpoint, silent);
		break;
	case 'retreat':
		oldpoint.pushed.retreatTo(newpoint, silent);
		break;
	case 'project':
		var projection = new Projection(oldpoint.piece, newpoint);
		projection.select(silent);
		projection.remove();
		break;
	}
}