export interface CatalogEntry {
  id: string;
  name: string;
  brand?: string;
}
export interface Catalog {
  targets: CatalogEntry[];
  models: CatalogEntry[];
  version: string;
  dataset: string;
  license: unknown;
}
export interface CurveFile {
  points: unknown;
}
/** Only maintenance scripts use the network; the application loads bundled files. */
export async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`${response.status} ${url}`);
      return (await response.json()) as T;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  throw Error(`Cannot fetch ${url}`);
}
