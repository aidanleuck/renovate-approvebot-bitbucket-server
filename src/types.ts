/**
 * Type definitions for the application
 */

export interface Project {
  key: string;
  name: string;
}

export interface Repository {
  slug: string;
  name: string;
  projectKey: string;
}

export interface PullRequestUser {
  name: string;
}

export interface PullRequestAuthor {
  user: PullRequestUser;
}

export interface PullRequestHref {
  href: string;
}

export interface PullRequestLinks {
  self: PullRequestHref[];
}

export interface PullRequest {
  id: number;
  title: string;
  description?: string;
  author: PullRequestAuthor;
  links: PullRequestLinks;
}

export interface ProcessedPullRequest {
  id: number;
  projectKey: string;
  repoSlug: string;
  title: string;
  links: PullRequestLinks;
}

export interface ApiResponse<T> {
  values: T[];
}

export interface GotOptions {
  prefixUrl: string;
  headers: {
    Authorization: string;
    'Content-Type': string;
  };
  responseType: 'json';
}

export interface GotResponse {
  statusCode: number;
  body: {
    errors?: Array<{ message: string }>;
    [key: string]: unknown;
  };
}
