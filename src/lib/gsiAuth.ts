
let tokenClient: any;
let inFlightRequest: {
  promise: Promise<string>,
  interactive: boolean,
  resolve: (token: string) => void,
  reject: (error: any) => void
} | null = null;
let authInitialized = false;

// Memory-based caching
let cachedAccessToken: string | null = null;
let tokenExpiryTime: number | null = null;

export const initAuth = (clientId: string) => {
  if (authInitialized || !clientId) return;

  const googleObj = (window as any).google;
  if (!googleObj) {
    console.warn('Google Identity Services script not loaded yet.');
    return;
  }

  tokenClient = googleObj.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (response: any) => {
      if (!inFlightRequest) return;

      const { resolve, reject } = inFlightRequest;
      inFlightRequest = null;

      if (response.error !== undefined) {
        reject(new Error(response.error));
      } else {
        const token = response.access_token;
        cachedAccessToken = token;
        const expiresIn = response.expires_in ? parseInt(response.expires_in, 10) : 3600;
        tokenExpiryTime = Date.now() + expiresIn * 1000;
        resolve(token);
      }
    },
  });

  authInitialized = true;
};

export const getAccessToken = async (interactive = false): Promise<string> => {
  if (!tokenClient) {
    throw new Error('interaction_required'); // Signal that we need to init or script is missing
  }

  if (cachedAccessToken && tokenExpiryTime && (tokenExpiryTime - Date.now() > 60000)) {
    return cachedAccessToken;
  }

  if (inFlightRequest) {
    if (!interactive || inFlightRequest.interactive) {
      return inFlightRequest.promise;
    }
  }

  const promise = new Promise<string>((resolve, reject) => {
    inFlightRequest = {
      promise: null as any,
      interactive,
      resolve,
      reject
    };
  });
  
  if (inFlightRequest) inFlightRequest.promise = promise;

  tokenClient.requestAccessToken(interactive ? {} : { prompt: 'none' });

  return promise;
};
