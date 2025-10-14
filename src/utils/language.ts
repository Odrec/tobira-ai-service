/**
 * Normalize language code to lowercase for consistent database queries
 * Per RFC 5646, language tags are case-insensitive
 *
 * @param language - Language code (e.g., "DE-DE", "en-US", "EN")
 * @returns Normalized lowercase language code (e.g., "de-de", "en-us", "en")
 * @throws Error if language is not provided
 */
export function normalizeLanguageCode(language: string | undefined): string {
  if (!language || language.trim() === '') {
    throw new Error('Language code is required and cannot be empty');
  }
  return language.toLowerCase().trim();
}

/**
 * Get language code with fallback
 * E.g., "en-us" will try ["en-us", "en"], "de-de" will try ["de-de", "de"]
 *
 * @param language - Language code (e.g., "en-us", "de-de", "en")
 * @returns Array of language codes to try in order
 */
export function getLanguageFallbacks(language: string): string[] {
  const normalized = normalizeLanguageCode(language);
  const fallbacks: string[] = [normalized];
  
  // If language has a region code (e.g., "en-us"), add base language as fallback
  if (normalized.includes('-')) {
    const baseLanguage = normalized.split('-')[0];
    if (baseLanguage && !fallbacks.includes(baseLanguage)) {
      fallbacks.push(baseLanguage);
    }
  }
  
  // Always fallback to English if not already included
  if (!fallbacks.includes('en')) {
    fallbacks.push('en');
  }
  
  return fallbacks;
}