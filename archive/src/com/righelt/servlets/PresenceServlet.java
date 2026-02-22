package com.righelt.servlets;

import java.io.IOException;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.google.appengine.api.channel.ChannelPresence;
import com.google.appengine.api.channel.ChannelService;
import com.google.appengine.api.channel.ChannelServiceFactory;
import com.righelt.play.Game;

/**
 * The servlet that tracks the presence of clients, 
 * i.e. tracks client connections and disconnections.
 * @author Kenan
 *
 */
@SuppressWarnings("serial")
public class PresenceServlet extends HttpServlet {

	@Override
	protected void doPost(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
		ChannelService channels = ChannelServiceFactory.getChannelService();
		ChannelPresence presence = channels.parsePresence(request);
		Game.markPresence(presence);
	}

}
