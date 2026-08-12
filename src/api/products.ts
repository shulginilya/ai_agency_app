import type { Product } from '@/types';

const BASE_URL = 'https://dummyjson.com';

type ProductsResponse = { products: Product[] };

/**
 * Example network call. Swap BASE_URL for your own API and this is the
 * only file you need to touch.
 */
export async function fetchProducts(signal?: AbortSignal): Promise<Product[]> {
  const res = await fetch(`${BASE_URL}/products?limit=20&select=title,description,price,rating,thumbnail,category`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  const data = (await res.json()) as ProductsResponse;
  return data.products ?? [];
}
