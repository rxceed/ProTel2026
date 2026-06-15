import { apiClient, gisProcClient } from '@/api/client';

/**
 * Fetch DTM georeferencing data and save to localStorage
 */
async function fetchGeoreferenceDtm(fieldName: string) {
  if (!fieldName) return;
  try {
    const geoDataStr = localStorage.getItem(fieldName);
    if (!geoDataStr) {
      console.warn(`[MapCache] No georeferencing data found in localStorage for key: ${fieldName}`);
      return;
    }
    
    const geoData = JSON.parse(geoDataStr);
    const x_crs = geoData['x-crs'];
    const x_bounds = geoData['x-bounds'];
    const x_transform = geoData['x-transform'];

    if (!x_crs || !x_bounds || !x_transform) {
      console.warn(`[MapCache] Missing required georeferencing fields for field ${fieldName}`);
      return;
    }

    let projectId = '';
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        projectId = user.id;
      } catch (e) {}
    }

    if (!projectId) {
      const response = await apiClient.get('/auth/me');
      projectId = response.data?.data?.id;
      if (projectId) {
        // Cache the fetched user details to localStorage to avoid repeated calls
        localStorage.setItem('user', JSON.stringify({
          ...response.data.data,
          id: projectId,
          full_name: response.data.data.fullName,
          system_role: response.data.data.systemRole
        }));
      }
    }

    if (!projectId) {
      console.warn('[MapCache] Could not resolve project_name (userId)');
      return;
    }

    // GET request to host/webodm/projects/{project_name}/tasks/{task_name}/dtm
    const dtmRes = await gisProcClient.get(
      `/webodm/projects/${projectId}/tasks/${fieldName}/dtm`,
      {
        params: {
          x_crs,
          x_bounds,
          x_transform
        }
      }
    );

    // Save response in localStorage with key format fieldname_georeference
    localStorage.setItem(`${fieldName}_georeference`, JSON.stringify(dtmRes.data));
    console.log(`[MapCache] Georeferencing DTM response saved to localStorage under: ${fieldName}_georeference`);
  } catch (error) {
    console.error(`[MapCache] Failed to fetch/save georeference DTM for ${fieldName}:`, error);
  }
}

/**
 * Utility to cache map images in browser Cache Storage.
 * Saves fetched images as Blobs and returns browser Object URLs.
 * Also triggers DTM georeference fetches if fieldName is provided.
 */
export async function getCachedMapImageUrl(url: string, fieldName?: string): Promise<string> {
  if (!url) return '';
  
  if (fieldName) {
    // Run DTM georeferencing request in background
    fetchGeoreferenceDtm(fieldName);
  }
  
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
