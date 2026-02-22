package com.righelt.util;


import static com.righelt.util.OfyService.ofy;

import com.googlecode.objectify.Ref;

/**
 * A class that takes a collection of {@l=ink Ref references}
 * and provides an iteration over the entities targeted by the references.
 * @author Kenan Kigunda
 *
 * @param <Target> the type of entity to iterate over
 */
public class RefIterable<Target> extends IndirectIterable<Ref<Target>, Target> {

	/**
	 * Creates a new reference iterable.
	 * @param references the references to the target entities
	 */
	public RefIterable(Iterable<Ref<Target>> references) {
		super(references);
	}
		
	/*
	 * (non-Javadoc)
	 * @see wordbook.tools.IndirectIterable#getTarget(java.lang.Object)
	 */
	@Override
	protected Target getTarget(Ref<Target> reference) {
		if (reference == null) {
			return null;
		} else {
			Target target = null;
			try {
				// Get the value from the reference.
				target = reference.get();
			} catch (IllegalStateException e) {
				// The value has not been initialized.
				// Load the value.
				target = ofy().load().ref(reference).get();
			} return target;
		}
	}
	
}
