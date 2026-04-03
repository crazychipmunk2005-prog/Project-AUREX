import axios from 'axios'

export type ApiResponse<T> = {
  success: boolean
  data: T | null
  error: string | null
  cached: boolean
}

export type HeatmapData = {
  tile_url: string
  stats: {
    min_temp: number
    max_temp: number
    mean_temp: number
  }
}

export type ProbeData = {
  lat: number
  lon: number
  avg_temp: number
  anomaly_temp: number
  wind_speed: number
}

export type HeatmapRequest = {
  bbox: [number, number, number, number]
  start_date: string
  end_date: string
  mode: 'absolute' | 'anomaly'
}

export type ProbeRequest = {
  lat: number
  lon: number
  start_date: string
  end_date: string
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8001',
  timeout: 30_000,
})

function normalizeHttpStatusError(status: number): string {
  if (status === 503) {
    return 'Satellite data unavailable. Try a smaller area.'
  }
  if (status === 422) {
    return 'Invalid area or dates. Check your inputs.'
  }
  if (status === 401) {
    return 'API key error. Contact admin.'
  }
  return 'Request failed. Please try again.'
}

function normalizeClientError(error: unknown): ApiResponse<HeatmapData> {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return { success: false, data: null, error: 'Request timed out. Try a smaller area.', cached: false }
    }

    if (!error.response) {
      return { success: false, data: null, error: 'Cannot reach server.', cached: false }
    }

    return {
      success: false,
      data: null,
      error: normalizeHttpStatusError(error.response.status),
      cached: false,
    }
  }

  return { success: false, data: null, error: 'Cannot reach server.', cached: false }
}

function normalizeProbeError(error: unknown): ApiResponse<ProbeData> {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return { success: false, data: null, error: 'Request timed out. Try a smaller area.', cached: false }
    }

    if (!error.response) {
      return { success: false, data: null, error: 'Cannot reach server.', cached: false }
    }

    if (error.response.status === 422) {
      return { success: false, data: null, error: 'Cursor probe unavailable for this location.', cached: false }
    }

    return {
      success: false,
      data: null,
      error: normalizeHttpStatusError(error.response.status),
      cached: false,
    }
  }

  return { success: false, data: null, error: 'Cannot reach server.', cached: false }
}

function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response && error.code !== 'ECONNABORTED'
}

export async function fetchHeatmap(request: HeatmapRequest): Promise<ApiResponse<HeatmapData>> {
  const apiKey = import.meta.env.VITE_INTERNAL_API_KEY
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await api.post<ApiResponse<HeatmapData>>('/api/heatmap', request, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      })
      const payload = response.data
      return {
        success: payload.success,
        data: payload.data ?? null,
        error: payload.error ?? null,
        cached: Boolean(payload.cached),
      }
    } catch (error) {
      lastError = error
      if (attempt === 0 && isNetworkError(error)) {
        continue
      }
      break
    }
  }

  return normalizeClientError(lastError)
}

export async function fetchProbe(request: ProbeRequest): Promise<ApiResponse<ProbeData>> {
  const apiKey = import.meta.env.VITE_INTERNAL_API_KEY
  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await api.post<ApiResponse<ProbeData>>('/api/probe', request, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      })
      const payload = response.data
      return {
        success: payload.success,
        data: payload.data ?? null,
        error: payload.error ?? null,
        cached: Boolean(payload.cached),
      }
    } catch (error) {
      lastError = error
      if (attempt === 0 && isNetworkError(error)) {
        continue
      }
      break
    }
  }

  return normalizeProbeError(lastError)
}
