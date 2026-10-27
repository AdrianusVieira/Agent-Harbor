export async function authFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401)
    window.dispatchEvent(new Event("harbor:auth-required"));
  return response;
}
