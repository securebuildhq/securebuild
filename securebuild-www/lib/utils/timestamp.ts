/**
 * Helper function to parse UTC timestamp from database
 * Handles both old format (without timezone) and new format (with timezone from PR 778)
 * 
 * Supports:
 * - Old format: '2024-05-17 14:48:00.123456' (no timezone)
 * - New format: '2024-05-17 14:48:00.123456+00' (with timezone)
 * - Date objects (returns as-is)
 * - ISO strings with timezone info
 * 
 * @param timestamp - Timestamp from database (string, Date, or null)
 * @returns Parsed Date object or undefined if input is null/empty
 */
export function parseUTCTimestamp(timestamp: string | Date | null): Date | undefined {
  if (!timestamp) return undefined;

  // If it's already a Date object, return it
  if (timestamp instanceof Date) {
    return timestamp;
  }

  // PostgreSQL returns timestamps in format '2024-05-17 14:48:00.123456' when cast to text
  // We need to convert this to ISO format for proper UTC parsing
  if (typeof timestamp === 'string' && timestamp.includes(' ') && !timestamp.includes('T')) {
    // Check if timestamp already has timezone info before appending 'Z'
    const hasTimezone = timestamp.includes('+') || timestamp.includes('-', 10);
    if (hasTimezone) {
      // Replace space with 'T' and normalize bare offset (+HH or -HH) to +HH:00 / -HH:00
      // PostgreSQL ::text on timestamptz gives '+00' but ISO 8601 requires '+00:00'
      let normalized = timestamp.replace(' ', 'T');
      normalized = normalized.replace(/([+-]\d{2})$/, '$1:00');
      return new Date(normalized);
    } else {
      // No timezone, replace space with 'T' and add 'Z' to indicate UTC
      return new Date(`${timestamp}Z`.replace(' ', 'T'));
    }
  }

  // If the timestamp doesn't end with 'Z' or have timezone info, assume it's UTC
  if (typeof timestamp === 'string' && !timestamp.includes('Z') && !timestamp.includes('+') && !timestamp.includes('-', 10)) {
    return new Date(timestamp + 'Z'); // Add Z to indicate UTC
  }

  return new Date(timestamp);
}
