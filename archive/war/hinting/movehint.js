function MoveHint(source, target) {
	Hint.call(this, source, target);
}

MoveHint.prototype = Object.create(Hint.prototype);
MoveHint.prototype.constructor = MoveHint;

/// IDENTIFICATION

MoveHint.prototype.type = function() {
	return 'move';
}