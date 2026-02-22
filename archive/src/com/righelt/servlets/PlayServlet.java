package com.righelt.servlets;

import static com.righelt.util.OfyService.ofy;

import java.io.IOException;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.righelt.play.Account;
import com.righelt.play.Game;
import com.righelt.play.Player;

/**
 * The servlet that starts and continues games.
 * @author Kenan
 *
 */
@SuppressWarnings("serial")
public class PlayServlet extends HttpServlet {
	
	@Override
	protected void doGet(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		String gameId = request.getParameter("game");
		Account account = Account.getAccountFor(request, response);
		if (gameId == null) {
			// Redirect to the account's current game.
			boolean start = Boolean.valueOf(request.getParameter("start"));
			account.setRedirect(start, response);
		} else {
			// Load the specified game.
			Game game = ofy().load().type(Game.class).id(Long.valueOf(gameId)).get();
			Player player = game.getPlayerFor(account);
			String channelKey = player.createChannel();
			ofy().save().entities(game, account).now();
			// Set the attributes and forward to the view.
			request.setAttribute("account", account);
			request.setAttribute("game", game);
			request.setAttribute("player", player);
			request.setAttribute("channelKey", channelKey);
			request.getRequestDispatcher("/play.jsp").forward(request, response);
		}
	}
	
}
