package com.righelt.play;

import static com.righelt.util.OfyService.ofy;

import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;

import com.google.appengine.api.channel.ChannelMessage;
import com.google.appengine.api.channel.ChannelPresence;
import com.google.appengine.api.channel.ChannelService;
import com.google.appengine.api.channel.ChannelServiceFactory;
import com.googlecode.objectify.Ref;
import com.googlecode.objectify.annotation.Cache;
import com.googlecode.objectify.annotation.Entity;
import com.googlecode.objectify.annotation.Id;
import com.googlecode.objectify.annotation.Load;
import com.righelt.util.RefIterable;
import com.righelt.util.Seperator;

/**
 * A class that represents a single game of righelt.
 * @author Kenan
 *
 */
@Entity @Cache
public class Game extends AbstractGameObject<Game>{

	/**
	 * The game id.
	 */
	@Id private Long id;

	/**
	 * The maximum number of acting players.
	 */
	private int maxAgents = 2;
		
	/**
	 * The game agents, who can change the game state.
	 */
	@Load private List<Ref<Player>> agents = new LinkedList<>();
	
	/**
	 * The game viewers, who cannot change the game state.
	 */
	@Load private List<Ref<Player>> viewers = new LinkedList<>();
	
	/**
	 * The game moves.
	 */
	private List<String> moves = new LinkedList<>();
	
	// CONSTRUCTION
	
	/**
	 * A no-argument constructor for Objectify.
	 */
	private Game() {
		
	}
	
	/**
	 * Creates a new game.
	 * @param creator the account creating the game
	 * @return the new game
	 */
	public static Game createFor(Account creator) {
		Game game = new Game();
		ofy().save().entities(game).now();
		game.add(creator);
		return game;
	}
		
	// IDENTIFICATION
	
	/**
	 * Gets the id of this game.
	 * @return the game id
	 */
	public long getId() {
		return id;
	}

	// AGENTS

	/**
	 * Gets the maximum number of agents allowed in this game.
	 * @return the max agent count
	 */
	public int getMaxAgents() {
		return maxAgents;
	}
	
	/**
	 * Gets the index of the first empty agent slot.
	 * @return the empty index
	 */
	public int getEmptyAgentIndex() {
		int index = 0;
		boolean empty = false;
		Iterator<Ref<Player>> agents = getAgentRefs().iterator();
		while (!empty && agents.hasNext()) {
			empty = agents.next() == null;
			if (!empty) index++;
		} return index;
	}
	
	/**
	 * Gets the number of agents enlisted in this game.
	 * @return the agent count
	 */
	public int getNumAgents() {
		int count = 0;
		for (Ref<Player> agent : getAgentRefs()) {
			if (agent != null) {
				count++;
			}
		} return count;
	}
	
	/**
	 * Indicates whether this game can add new agents.
	 * @return {@code true} if there is room for agents
	 */
	private boolean canAddAgents() {
		return getNumAgents() < getMaxAgents();
	}
	
	/**
	 * Gets the references to the game agents.
	 * @return the agent reference list
	 */
	private List<Ref<Player>> getAgentRefs() {
		return agents;
	}
	
	/**
	 * Gets the game agents, who can both view and change the game state.
	 * @return an iteration over the agents
	 */
	private Iterable<Player> getAgents() {
		return new RefIterable<>(getAgentRefs());
	}
	
	/**
	 * Adds an agent to this game.
	 * @param player the player to add as an agent
	 */
	private void addAgent(Player player) {
		int index = getEmptyAgentIndex();
		if (index < getAgentRefs().size()) {
			getAgentRefs().set(getEmptyAgentIndex(), Ref.create(player));
		} else {
			getAgentRefs().add(Ref.create(player));
		}
	}
		
	/**
	 * Returns the versus string that indicates the agents in this game.
	 * @return the versus string
	 */
	public String getVersus() {
		if (getNumAgents() < 1) {
			return "no players";
		} else {
			Seperator seperator = new Seperator(" vs ");
			StringBuilder versus = new StringBuilder();
			for (Player agent : getAgents()) {
				if (agent != null) {
					versus.append(seperator);
					versus.append(agent.getName());
				}
			} return versus.toString();
		}
		
	}
	
	// VIEWER

	/**
	 * Gets the number of viewers enlisted in this game.
	 * @return the viewer count
	 */
	public int getNumViewers() {
		return getViewerRefs().size();
	}
	
	/**
	 * Gets the references to the game viewers.
	 * @return the viewer reference list
	 */
	private List<Ref<Player>> getViewerRefs() {
		return viewers;
	}
	
	/**
	 * Gets the game viewer, which can view but cannot change the game state.
	 * @return an iteration over the viewers
	 */
	@SuppressWarnings("unused")
	private Iterable<Player> getViewers() {
		return new RefIterable<>(getViewerRefs());
	}
	
	/**
	 * Adds an viewer to this game.
	 * @param player the player to add as an viewer
	 */
	private void addViewer(Player player) {
		getViewerRefs().add(Ref.create(player));
	}

	// PLAYERS and ACCOUNTS
	
	/**
	 * Gets the index of the next player to enlist in this game.
	 * @return the next index
	 */
	private int getNextIndex() {
		int index = getEmptyAgentIndex();
		if (index < getMaxAgents()) {
			return index;
		} else {
			return getMaxAgents() + getNumViewers();
		}
	}
	
	/**
	 * Gets the total number of game players, including both agents and viewers.
	 * @return the player count
	 */
	public int getNumPlayers() {
		return getNumAgents() + getNumViewers();
	}
	
	/**
	 * Gets the game players, including both agents and viewers.
	 * @return an iteration over the agents and viewers
	 */
	private Iterable<Player> getPlayers() {
		List<Ref<Player>> playerRefs = new LinkedList<>();
		playerRefs.addAll(getAgentRefs());
		playerRefs.addAll(getViewerRefs());
		return new RefIterable<>(playerRefs);
	}
		
	/**
	 * Adds a player to this game.
	 * @param player the player to add
	 */
	private void add(Player player) {
		if (canAddAgents()) {
			addAgent(player);
		} else {
			addViewer(player);
		}
	}
	
	/**
	 * Adds an account to this game.
	 * @param account the account to add
	 * @return the player for that account, or {@code null} if the account could
	 * not be added
	 */
	public Player add(Account account) {
		Player player = Player.createFor(account, this, getNextIndex());
		add(player);
		account.add(player);
		return player;
	}
	
	/**
	 * Gets the game player owned by the given account.
	 * @param account the account to get the player for
	 * @return the player corresponding to that account, or {@code null} if there is no such player
	 */
	public Player getPlayerFor(Account account) {
		Iterator<Player> players = getPlayers().iterator();
		Player player = null;
		boolean found = false;
		// Look for a match.
		while (players.hasNext() && !found) {
			player = players.next();
			if (player != null) {
				found = account.owns(player);
			}
		}
		// Return the match.
		if (found) {
			return player;
		} else {
			// If no match, add the account.
			return add(account);
		}
	}
	
	/**
	 * Removes a player from this game.
	 * @param player the player to remove
	 */
	public void remove(Player player) {
		// Remove the player.
		if (player.isAgent()) {
			getAgentRefs().set(player.getIndex(), null);
		} else {
			getViewerRefs().remove(player.getIndex() - getMaxAgents());
		}
		// Delete empty games.
		if (getNumPlayers() == 0) {
			ofy().delete().entities(this);
		}
	}
	
	// CHANNELS
	
	/**
	 * Creates a channel for the given player.
	 * @param player the player to create the channel for
	 * @return the new channel key for that player
	 */
	protected String createChannelFor(Player player) {
		ChannelService channels = ChannelServiceFactory.getChannelService();
		return channels.createChannel(getChannelKey(player));
	}
	
	/**
	 * Gets the channel key for the given player.
	 * @param player the player to retrieve the channel key for
	 * @return the channel key for that player
	 */
	private String getChannelKey(Player player) {
		return getId() + "-" + player.getId();
	}
		
	// CONNECTIONS
	
	/**
	 * Marks the given client presence.
	 * @param presence indicates which client's presence has changed
	 * @return the game corresponding to the presence change
	 */
	public static Game markPresence(ChannelPresence presence) {
		String[] tokens = presence.clientId().split("-");
		long gameId = Long.valueOf(tokens[0]);
		long playerId = Long.valueOf(tokens[1]);
		Game game = ofy().load().type(Game.class).id(gameId).get();
		Player player = ofy().load().type(Player.class).id(playerId).get();
		if ((game != null) && (player != null)) {
			game.markPresence(presence, player);
		} return game;	
	}
	
	/**
	 * Marks the presence of the player at the given index.
	 * @param presence indicates whether the player is connected or disconnected
	 * @param source the player whose presence is being marked
	 */
	private void markPresence(ChannelPresence presence, Player source) {
		source.setConnected(presence.isConnected());
		ofy().save().entities(source).now();
		// Broadcast the new state to all players.
		broadcast(source.getPresenceMessage());
		// Send the states of the other players to a newly connected player.
		if (presence.isConnected()) {
			for (Player player : getPlayers()) {
				if ((player != null) && (player.getId() != source.getId())) {
					send(source, player.getPresenceMessage());
				}
			}
		}
	}
	
	// MESSAGES
	
	/**
	 * Sends a message to a player.
	 * @param target the player to send to
	 * @param message the message to send to that player
	 */
	private void send(Player target, String message) {
		ChannelService channels = ChannelServiceFactory.getChannelService();
		String channelKey = getChannelKey(target);
		channels.sendMessage(new ChannelMessage(channelKey, message));
	}
	
	/**
	 * Broadcasts a message from one player to all the other players.
	 * @param source the player who originated the message
	 * @param message the message to send to the other players
	 */
	protected void broadcast(Player source, String message) {
		for (Player player : getPlayers()) {
			if ((player != null) && (player.getId() != source.getId())) {
				send(player, message);
			}
		}
	}
	
	/**
	 * Broadcasts a message to all players.
	 * @param message the message to send to the players
	 */
	protected void broadcast(String message) {
		for (Player player : getPlayers()) {
			if (player != null) {
				send(player, message);
			}
		}
	}
	
	// MOVES
	
	/**
	 * Gets the move list of this game.
	 * @return the move list
	 */
	public List<String> getMoves() {
		return moves;
	}
	
	/**
	 * Records a move.
	 * @param move the move to record
	 */
	protected void recordMove(String move) {
		getMoves().add(move);
	}

}
