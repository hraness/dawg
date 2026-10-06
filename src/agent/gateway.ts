export type GatewayModel = "opus-5.5" | "sol-6.1";

export type GatewayRequest = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
};

export type GatewayClient = {
  complete(request: GatewayRequest, signal?: AbortSignal): Promise<string>;
};

type GatewayFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createGatewayClient(
  options: {
    apiKey?: string;
    baseUrl?: string;
    modelIds?: Partial<Record<GatewayModel, string>>;
    fetcher?: GatewayFetcher;
  } = {},
): GatewayClient {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (
    options.baseUrl ??
    process.env.AI_GATEWAY_BASE_URL ??
    "https://ai-gateway.vercel.sh/v1"
  ).replace(/\/$/, "");
  const apiKey = options.apiKey ?? process.env.AI_GATEWAY_API_KEY;
  const modelIds = {
    "opus-5.5": process.env.TRACK_OPUS_MODEL ?? "anthropic/claude-opus-4.5",
    "sol-6.1": process.env.TRACK_SOL_MODEL ?? "openai/gpt-5.1-codex",
    ...options.modelIds,
  } satisfies Record<GatewayModel, string>;

  return {
    async complete(request, signal) {
      if (!apiKey)
        throw new Error("AI_GATEWAY_API_KEY is required for agent requests");
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...request,
          model: modelIds[request.model as GatewayModel] ?? request.model,
        }),
      };
      if (signal !== undefined) init.signal = signal;
      const response = await fetcher(`${baseUrl}/chat/completions`, init);
      if (!response.ok)
        throw new Error(`AI Gateway request failed (${response.status})`);
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string")
        throw new Error("AI Gateway returned no assistant content");
      return content;
    },
  };
}
