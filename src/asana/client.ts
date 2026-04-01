import type { Logger } from 'pino';

const ASANA_BASE_URL = 'https://app.asana.com/api/1.0';
const RATE_LIMIT_DELAY_MS = 200;
const MAX_RETRIES = 3;
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface AsanaStory {
  gid: string;
  text: string;
  created_at: string;
}

/**
 * Minimal Asana API client with rate limiting and retry logic.
 */
export interface AsanaTask {
  gid: string;
  name: string;
}

export class AsanaClient {
  private lastRequestTime = 0;

  constructor(
    private readonly accessToken: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Searches for a task by exact name within a project.
   * Uses Asana's search API scoped to workspace + project.
   */
  async findTaskByName(
    workspaceGid: string,
    projectGid: string,
    taskName: string,
  ): Promise<AsanaTask | null> {
    const params = new URLSearchParams({
      'text': taskName,
      'projects.any': projectGid,
      'opt_fields': 'name',
      'is_subtask': 'false',
    });

    const response = await this.fetchWithRetry(
      `${ASANA_BASE_URL}/workspaces/${workspaceGid}/tasks/search?${params}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    const result = (await response.json()) as {
      data: Array<{ gid: string; name: string }>;
    };

    // Asana search is fuzzy — find the exact match
    const exactMatch = result.data.find(
      (t) => t.name.trim().toLowerCase() === taskName.trim().toLowerCase(),
    );

    if (exactMatch) {
      return { gid: exactMatch.gid, name: exactMatch.name };
    }

    this.logger.warn({ taskName, resultsCount: result.data.length }, 'No exact Asana task match found');
    return null;
  }

  async getTaskComments(taskGid: string): Promise<AsanaStory[]> {
    const response = await this.fetchWithRetry(
      `${ASANA_BASE_URL}/tasks/${taskGid}/stories?opt_fields=text,created_at,resource_subtype`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.accessToken}` },
      },
    );

    const result = (await response.json()) as {
      data: Array<{ gid: string; text: string; created_at: string; resource_subtype: string }>;
    };

    // Only return comment stories, not system-generated stories
    return result.data
      .filter((s) => s.resource_subtype === 'comment_added')
      .map((s) => ({ gid: s.gid, text: s.text, created_at: s.created_at }));
  }

  async updateCustomField(
    taskGid: string,
    customFieldGid: string,
    enumOptionGid: string,
  ): Promise<void> {
    await this.fetchWithRetry(
      `${ASANA_BASE_URL}/tasks/${taskGid}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            custom_fields: { [customFieldGid]: enumOptionGid },
          },
        }),
      },
    );
  }

  async addComment(taskGid: string, commentText: string): Promise<string> {
    const response = await this.fetchWithRetry(
      `${ASANA_BASE_URL}/tasks/${taskGid}/stories`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: { text: commentText },
        }),
      },
    );

    const result = (await response.json()) as { data: AsanaStory };
    return result.data.gid;
  }

  async uploadAttachment(
    taskGid: string,
    fileUrl: string,
    fileName: string,
    slackToken: string,
  ): Promise<string> {
    // Download file from Slack
    const slackResponse = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${slackToken}` },
    });

    if (!slackResponse.ok) {
      throw new Error(
        `Failed to download file from Slack (${slackResponse.status})`,
      );
    }

    // Check file size before downloading into memory
    const contentLength = parseInt(
      slackResponse.headers.get('content-length') ?? '0',
      10,
    );
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File too large: ${contentLength} bytes exceeds limit of ${MAX_FILE_SIZE_BYTES}`,
      );
    }

    const fileBuffer = await slackResponse.arrayBuffer();
    const blob = new Blob([fileBuffer]);

    const formData = new FormData();
    formData.append('parent', taskGid);
    formData.append('file', blob, fileName);

    const asanaResponse = await this.fetchWithRetry(
      `${ASANA_BASE_URL}/attachments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body: formData,
      },
    );

    const result = (await asanaResponse.json()) as {
      data: { gid: string };
    };
    return result.data.gid;
  }

  /**
   * Fetch wrapper with rate limiting, retry, and Asana 429 handling.
   */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    attempt = 1,
  ): Promise<Response> {
    await this.rateLimit();

    const response = await fetch(url, init);

    if (response.ok) return response;

    // Retry on rate limit (429) or transient server errors (502, 503, 504)
    const retryableStatuses = [429, 502, 503, 504];
    if (retryableStatuses.includes(response.status) && attempt < MAX_RETRIES) {
      const retryAfter = response.headers.get('retry-after');
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * Math.pow(2, attempt - 1), 10_000);

      this.logger.warn(
        { status: response.status, attempt, delayMs, url },
        'Retrying Asana request',
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return this.fetchWithRetry(url, init, attempt + 1);
    }

    // Non-retryable error
    const errorBody = await response.text();
    throw new Error(`Asana API error (${response.status}): ${errorBody}`);
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed),
      );
    }
    this.lastRequestTime = Date.now();
  }
}
