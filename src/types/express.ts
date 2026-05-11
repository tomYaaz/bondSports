/* eslint-disable @typescript-eslint/no-namespace -- Express merges Request via global namespace */
export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}
