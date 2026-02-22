function Hint(source, target) {
	this.board = source.board;
	this.player = source.player;
	this.player.addHint(this.type(), this);
	// Record the endpoints.
	this.source = source;
	this.target = target;
	// Display the hint, potentially lazily.
	this.display();
}

/// IDENTIFICATION
/// Must be overridden by implementing class.

Hint.prototype.type = function() {
	return undefined;
}

/// ACTIONS

Hint.prototype.select = function() {
	if (!this.player.agent()) return;
	this.target.select();
}

Hint.prototype.focus = function() {
	if (!this.player.agent()) return;
	$('#play-messages-point').text(this.toString());
	this.source.startPreview(this);
	this.shape.attr(this.attrOnFocus());
	this.moreOnFocus();
}

Hint.prototype.blur = function() {
	if (!this.player.agent()) return;
	$('#play-messages-point').text('');
	this.source.endPreview(this);
	this.shape.attr(this.attr());
	this.moreOnBlur();
}

// More stuff, by subclasses.
Hint.prototype.moreOnFocus = function () {};
Hint.prototype.moreOnBlur = function() {};

/// DISPLAY

Hint.prototype.display = function() {
	if (this.board.players.local.display[this.type()] == 'all') {
		this.show();
	} else {
		this.hide();
	}
}

Hint.prototype.show = function() {
	this.draw();
}

Hint.prototype.hide = function() {
	this.remove();
}

/// POINTS

Hint.prototype.sourcePoint = function() {
	return this.source.point;
}

Hint.prototype.targetPoint = function() {
	return this.target;
}

/// DRAWING

Hint.prototype.attr = function() {
	return {
		'fill-opacity': 0,
		'stroke-width': '1px',
	};
}

Hint.prototype.attrOnFocus = function() {
	return {
		'fill-opacity': 1,
		'stroke-width': '2px',
	};
}

Hint.prototype.startDraw = function() {
	return this.source.startDraw();
}

Hint.prototype.draw = function() {
	var hint = this;
	this.shape = this.startDraw()
	.attr(this.source.attr({point: this.targetPoint(), state: 'hint'}))
	.attr(this.attr())
	.on('click', function() {
		hint.select();
	}).on('mouseover', function() {
		hint.focus();
	}).on('mouseout', function() {
		hint.blur();
	});
}

Hint.prototype.remove = function() {
	if (this.shape != null) {
		this.shape.remove();
	}
}

/// STRINGS

Hint.prototype.toString = function() {
	return this.type() + ' ' + this.sourcePoint() + ' ' + this.targetPoint();
}