import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_BE_API_BASE_URI as string,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Handle global errors, e.g., 401 Unauthorized (refresh token logic goes here later)
    return Promise.reject(error);
  }
);

export const gisProcClient = axios.create({
  baseURL: import.meta.env.VITE_GISPROC_API_BASE_URI as string,
  headers: {
    'Content-Type': 'application/json'
  },
})
