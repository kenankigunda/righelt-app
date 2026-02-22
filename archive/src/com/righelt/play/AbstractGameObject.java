package com.righelt.play;

import static com.righelt.util.OfyService.ofy;

import java.util.List;

/**
 * The base implementation of {@link GameObject}.
 * @author Kenan
 *
 */
public abstract class AbstractGameObject<T extends AbstractGameObject<T>> implements GameObject {

	// RETRIEVAL
	
	/*
	 * (non-Javadoc)
	 * @see com.righelt.play.GameObject#getAll()
	 */
	@SuppressWarnings("unchecked")
	@Override
	public List<T> getAll() {
		return (List<T>) ofy().load().type(this.getClass()).list();
	}
	
	// COMPARISON
	
	/**
	 * Indicates whether that object should be considered equal to this one.
	 * The object is equal if it is also a {@link GameObject} and has the same {@link #getId() id}.
	 * @return {@code true} if that object should be considered equal to this one
	 */
	@SuppressWarnings("unchecked")
	@Override
	public boolean equals(Object that) {
		if (that == this) {
			return true;
		} else if (!(that.getClass().equals(this.getClass()))) {
			return false;
		} else {
			return ((AbstractGameObject<T>)that).getId() == this.getId();
		}
	}
	
	/*
	 * (non-Javadoc)
	 * @see java.lang.Object#hashCode()
	 */
	@Override
	public int hashCode() {
		return (int) (524287 + 524287 * getId());
	}
	
}
