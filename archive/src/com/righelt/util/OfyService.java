package com.righelt.util;

import com.googlecode.objectify.Objectify;
import com.googlecode.objectify.ObjectifyFactory;
import com.googlecode.objectify.ObjectifyService;
import com.righelt.play.Account;
import com.righelt.play.Game;
import com.righelt.play.Player;

/**
 * The service used to register application classes for use with Objectify.
 * @author Kenan
 *
 */
public class OfyService {

	/**
	 * Register the Objectify classes.
	 */
	static {
		factory().register(Account.class);
		factory().register(Game.class);
		factory().register(Player.class);
	}
	
	/**
	 * The Objectify service used to load and save wordbook entities.
	 * @return the service
	 */
    public static Objectify ofy() {
        return ObjectifyService.ofy();
    }

    /**
     * The Objectify factory used to register wordbook entity classes.
     * @return the factory
     */
    public static ObjectifyFactory factory() {
        return ObjectifyService.factory();
    }
	
}
