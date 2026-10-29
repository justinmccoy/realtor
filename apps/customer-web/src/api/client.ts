import type {
  Brief,
  ClientEventsBatch,
  Comment,
  CommentCreateInput,
  CustomerListing,
  HoursEntry,
  InviteInput,
  Member,
  MemberRole,
  Photo,
  Rating,
  RatingPutInput,
  Settings
} from "@jj/shared";
import { currentAccessToken } from "../auth/cognito";
import { API_BASE } from "../config";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {}
): Promise<T> {
  const token = await currentAccessToken();
  if (!token) throw new ApiClientError(401, "unauthorized", "Not signed in");
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    keepalive: init.keepalive,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {})
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && !contentType.includes("application/json")) {
    throw new ApiClientError(
      res.status,
      "bad_gateway",
      `API returned ${contentType || "no content type"} instead of JSON — is the backend deploy up to date?`
    );
  }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

export interface SearchLite {
  id: string;
  clientName: string;
  status: "active" | "archived";
  settings: Settings;
  role: MemberRole;
}

export const api = {
  mySearches: () => call<{ items: SearchLite[] }>("/searches"),
  searchDetail: (sid: string) =>
    call<{
      search: Omit<SearchLite, "role">;
      brief: Brief;
      role: MemberRole;
      prevSeenAt: string | null;
    }>(`/searches/${sid}`),
  listings: (sid: string) =>
    call<{ items: CustomerListing[] }>(`/searches/${sid}/listings?limit=200`),
  photos: (sid: string, listingIds: string[]) =>
    listingIds.length === 0
      ? Promise.resolve({ items: [] as (Photo & { url: string })[] })
      : call<{ items: (Photo & { url: string })[] }>(
          `/searches/${sid}/photos?ids=${listingIds.slice(0, 120).join(",")}`
        ),
  ratings: (sid: string) => call<{ items: Rating[] }>(`/searches/${sid}/ratings`),
  putRating: (sid: string, lid: string, body: RatingPutInput) =>
    call<Rating>(`/searches/${sid}/listings/${lid}/rating`, {
      method: "PUT",
      body
    }),
  removeRating: (sid: string, lid: string) =>
    call<void>(`/searches/${sid}/listings/${lid}/rating`, { method: "DELETE" }),
  comments: (sid: string) =>
    call<{ items: Comment[] }>(`/searches/${sid}/comments?limit=200`),
  postComment: (sid: string, body: CommentCreateInput) =>
    call<Comment>(`/searches/${sid}/comments`, { method: "POST", body }),
  hours: (sid: string) =>
    call<{ items: HoursEntry[] }>(`/searches/${sid}/hours?limit=500`),
  members: (sid: string) => call<{ items: Member[] }>(`/searches/${sid}/members`),
  invite: (sid: string, body: InviteInput) =>
    call<Member & { accountCreated: boolean }>(`/searches/${sid}/members`, {
      method: "POST",
      body
    }),
  postEvents: (body: ClientEventsBatch) =>
    call<{ accepted: number }>("/activity/events", {
      method: "POST",
      body,
      keepalive: true
    })
};
