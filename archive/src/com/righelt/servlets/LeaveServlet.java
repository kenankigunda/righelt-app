package com.righelt.servlets;

import static com.righelt.util.OfyService.ofy;

import java.io.IOException;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.righelt.play.Account;
import com.righelt.play.Player;

/**
 * The servlet used by players to leave a game.
 * @author Kenan
 *
 */
@SuppressWarnings("serial")
public class LeaveServlet extends HttpServlet {

	@Override
	protected void doGet(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		String playerId = request.getParameter("player");
		boolean open = Boolean.valueOf(request.getParameter("open")); 
		if (playerId != null) {
			Account account = Account.getAccountFor(request, response);
			Player player = ofy().load().type(Player.class).id(Long.valueOf(playerId)).get();
			if ((player != null) && account.owns(player)) {
				player.quit();
				ofy().save().entities(account, player.getGame()).now();
				if (open) {
					account.setRedirect(response);
				}
			}
		}
	}
	
	@Override
	protected void doPost(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		doGet(request, response);
	}

}
