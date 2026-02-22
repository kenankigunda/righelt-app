function Group() {
	this.pieces = [];
}

Group.prototype.add = function(piece) {
	this.pieces.push(piece);
	piece.group = this;
}

Group.prototype.strength = function() {
	return this.pieces.length;
}

Group.prototype.toString = function() {
	return this.pieces.toString();
}

Group.recomposeFor = function(player) {
	$.each(player.pieces.list, function(index, piece) {
		piece.findGroup();
	});
}

Group.recomposeFrom = function(start) {
	// The out-group queue is the queue from which the different groups will be formed.
	var outgroup = new Queue();
	// The in-group queue is the queue from which pieces will be added to a group.
	var ingroup = new Queue();
	// Begin with the start piece.
	outgroup.enqueue(start);
	while (!outgroup.isEmpty()) {
		var node = outgroup.dequeue();
		// Ignore pieces which are already grouped.
		if (node.group == null) {
			// Start a new group.
			var group = new Group();
			ingroup.enqueue(node);
			while (!ingroup.isEmpty()) {
				// Add the next in-group piece to the group.
				var piece = ingroup.dequeue();
				group.add(piece);
				// Find the next in-group and out-group pieces.
				piece.forEdges(function(edge) {
					var child = edge.across(piece);
					// Ignore pieces which are already grouped.
					if (child.group == null) {
						if (piece.isAdjacentTo(child)) {
							// Children which are adjacent on the board are in-group.
							ingroup.enqueue(child);
							console.log(piece + ' ingroups ' + child);
						} else {
							// Children which are distant on the board are out-group.
							outgroup.enqueue(child);
							console.log(piece + ' outgroups ' + child);
						}
					}
				});
			}
		}
	}
}