package com.righelt.util;

import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

/**
 * A utility class for persistent sessions.
 * @author Kenan
 *
 */
public class Sessions {

	/**
	 * The expiry time of persistent sessions, in seconds.
	 */
	public static int EXPIRY = 2 * 7 * 24 * 60 * 60;
	
	/**
	 * Initalizes persistent sessions for the given request and response.
	 * @param request the servlet request
	 * @param response the servlet response
	 */
	public static HttpSession initializeFor(HttpServletRequest request, HttpServletResponse response) {
		HttpSession session = request.getSession();
		session.setMaxInactiveInterval(EXPIRY);
		String sessionId = session.getId();
		Cookie persistentSessionCookie = new Cookie("JSESSIONID", sessionId);
		persistentSessionCookie.setPath("/");
		persistentSessionCookie.setMaxAge(EXPIRY);
		response.addCookie(persistentSessionCookie);
		return session;
	}
	
}
