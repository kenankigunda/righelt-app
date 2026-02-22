package com.righelt.play;

import static com.righelt.util.OfyService.ofy;

import java.io.IOException;
import java.util.LinkedList;
import java.util.List;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import com.google.appengine.api.users.User;
import com.google.appengine.api.users.UserServiceFactory;
import com.googlecode.objectify.Key;
import com.googlecode.objectify.Ref;
import com.googlecode.objectify.annotation.Cache;
import com.googlecode.objectify.annotation.Entity;
import com.googlecode.objectify.annotation.Id;
import com.googlecode.objectify.annotation.Index;
import com.googlecode.objectify.annotation.Load;
import com.googlecode.objectify.annotation.OnSave;
import com.googlecode.objectify.annotation.Serialize;
import com.righelt.util.RefIterable;
import com.righelt.util.Sessions;

/**
 * An account containing the information of a user of the app.
 * @author Kenan
 *
 */
@Entity @Cache
public class Account extends AbstractGameObject<Account> {

	/**
	 * The id of this account.
	 */
	@Id private Long id;
		
	/**
	 * The preferred name of the user.
	 */
	private String name = "anonymous";
	
	/**
	 * The Google user linked to this account.
	 */
	@Serialize private User googleUser;
	
	/**
	 * The id of the Google user linked to this account.
	 */
	@Index private String googleId;
	
	/**
	 * The player instances indicating this account's involvement in games.
	 */
	@Load private List<Ref<Player>> players = new LinkedList<>();
	
	// CONSTRUCTION
	
	/**
	 * A no-argument constructor for Objectify.
	 */
	private Account() {
	}
	
	/**
	 * Creates a new account.
	 * @return the new account
	 */
	public static Account create() {
		Account account = new Account();
		ofy().save().entities(account).now();
		return account;
	}
	
	// IDENTIFICATION
	
	/**
	 * Gets the id of this account.
	 * @return the account id
	 */
	public long getId() {
		return id;
	}
	
	/**
	 * Gets the preferred name for this account.
	 * @return the preferred name
	 */
	public String getName() {
		return name;
	}
	
	/**
	 * Sets the preferred name for this account.
	 * @param name the name to set as the preferred name
	 */
	public void setName(String name) {
		this.name = name;
	}
	
	// LINK TO GOOGLE
	
	/**
	 * Links this account to a Google user.
	 * @param googleUser the Google user to link
	 */
	public void link(User googleUser) {
		this.googleUser = googleUser;
	}
	
	/**
	 * Gets the Google user linked to this account.
	 * @return the linked Google user, or {@code null} if there is no link to Google
	 */
	public User getGoogleUser() {
		return googleUser;
	}
	
	/**
	 * Sets the linked Google id from the {@link #getGoogleUser() linked Google user}.
	 */
	@OnSave
	private void setGoogleId() {
		if (getGoogleUser() != null) {
			this.googleId = getGoogleUser().getUserId();
		}
	}

	// GAME INVOLVEMENT
	
	/**
	 * Gets the references to the players under this account,
	 * indexed by their ids.
	 * @return the player reference map
	 */
	private List<Ref<Player>> getPlayerRefs() {
		return players;
	}
	
	/**
	 * Gets the players under this account.
	 * @return an iteration over the players
	 */
	public Iterable<Player> getPlayers() {
		return new RefIterable<>(getPlayerRefs());
	}
		
	/**
	 * Adds a player instance to this account.
	 * @param player the player to add
	 */
	protected void add(Player player) {
		getPlayerRefs().add(Ref.create(player));
	}
	
	/**
	 * Removes a player instance from this account.
	 * @param player the player to remove
	 */
	protected void remove(Player player) {
		getPlayerRefs().remove(Ref.create(player));
	}
	
	/**
	 * Indicates whether this account owns the given player.
	 * @param player this player to check against this account
	 * @return {@code true} if this account owns that player
	 */
	public boolean owns(Player player) {
		return this.getId() == player.getAccount().getId();
	}
	
	/**
	 * Gets the current game of this account.
	 * If {@code start} is {@code true}, then the account will start a new game.
	 * Otherwise, this account will return the game that it most recently joined.
	 * If the account has not joined any games, then the account will start a new game.
	 * @param start whether to force a new game
	 * @return the account's current game
	 */
	public Game getGame(boolean start) {
		if (getPlayerRefs().isEmpty() || start) {
			Game game = Game.createFor(this);
			ofy().save().entities(game, this).now();
			return game;
		} else {
			Player player = getPlayerRefs().get(getPlayerRefs().size() - 1).get();
			return player.getGame();
		}
	}
	
	/**
	 * Sets the redirect to the current game of this account.
	 * @param start whether to force a new game
	 * @param response the response to redirect
	 * @throws IOException if the redirect cannot be set
	 * @see #getGame(boolean)
	 */
	public void setRedirect(boolean start, HttpServletResponse response) throws IOException {
		Game game = getGame(start);
		response.sendRedirect(response.encodeRedirectURL("/play?game=" + game.getId()));
	}
	
	/**
	 * Sets the redirect to the current game of this account.
	 * This method will not force a new game.
	 * @param response the response to redirect
	 * @throws IOException if the redirect cannot be set
	 */
	public void setRedirect(HttpServletResponse response) throws IOException {
		setRedirect(false, response);
	}
		
	// STORAGE and RETRIEVAL

	/**
	 * Gets the account corresponding to the given request and response.
	 * If no account exists for the request, a new one will be created.
	 * @param request the request to get the account for
	 * @param response the response corresponding to that request
	 * @return the account for that request
	 */
	public static Account getAccountFor(HttpServletRequest request, HttpServletResponse response) {
		Account account = getGoogleAccount();
		if (account == null) {
			HttpSession session = Sessions.initializeFor(request, response);
			account = getSessionAccount(session);
			if (account == null) {
				account = createSessionAccount(session);
			}
		}		
		return account;
	}
	
	/**
	 * Gets the current Google account.
	 * @return the Google account, or {@code null} if no Gogle user is logged in
	 */
	private static Account getGoogleAccount() {
		User user = UserServiceFactory.getUserService().getCurrentUser();
		if (user == null) {
			return null;
		} else {
			return ofy().load().type(Account.class)
					.filter("googleId", user.getUserId())
					.first().get();
		}
	}
	
	/**
	 * Gets the account in the given session.
	 * @param session the session to retrieve the account from
	 * @return the account in that session, or {@code null} if the session has no account
	 */
	private static Account getSessionAccount(HttpSession session) {
		String saved = (String) session.getAttribute("account");
		if (saved == null) {
			return null;
		} else {
			Key<Account> key = Key.<Account>create(saved);
			return ofy().load().key(key).get();
		}
	}
	
	/**
	 * Creates a new account for the given session.
	 * @param session the session to create the account in
	 * @return the new session account
	 */
	private static Account createSessionAccount(HttpSession session) {
		Account account = Account.create();
		session.setAttribute("account", Key.create(account).getString());
		return account;
	}
	
}
