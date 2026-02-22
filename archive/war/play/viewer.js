function Viewer(board) {
	this.board = board;
	this.index = Player.local();
	// Set the colors.
	this.colors = {
		regular: 'grey',
	}
	// Set the display options.
	this.getDisplaySettings();
	// Draw the viewer.
	this.draw();
	// Set the viewer status.
	this.status = new ViewerStatus(this);
}

/// LOCALITY

Viewer.prototype.local = Player.prototype.local;

/// IDENTIFICATION

Viewer.prototype.rename = Player.prototype.rename;

/// DISPLAY

Viewer.prototype.focus = function() {};
Viewer.prototype.blur = function() {};

Viewer.prototype.attr = function() {
	return {
		x: Player.icons.size.margin,
		y: Player.icons.size.margin,
		fill: this.colors.regular,
		stroke: this.colors.regular,
		'class': 'player viewer',
	};
}

Viewer.prototype.createDisplayWrapper = Player.prototype.createDisplayWrapper;

Viewer.prototype.setCanvasId = Player.prototype.setCanvasId;

Viewer.prototype.markLocal = Player.prototype.markLocal;

Viewer.prototype.allowRename = Player.prototype.allowRename;

Viewer.prototype.appendSettings = Player.prototype.appendSettings;

Viewer.prototype.startDraw = Player.prototype.startDraw;

Viewer.prototype.$ = Player.prototype.$;

Viewer.prototype.createCanvas = Player.prototype.createCanvas;

Viewer.prototype.draw = Player.prototype.draw;

/// DISPLAY: Settings

Viewer.prototype.getDisplaySettings = Player.prototype.getDisplaySettings;

Viewer.prototype.markSettings = Player.prototype.markSettings;

Viewer.prototype.watchSettings = Player.prototype.watchSettings;

Viewer.prototype.putSetting = Player.prototype.putSetting;

Viewer.prototype.updateOnSetting = Player.prototype.updateOnSetting;

/// DISPLAY: Viewer Status

function ViewerStatus(viewer) {
	PlayerStatus.call(this, viewer);
}

ViewerStatus.prototype = Object.create(PlayerStatus.prototype);
ViewerStatus.prototype.constructor = ViewerStatus;