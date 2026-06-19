/**
 * Utility to cache map images in browser Cache Storage.
 * Saves fetched images as Blobs and returns browser Object URLs.
 */
export async function getCachedMapImageUrl(url: string): Promise<string> {
  if (!url) return '';
  
  try {
    const cache = await caches.open('map-images-cache');
    const cachedResponse = await cache.match(url);
    
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch map image failed with status ${response.status}`);
    }
    
    // Put a clone into the cache since response body can only be read once
    await cache.put(url, response.clone());
    
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('[MapCache] Caching failed, falling back to original URL:', error);
    return url;
  }
}
