import axios from 'axios'
import type { BBox } from '../types/geo'
import type { ApiResponse } from './client'

export type TimeseriesData = {
  series: Array<{ date: string; temp: number }>
  image_count: number
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8001',
  timeout: 60_000,
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

function normalizeTimeseriesError(error: unknown): ApiResponse<TimeseriesData> {
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

function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response && error.code !== 'ECONNABORTED'
}

export async function fetchTimeseries(
  bbox: BBox,
  startDate: string,
  endDate: string,
): Promise<ApiResponse<TimeseriesData>> {
  const apiKey = import.meta.env.VITE_INTERNAL_API_KEY
  const request = {
    bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] as [number, number, number, number],
    start_date: startDate,
    end_date: endDate,
  }

  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await api.post<ApiResponse<TimeseriesData>>('/api/timeseries', request, {
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

  return normalizeTimeseriesError(lastError)
}
