function PushHint(source, target) {
	Hint.call(this, source, target);
	this.size = {
			scale: 1.4,
	}
}

PushHint.prototype = Object.create(Hint.prototype);
PushHint.prototype.constructor = PushHint;

/// IDENTIFICATION

PushHint.prototype.type = function() {
	return 'push';
}

/// POINTS

PushHint.prototype.targetPoint = function() {
	return this.target.point;
}

/// DRAWING

PushHint.prototype.bigSize = function() {
	return this.size.scale * this.source.size.width;
}

PushHint.prototype.normalSize = function() {
	return this.source.size.width;
}

PushHint.prototype.startDraw = function() {
	return Hint.prototype.startDraw.call(this).size(this.bigSize(), this.bigSize());
}

PushHint.prototype.moreOnFocus = function() {
	this.shape.size(this.normalSize(), this.normalSize());
}

PushHint.prototype.moreOnBlur = function() {
	this.shape.size(this.bigSize(), this.bigSize());
}