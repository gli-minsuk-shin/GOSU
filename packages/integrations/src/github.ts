import { z } from 'zod';

const repoSchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
  permissions: z.object({ pull: z.boolean(), push: z.boolean(), admin: z.boolean() }).optional(),
});
const refSchema = z.object({
  ref: z.string(),
  object: z.object({ sha: z.string(), type: z.string() }),
});

export type GitHubTokenProvider = () => Promise<string>;

/** Uses only short-lived GitHub App installation tokens supplied at call time. */
export class GitHubRepositoryClient {
  constructor(
    private readonly token: GitHubTokenProvider,
    private readonly apiBase = 'https://api.github.com',
  ) {}

  async repository(owner: string, repo: string) {
    return repoSchema.parse(
      await this.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
    );
  }

  async ref(owner: string, repo: string, branch: string) {
    return refSchema.parse(
      await this.get(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      ),
    );
  }

  private async get(path: string) {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${await this.token()}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`github_request_failed:${response.status}`);
    return response.json();
  }
}
