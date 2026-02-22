package com.righelt.util;


/**
 * A class used to seperate items in a string list.
 * @author Kenan
 *
 */
public class Seperator {

	/**
	 * The string value of this seperator.
	 */
	String seperator;
	
	/**
	 * Whether this is the first call to this seperator.
	 */
	boolean first;
		
	// CONSTRUCTION
	
	/**
	 * Creates a new seperator.
	 * @param seperator the string value of the seperator
	 */
	public Seperator(String seperator) {
		this.seperator = seperator;
		this.first = true;
	}
	
	// SEPERATING
	
	/**
	 * Indicates whether this seperator has been called at least once.
	 * @return {@code true} if the seperator has not yet been called
	 */
	public boolean isFirst() {
		return first;
	}
	
	/**
	 * Sets the flag that indicates whether this seperator has been called
	 * at least once.
	 * @param first {@code true} if the seperator has not yet been called
	 */
	private void setFirst(boolean first) {
		this.first = first;
	}
	
	/**
	 * Gets the string value of this seperator.
	 * @return the string seperator
	 */
	public String getSeperator() {
		return seperator;
	}
	
	/**
	 * Gets the string representation of this seperator.
	 * This will be an empty string if this is the first call
	 * to this method, or the {@link #getSeperator() seperator} 
	 * otherwise.
	 * @return the seperator as a string
	 */
	@Override
	public String toString() {
		if (isFirst()) {
			setFirst(false);
			return "";
		} else {
			return getSeperator();
		}
	}
	
}
