package com.righelt.play;

import static com.righelt.util.OfyService.ofy;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

import com.googlecode.objectify.Ref;
import com.googlecode.objectify.annotation.Entity;
import com.googlecode.objectify.annotation.Id;
import com.googlecode.objectify.annotation.Load;

/**
 * A class that represents a player in a {@link Game}.
 * @author Kenan
 *
 */
@Entity
public class Player extends AbstractGameObject<Player> {

	/**
	 * The id of the player.
	 */
	@Id Long id;
	
	/**
	 * The parent account of this player.
	 */
	@Load private Ref<Account> account;
	
	/**
	 * The parent game of this player.
	 */
	@Load private Ref<Game> game;
	
	/**
	 * The index of the player in the game.
	 */
	private int index;
	
	/**
	 * Whether this player is connected.
	 */
	private boolean connected;
	
	// CONSTRUCTION
	
	/**
	 * A no-argument constructor for Objectify.
	 */
	private Player() {
		
	}
	
	/**
	 * Creates a new player.
	 * @param account the parent account
	 * @param game the parent game
	 * @return the new player
	 */
	public static Player createFor(Account account, Game game, int index) {
		Player player = new Player();
		player.account = Ref.create(account);
		player.game = Ref.create(game);
		player.index = index;
		ofy().save().entities(player).now();
		return player;
	}
	
	// IDENTIFICATION
	
	/**
	 * Gets the id of this player.
	 * @return the player id
	 */
	public long getId() {
		return id;
	}
		
	/**
	 * Gets the preferred name of this player.
	 * @return the preferred name
	 */
	public String getName() {
		return getAccount().getName();
	}
	
	/**
	 * Gets the encoded name of this player, for transferring through channels.
	 * @return the encoded name
	 */
	public String getEncodedName() {
		try {
			return URLEncoder.encode(getName(), "UTF-8").replace("+", "%20");
		} catch (UnsupportedEncodingException e) {
			return "error:encoding";
		}
	}
	
	/**
	 * Sets the preferred name of this player.
	 * @param name the preferred name
	 */
	public void setName(String name) {
		getAccount().setName(name);
		broadcast(getPresenceMessage());
	}
	
	// PARENTS
	
	/**
	 * Gets the parent account of this player.
	 * @return
	 */
	public Account getAccount() {
		return account.get();
	}
	
	/**
	 * Gets the parent game of this player.
	 * @return the parent game
	 */
	public Game getGame() {
		return game.get();
	}
	
	/**
	 * Gets the index of this player in the parent game.
	 * @return the index of this player in its game
	 */
	public int getIndex() {
		return index;
	}
	
	// PLAYER TYPE
	
	/**
	 * Indicates whether this player is an agent.
	 * Agents are allowed to change the game state,
	 * in contrast to viewers which can only view the game state.
	 * @return {@code true} if the player is an agent
	 */
	public boolean isAgent() {
		return getIndex() < getGame().getMaxAgents();
	}
	
	// CHANNELS
	
	/**
	 * Creates a channel to send messages to this player.
	 * @return the channel key
	 */
	public String createChannel() {
		return getGame().createChannelFor(this);
	}
	
	// CONNECTIONS
	
	/**
	 * Indicates whether this player is online.
	 * @return {@code true} if the player is online
	 */
	public boolean isConnected() {
		return connected;
	}
	
	/**
	 * Sets the flag that indicates if this player is online.
	 * @param connected {@code true} if the player is online
	 */
	public void setConnected(boolean connected) {
		this.connected = connected;
	}
	
	/**
	 * Gets the message that indicates the connection state of a player.
	 * @param connected {@code true} if the target player is connected
	 * @param index the index of the target player
	 * @return the presence message
	 */
	protected String getPresenceMessage() {
		String state;
		if (isConnected()) {
			state = "connect";
		} else {
			state = "disconnect";
		} return String.format("%1$d, players, %2$s %1$d %3$s", getIndex(), state, getEncodedName());
	}
	
	// MESSAGES
	
	/**
	 * Broadcasts a message to all other players.
	 * @param message the message to broadcast
	 */
	protected void broadcast(String message) {
		getGame().broadcast(this, message);
	}
	
	// ACTIONS

	/**
	 * Executes the given move.
	 * @param move the move to execute
	 */
	public void doMove(String move) {
		getGame().recordMove(move);
		broadcast(move);
	}

	/**
	 * Quits the parent game and deletes this player.
	 */
	public void quit() {
		getGame().remove(this);
		getAccount().remove(this);
		ofy().delete().entities(this);
	}
	
}
