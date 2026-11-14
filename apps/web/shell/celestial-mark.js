const moonPath = (x, y) => `M${x + 2.7} ${y - 3.5}a3.5 3.5 0 1 0 0 7 1.2 3.5 0 0 1 0-7Z`;

/** Shared presentation geometry for the page inlay and generated game favicon. */
export const celestialMarkMarkup = (model, { className = "", offset = [0, 0] } = {}) => {
  const [x, y] = model.position;
  const [deep, soft] = model.palette;
  const classAttribute = className ? ` class="${className}"` : "";
  const mark = model.moon
    ? `<path${classAttribute} data-celestial="moon" fill="${deep}" d="${moonPath(x, y)}"/><circle cx="${x - 1.5}" cy="${y - 1.2}" r=".55" fill="${soft}"/>`
    : `<circle${classAttribute} data-celestial="sun" cx="${x}" cy="${y}" r="3.1" fill="${deep}"/>`;
  const [offsetX, offsetY] = offset;
  return offsetX || offsetY ? `<g transform="translate(${offsetX} ${offsetY})">${mark}</g>` : mark;
};
