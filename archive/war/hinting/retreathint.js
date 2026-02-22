function RetreatHint(source, target) {
	Hint.call(this, source, target);
}

RetreatHint.prototype = Object.create(Hint.prototype);
RetreatHint.prototype.constructor = RetreatHint;

/// IDENTIFICATION

RetreatHint.prototype.type = function() {
	return 'retreat';
}