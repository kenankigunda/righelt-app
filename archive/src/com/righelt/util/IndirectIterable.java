package com.righelt.util;


import java.util.Iterator;

/**
 * A class that takes an iteration of reference objects and returns an new iteration
 * over objects targeted by those reference objects.
 * @author Kenan Kigunda
 *
 * @param <Reference> the type of the reference objects
 * @param <Target> the type of the target objects
 */
public abstract class IndirectIterable<Reference, Target> implements Iterable<Target> {

	/**
	 * The iterable that backs this iterable.
	 */
	private final Iterable<Reference> references;
	
	// CONSTRUCTION
	
	/**
	 * Creates a new indirect iterable.
	 * @param references the iterable providing the sources used to target the iteration objects
	 */
	public IndirectIterable(Iterable<Reference> references) {
		this.references = references;
	}
	
	// ITERATION
	
	/**
	 * Gets the reference iterable that backs this iterable.
	 * @return the reference iterable
	 */
	private Iterable<Reference> getReferences() {
		return references;
	}
	
	/**
	 * Gets the target object corresponding to the given reference object.
	 * @param reference the reference object used to retrieve the target
	 * @return the target object
	 */
	protected abstract Target getTarget(Reference reference);
	
	/*
	 * (non-Javadoc)
	 * @see java.lang.Iterable#iterator()
	 */
	@Override
	public Iterator<Target> iterator() {
		return new IndirectIterator();
	}

	/**
	 * An alias of {@link #iterator()} provided for use in JSPs.
	 */
	public Iterator<Target> getIterator() {
		return iterator();
	}
	
	/**
	 * An iterator that iterates over the objects targeted
	 * by a reference collection.
	 * @author Kenan Kigunda
	 *
	 */
	private class IndirectIterator implements Iterator<Target> {

		/**
		 * The iterator that backs this iterator.
		 */
		private final Iterator<Reference> iterator = getReferences().iterator();
		
		/**
		 * Gets the iterator that backs this iterator.
		 * @return the backing iterator
		 */
		private Iterator<Reference> getIterator() {
			return iterator;
		}
		
		/*
		 * (non-Javadoc)
		 * @see java.util.Iterator#hasNext()
		 */
		@Override
		public boolean hasNext() {
			return getIterator().hasNext();
		}

		/*
		 * (non-Javadoc)
		 * @see java.util.Iterator#next()
		 */
		@Override
		public Target next() {
			return getTarget(getIterator().next());
		}

		/*
		 * (non-Javadoc)
		 * @see java.util.Iterator#remove()
		 */
		@Override
		public void remove() {
			getIterator().remove();
		}
		
	}
	
}
