type TokenProvider = () => Promise<string | null>;

let activeTokenProvider: TokenProvider | null = null;

export function setInMemoryTokenProvider(provider: TokenProvider | null) {
  activeTokenProvider = provider;
}

export async function getInMemoryIdToken(): Promise<string | null> {
  if (!activeTokenProvider) return null;
  return activeTokenProvider();
}
