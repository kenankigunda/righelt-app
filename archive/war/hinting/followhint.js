function FollowHint(source, target) {
	Hint.call(this, source, target);
}

FollowHint.prototype = Object.create(Hint.prototype);
FollowHint.prototype.constructor = FollowHint;

/// TYPE

FollowHint.prototype.type = function() {
	return 'follow';
}