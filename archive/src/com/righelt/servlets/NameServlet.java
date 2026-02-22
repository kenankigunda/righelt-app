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
 * The servlet used to name players.
 * @author Kenan
 *
 */
@SuppressWarnings("serial")
public class NameServlet extends HttpServlet {

	@Override
	protected void doPost(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		String playerId = request.getParameter("player");
		String name = request.getParameter("name");
		if ((playerId != null) && (name != null)) {
			Account account = Account.getAccountFor(request, response);
			Player player = ofy().load().type(Player.class).id(Long.valueOf(playerId)).get();
			if ((player != null) && account.owns(player)) {
				player.setName(name);
				ofy().save().entities(account).now();
			}
		}
	}

}
