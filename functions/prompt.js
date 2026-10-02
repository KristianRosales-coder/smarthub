/**
 * Fixed prompt template — never shown to customers.
 * Tile fields come from catalog / IMS (database later).
 */
function buildFloorReplacePrompt(tile) {
  const name = tile.name || 'selected tile';
  const color = tile.color || 'natural';
  const finish = tile.finish || 'matte';
  const material = tile.material || tile.kind || 'porcelain';
  const size = tile.sizeCm || '60x60';
  const pattern = tile.pattern || 'straight grid';
  const grout = tile.groutColor || 'light gray';

  return [
    `Replace only the floor in this photo with ${name}, a ${color} ${finish} ${material} tile, ${size} cm,`,
    `in a ${pattern} layout with ${grout} grout lines.`,
    'Keep walls, furniture, lighting, shadows, people, and camera perspective unchanged.',
    'Do not alter anything except the floor surface.',
    'Make the result look like a realistic interior photograph suitable for a tile showroom preview.',
    'The second image is the official product reference — match its color, texture, and pattern as closely as possible.',
  ].join(' ');
}

module.exports = { buildFloorReplacePrompt };
