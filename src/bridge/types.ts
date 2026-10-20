export interface RobloxResponse {
  id: string;
  output?: string;
  error?: string;
  [key: string]: unknown;
}

export type ResponseResolver = (data: RobloxResponse) => void;
export type DispatchResult = string | null | "INVALID_CLIENT";
