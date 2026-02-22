<%@ page language="java" contentType="text/html; charset=UTF-8"
	pageEncoding="UTF-8"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/core" prefix="c" %>
<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<link rel="stylesheet" href="/setup/play.css" />
<link rel="stylesheet" href="/setup/account.css" />
<link rel="stylesheet" href="/play/board.css" />
<link rel="stylesheet" href="/play/piece.css" />
<link rel="stylesheet" href="/play/player.css" />
<link rel="stylesheet" href="/play/point.css" />
<link rel="stylesheet" href="/hinting/hinting.css" />
<title>play - righelt</title>
</head>
<body>
	<div id="header">
		<div class="title header-title">righelt</div>
	</div>
	<div id="content">
		<div id="info">
			<div clas s="title info-title">Game info</div>
			<div id="info-item-game">
				<span id="info-item-game-id">
					<span class="name">game id</span> <span class="value">${game.id}</span>
				</span>
				<span id="info-item-game-num-players">
					<span class="name">number of players</span> <span class="value">${game.numAgents}</span>
				</span>
				<span id="info-item-game-num-viewers">
					<span class="name">number of viewers</span> <span class="value">${game.numViewers}</span>
				</span>
				<span id="info-item-game-moves">
				<c:forEach var="move" items="${game.moves}">
					<span class="info-item-game-move"><span class="value">${move}</span></span>
				</c:forEach>
				</span>
			</div>
			<div id="info-item-player">
				<span id="info-item-player-id">
					<span class="name">player id</span> <span class="value">${player.id}</span>
				</span>
				<span id="info-item-player-index">
					<span class="name">player index</span> <span class="value">${player.index}</span>
				</span>
				<span id="info-item-player-name">
					<span class="name">player name</span> <span class="value">${player.name}</span>
				</span>
			</div>
			<div id="info-item-channel">
				<span id="info-item-channel-key">
					<span class="name">channel key</span> <span class="value">${channelKey}</span>
				</span>
			</div>
		</div>
		<div id="play">
			<div id="play-account">
				<div class="play-account-header">
					<span class="play-account-name">${account.name}</span>
				</div>
				<div class="play-account-games">
				<c:forEach var="p" items="${account.players.iterator}">
				<c:choose>
				<c:when test="${p.game.id == game.id}">
					<span id="play-account-game-${p.id}" class="play-account-game play-account-game-open">
						<span class="play-account-game-name">${p.game.id}</span>
						<span class="play-account-game-versus">${p.game.versus}</span>
						<img class="play-account-game-leave" src="/images/delete.png" data-player="${p.id}" />
					</span>
				</c:when>
				<c:otherwise>
					<span id="play-account-game-${p.id}" class="play-account-game play-account-game-closed">
					<a href="<c:url value="/play?game=${p.game.id}"/>">
						<span class="play-account-game-name">${p.game.id}</span>
						<span class="play-account-game-versus">${p.game.versus}</span>
					</a>
						<img class="play-account-game-leave" src="/images/delete.png" data-player="${p.id}" />
					</span>
				</c:otherwise>
				</c:choose>
				</c:forEach>
					<a class="play-account-game" href="<c:url value="/play?start=true"/>">new game</a>
				</div>
			</div>
			<div id="play-load">
				<div id="play-area">
					<div id="play-canvas"></div>
					<div id="play-messages">
						<span id="play-messages-point"></span>
						<span id="play-messages-push"></span>
					</div>
				</div>
				<div id="play-options">
					<div id="play-options-player-n" class="play-options-player">
						<div class="play-options-player-header">
							<span class="play-options-player-canvas"></span>
							<span class="play-options-player-title">
								<span class="play-options-player-name"></span>
							</span>
						</div>
						<div class="play-options-player-settings"></div>
					</div>
					<div id="play-options-player-n-settings" class="play-options-player-settings">
						<div class="play-options-player-setting" id="play-options-player-n-setting-supply-show">
							<div class="play-options-player-setting-title">
								show supply paths
							</div>
							<div class="player-options-player-setting-options">
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-supply-show" id="play-options-player-n-supply-show-none" data-setting="supply" value="none" />
									<label for="play-options-player-n-supply-show-none">none</label>
								</span>
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-supply-show" id="play-options-player-n-supply-show-selected" data-setting="supply" value="selected" />
									<label for="play-options-player-n-supply-show-selected">selected</label>
								</span>
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-supply-show" id="play-options-player-n-supply-show-all" data-setting="supply" value="all" />
									<label for="play-options-player-n-supply-show-all">all</label>
								</span>
							</div>
						</div>
						<div class="play-options-player-setting" id="play-options-player-n-setting-command-show">
							<div class="play-options-player-setting-title">
								show command paths
							</div>
							<div class="player-options-player-setting-options">
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-command-show" id="play-options-player-n-command-show-none" data-setting="command" value="none" />
									<label for="play-options-player-n-command-show-none">none</label>
								</span>
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-command-show" id="play-options-player-n-command-show-selected" data-setting="command" value="selected" />
									<label for="play-options-player-n-command-show-selected">selected</label>
								</span>
								<span class="play-options-player-setting-option">
									<input type="radio" name="play-options-player-n-command-show" id="play-options-player-n-command-show-all" data-setting="command" value="all" />
									<label for="play-options-player-n-command-show-all">all</label>
								</span>
							</div>
						</div>
					</div>
					<div id="play-options-players"></div>
					<div id="play-options-actions"></div>
				</div>
				<div id="play-log"></div>
			</div>
		</div>
	</div>

<script src="//ajax.googleapis.com/ajax/libs/jquery/1.10.2/jquery.min.js"></script>

<script src="/setup/svg.min.js"></script>
<script src="/setup/start.js"></script>
<script src="/setup/account.js"></script>

<script src="/play/board.js"></script>
<script src="/play/player.js"></script>
<script src="/play/viewer.js"></script>
<script src="/play/point.js"></script>
<script src="/play/piece.js"></script>
<script src="/play/commander.js"></script>
<script src="/play/projection.js"></script>

<script src="/_ah/channel/jsapi"></script>
<script src="/channels/channel.js"></script>

<script src="/paths/edge.js"></script>
<script src="/paths/group.js"></script>
<script src="/paths/path.js"></script>
<script src="/paths/pathfinding.min.js"></script>
<script src="/paths/Queue.compressed.js"></script>

<script src="/hinting/hint.js"></script>
<script src="/hinting/movehint.js"></script>
<script src="/hinting/rushhint.js"></script>
<script src="/hinting/pushhint.js"></script>
<script src="/hinting/followhint.js"></script>
<script src="/hinting/retreathint.js"></script>

</body>
</html>