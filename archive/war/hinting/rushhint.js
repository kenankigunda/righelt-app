function RushHint(source, target) {
	Hint.call(this, source, target);
}

RushHint.prototype = Object.create(Hint.prototype);
RushHint.prototype.constructor = RushHint;

/// IDENTIFICATION

RushHint.prototype.type = function() {
	return 'rush';
}