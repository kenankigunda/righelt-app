package com.righelt.play;

import java.util.List;

/**
 * An interface that defines behaviour common to all righelt game classes.
 * @author Kenan
 *
 */
public interface GameObject {

	/**
	 * Gets the id of this object.
	 * @return the object id
	 */
	long getId();
	
	/**
	 * Gets all of the objects of this type from the datastore.
	 * @return the objects of this type
	 */
	List<? extends GameObject> getAll();
	
}
