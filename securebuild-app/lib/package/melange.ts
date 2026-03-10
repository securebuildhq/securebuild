/**
 * Replace epoch value in melange YAML with a new value.
 * This function preserves whitespace and indentation.
 */
export function bumpReleaseInMelangeYAML(melangeYAML: string, release: number): string {
  const lines = melangeYAML.split('\n');
  let epochFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('epoch:')) {
      // Extract the leading whitespace
      const leadingWhitespace = line.substring(0, line.length - trimmed.length);
      
      // Replace the line with the same whitespace + new epoch value
      lines[i] = `${leadingWhitespace}epoch: ${release}`;
      epochFound = true;
      break;
    }
  }

  if (!epochFound) {
    throw new Error('epoch field not found in melange YAML');
  }

  return lines.join('\n');
}